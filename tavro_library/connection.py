import threading
import asyncio
from contextlib import contextmanager
from urllib.parse import urlparse

import psycopg2
import psycopg2.extras
from psycopg2 import pool

from utils.db import DATABASE_URL

# ── Globals ───────────────────────────────────────────────────────────────────
_connection_pool: pool.SimpleConnectionPool | None = None
_pool_lock = threading.Lock()


def _get_connection_pool() -> pool.SimpleConnectionPool:
    """
    Get or create the global connection pool (thread-safe, created once).
    Uses a small pool since we are read-only and calls are infrequent (auth only).
    """
    global _connection_pool

    if _connection_pool is None:
        with _pool_lock:
            if _connection_pool is None:  # double-checked locking
                try:
                    _url = urlparse(DATABASE_URL)
                    _connection_pool = pool.SimpleConnectionPool(
                        minconn=2,
                        maxconn=10,   # small — this is auth only, not a data API
                        host=_url.hostname,
                        port=_url.port or 5432,
                        dbname=_url.path.lstrip("/"),
                        user=_url.username,
                        password=_url.password,
                        sslmode=os.getenv("DB_SSLMODE", "prefer"),
                        options="-c default_transaction_read_only=on",  # read-only session
                        connect_timeout=5,
                    )
                    print("[DB] ✅ Connection pool initialised successfully")
                except Exception as e:
                    print(f"[DB] ❌ Failed to create connection pool: {e}")
                    raise

    return _connection_pool


@contextmanager
def _get_db_connection():
    """
    Sync context manager — borrows a connection from the pool and
    returns it automatically when the block exits (even on error).
    """
    conn_pool = _get_connection_pool()
    conn = conn_pool.getconn()
    try:
        yield conn
    finally:
        conn_pool.putconn(conn)


def close_pool() -> None:
    """Gracefully close all connections (call on app shutdown)."""
    global _connection_pool
    if _connection_pool:
        _connection_pool.closeall()
        _connection_pool = None
        print("[DB] ✅ Connection pool closed")


# ── Public async helper ───────────────────────────────────────────────────────

async def fetch_one_read(query: str, *params) -> dict | None:
    """
    Run a single SELECT query asynchronously (offloaded to a thread so it
    doesn't block the FastMCP event loop).

    Returns a dict of column→value, or None if no row was found.

    Usage:
        row = await fetch_one_read(
            "SELECT email, tenant_id, approval_status FROM users WHERE email = %s LIMIT 1",
            email,
        )
    """
    def _run() -> dict | None:
        with _get_db_connection() as conn:
            # RealDictCursor returns rows as plain dicts — no index juggling
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(query, params)
                row = cur.fetchone()
                return dict(row) if row else None

    # run_in_executor keeps the async event loop unblocked
    return await asyncio.get_event_loop().run_in_executor(None, _run)
