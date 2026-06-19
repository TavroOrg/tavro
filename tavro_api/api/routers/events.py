"""
Generic SSE endpoint — pushes mutation events to every connected browser tab.

GET /api/v1/events

No authentication is required: events contain no sensitive data (entity type +
action only).  The actual data fetch that follows a notification IS authenticated,
so there is no information leak.

EventSource (browser built-in) reconnects automatically on disconnect; the
30-second keepalive comment ensures proxies/load-balancers don't close idle
connections.
"""

import asyncio

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from api.events import broadcaster

router = APIRouter()

_KEEPALIVE_INTERVAL = 30  # seconds


@router.get("/events", tags=["Events"])
async def stream_events():
    async def _generate():
        q = broadcaster.subscribe()
        try:
            while True:
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=_KEEPALIVE_INTERVAL)
                    yield f"data: {payload}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            broadcaster.unsubscribe(q)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
