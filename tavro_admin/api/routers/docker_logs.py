import asyncio
import json
import os
import re
import time
import threading
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter()

LOG_RETENTION_HOURS = int(os.getenv("DOCKER_LOG_RETENTION_HOURS", "24"))
MAX_BUFFER_SIZE = 50_000

_log_buffer: deque[dict] = deque(maxlen=MAX_BUFFER_SIZE)
_subscribers: set[asyncio.Queue] = set()
_watched: set[str] = set()
_collector_started = False
_event_loop: asyncio.AbstractEventLoop | None = None

_COLORS = [
    "blue", "green", "yellow", "red", "purple",
    "pink", "cyan", "orange", "teal", "indigo",
]
_container_colors: dict[str, str] = {}

# Docker prepends RFC-3339 timestamps when timestamps=True:
#   2026-06-02T07:24:04.077274799Z <message>
_DOCKER_TS_RE = re.compile(
    r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z\s*(.*)',
    re.DOTALL,
)

# Strips ANSI/VT100 colour codes
_ANSI_RE = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]|\x1b[@-Z\\-_]')


def _color_for(name: str) -> str:
    if name not in _container_colors:
        _container_colors[name] = _COLORS[len(_container_colors) % len(_COLORS)]
    return _container_colors[name]


def _parse_log_line(raw_bytes: bytes) -> tuple[float, str]:
    """
    Decode a raw Docker log line, strip ANSI codes, extract the Docker-prepended
    RFC-3339 timestamp, and return (unix_timestamp, clean_message).
    Falls back to time.time() if the timestamp prefix is absent or unparseable.
    """
    text = _ANSI_RE.sub('', raw_bytes.decode('utf-8', errors='replace'))
    m = _DOCKER_TS_RE.match(text)
    if m:
        base, frac, msg = m.group(1), m.group(2) or '0', m.group(3)
        # Docker emits nanoseconds (9 digits); Python strptime handles only 6 → truncate
        frac = frac[:6].ljust(6, '0')
        try:
            dt = datetime.strptime(f"{base}.{frac}", '%Y-%m-%dT%H:%M:%S.%f')
            ts = dt.replace(tzinfo=timezone.utc).timestamp()
            return ts, msg.strip()
        except ValueError:
            pass
    return time.time(), text.strip()


def _container_started_at(container) -> datetime | None:
    """
    Parse the container's StartedAt field from Docker attrs.
    Returns a UTC-aware datetime, or None if unavailable / zero-value.
    """
    try:
        raw = container.attrs.get('State', {}).get('StartedAt', '')
        if not raw or raw.startswith('0001-'):
            return None
        # Truncate nanoseconds to microseconds
        dt = datetime.strptime(raw[:26], '%Y-%m-%dT%H:%M:%S.%f')
        return dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


# ── Background threads ────────────────────────────────────────────────────────

def _tail_container(container_id: str, container_name: str, loop: asyncio.AbstractEventLoop):
    """
    Blocking thread — streams every log line for one container.

    Uses the container's own StartedAt time as the `since` cursor so we capture
    every log from the very first line (including startup), without reading logs
    from a previous lifecycle of the same container.

    For containers running longer than LOG_RETENTION_HOURS, logs older than the
    retention window are silently discarded before being pushed to the buffer.
    """
    try:
        import docker
        client = docker.from_env()
        container = client.containers.get(container_id)

        # Determine the earliest log we care about:
        #   max(container_start, now - retention_window)
        # This gives us all logs from container birth for freshly started containers,
        # and only the retention window for long-running ones.
        started = _container_started_at(container)
        retention_cutoff = datetime.now(timezone.utc) - timedelta(hours=LOG_RETENTION_HOURS)
        since = max(started, retention_cutoff) if started else retention_cutoff

        print(f"[docker-logs] Tailing '{container_name}' since {since.isoformat()}")

        for raw in container.logs(stream=True, follow=True, timestamps=True, since=since):
            ts, message = _parse_log_line(raw)
            if not message:
                continue
            entry = {
                "container": container_name,
                "cid": container_id[:12],
                "color": _color_for(container_name),
                "message": message,
                "ts": ts,
            }
            asyncio.run_coroutine_threadsafe(_push(entry), loop)

    except Exception as exc:
        # Log the real error instead of silently discarding it — this is how we
        # diagnose containers whose log driver doesn't support streaming, permission
        # errors, or containers that restarted and changed ID.
        print(f"[docker-logs] ERROR tailing '{container_name}' ({container_id[:12]}): {exc}")
    finally:
        _watched.discard(container_id)
        print(f"[docker-logs] Stopped tailing '{container_name}' ({container_id[:12]})")


def _watch_events(loop: asyncio.AbstractEventLoop):
    """Blocking thread — watches for new containers starting and tails them."""
    try:
        import docker
        client = docker.from_env()

        # Subscribe to the event stream BEFORE the gap-fill scan so no start
        # event can slip between the two. Any container that started during
        # start_log_collector()'s initial scan will be caught here.
        events = client.events(decode=True, filters={"type": "container", "event": "start"})

        # Gap-fill: pick up containers that started between start_log_collector's
        # initial scan and the moment the events stream was opened.
        for container in client.containers.list():
            cid = container.id
            if cid not in _watched:
                _watched.add(cid)
                print(f"[docker-logs] Gap-fill: registering '{container.name}' ({cid[:12]})")
                threading.Thread(
                    target=_tail_container, args=(cid, container.name, loop), daemon=True
                ).start()

        print("[docker-logs] Watching Docker events for new container starts")
        for event in events:
            cid = event.get("id", "")
            cname = event.get("Actor", {}).get("Attributes", {}).get("name", cid[:12])
            if cid and cid not in _watched:
                _watched.add(cid)
                print(f"[docker-logs] New container started: '{cname}' ({cid[:12]})")
                threading.Thread(
                    target=_tail_container, args=(cid, cname, loop), daemon=True
                ).start()
    except Exception as exc:
        print(f"[docker-logs] ERROR in event watcher: {exc}")


# ── Async helpers ─────────────────────────────────────────────────────────────

async def _push(entry: dict):
    """Appends to buffer, trims entries beyond the retention window, notifies subscribers."""
    cutoff = time.time() - LOG_RETENTION_HOURS * 3600
    while _log_buffer and _log_buffer[0]["ts"] < cutoff:
        _log_buffer.popleft()
    _log_buffer.append(entry)

    dead: set[asyncio.Queue] = set()
    for q in _subscribers:
        try:
            q.put_nowait(entry)
        except Exception:
            dead.add(q)
    _subscribers.difference_update(dead)


def _periodic_rescan(loop: asyncio.AbstractEventLoop):
    """Every 10 s, register any running containers not yet being tailed.
    Catches containers that started in the gap between the initial scan and the
    events watcher, or whose start event was silently missed."""
    import docker
    while True:
        time.sleep(10)
        try:
            client = docker.from_env()
            for container in client.containers.list():
                cid = container.id
                if cid not in _watched:
                    _watched.add(cid)
                    print(f"[docker-logs] Rescan found '{container.name}' ({cid[:12]})")
                    threading.Thread(
                        target=_tail_container, args=(cid, container.name, loop), daemon=True
                    ).start()
        except Exception as exc:
            print(f"[docker-logs] ERROR in periodic rescan: {exc}")


# ── Startup ───────────────────────────────────────────────────────────────────

async def start_log_collector():
    """Called once from the FastAPI lifespan to begin background log collection."""
    global _collector_started, _event_loop
    if _collector_started:
        return
    _collector_started = True
    _event_loop = asyncio.get_running_loop()

    try:
        import docker as _docker
        client = _docker.from_env()
        containers = client.containers.list()
        print(f"[docker-logs] Found {len(containers)} running containers")
        for container in containers:
            cid = container.id
            print(f"[docker-logs] Registering container: '{container.name}' ({cid[:12]})")
            if cid not in _watched:
                _watched.add(cid)
                threading.Thread(
                    target=_tail_container,
                    args=(cid, container.name, _event_loop),
                    daemon=True,
                ).start()
        threading.Thread(target=_watch_events, args=(_event_loop,), daemon=True).start()
        threading.Thread(target=_periodic_rescan, args=(_event_loop,), daemon=True).start()
    except Exception as exc:
        print(f"[docker-logs] Docker socket unavailable — logs disabled: {exc}")


# ── API endpoints ─────────────────────────────────────────────────────────────

@router.get("/stream")
async def stream_logs():
    """SSE endpoint. Replays buffered history on connect, then streams live."""
    q: asyncio.Queue = asyncio.Queue(maxsize=2000)
    _subscribers.add(q)

    async def gen() -> AsyncGenerator[str, None]:
        cutoff = time.time() - LOG_RETENTION_HOURS * 3600
        for entry in list(_log_buffer):
            if entry["ts"] >= cutoff:
                yield f"data: {json.dumps(entry)}\n\n"
        try:
            while True:
                try:
                    entry = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(entry)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            _subscribers.discard(q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/history")
async def get_history(limit: int = 2000):
    """Returns buffered log entries within the retention window."""
    cutoff = time.time() - LOG_RETENTION_HOURS * 3600
    entries = [e for e in _log_buffer if e["ts"] >= cutoff]
    return {"logs": entries[-limit:], "total": len(entries)}


@router.get("/debug")
async def debug_buffer():
    """Returns per-container entry counts and sample messages — helps diagnose why a container shows no logs."""
    from collections import Counter
    counts: Counter = Counter()
    samples: dict[str, list] = {}
    for entry in _log_buffer:
        name = entry["container"]
        counts[name] += 1
        if name not in samples:
            samples[name] = []
        if len(samples[name]) < 3:
            samples[name].append({"ts": entry["ts"], "msg": entry["message"][:120]})

    return {
        "total_buffered": len(_log_buffer),
        "watched_container_ids": list(_watched),
        "per_container": {
            name: {"count": counts[name], "samples": samples.get(name, [])}
            for name in sorted(counts)
        },
    }


@router.get("/containers")
async def list_containers():
    """Lists all currently running Docker containers."""
    try:
        import docker as _docker
        client = _docker.from_env()
        result = [
            {
                "id": c.short_id,
                "name": c.name,
                "status": c.status,
                "color": _color_for(c.name),
            }
            for c in client.containers.list()
        ]
        return {"containers": result}
    except Exception as exc:
        return {"containers": [], "error": str(exc)}
