"""
Generic in-memory SSE broadcaster.

Any part of the API can call `broadcaster.publish(event)` after a mutation
and every connected client will receive the event within milliseconds.
The event payload is intentionally minimal — no sensitive data — so the
endpoint can be served without authentication.
"""

import asyncio
import json
from typing import Any


class _Broadcaster:
    def __init__(self) -> None:
        self._queues: set[asyncio.Queue[str]] = set()

    def subscribe(self) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=64)
        self._queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str]) -> None:
        self._queues.discard(q)

    async def publish(self, event: dict[str, Any]) -> None:
        if not self._queues:
            return
        payload = json.dumps(event, default=str)
        dead: set[asyncio.Queue[str]] = set()
        for q in self._queues:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.add(q)
        for q in dead:
            self._queues.discard(q)


broadcaster = _Broadcaster()
