"""
Shared error handling utilities for API routers.

Provides a single function that logs the original exception (for developers/ops)
and raises an HTTPException with a user-friendly message (for API consumers).
"""

import logging
from fastapi import HTTPException

logger = logging.getLogger(__name__)

_SERVER_ERROR_MSG = "A server error occurred. Please try again or contact support if the issue persists."


def raise_server_error(exc: Exception, context: str = "") -> None:
    """Log exc and raise a 500 HTTPException with a generic user-friendly message."""
    label = f"[{context}] " if context else ""
    logger.error("%s%s", label, exc, exc_info=True)
    raise HTTPException(status_code=500, detail=_SERVER_ERROR_MSG) from exc
