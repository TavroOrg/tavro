import os
from contextlib import contextmanager

import psycopg2
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Single place in the entire codebase that reads the database URL.
# Every other module imports DATABASE_URL, db_connection, or sync_engine from here.
DATABASE_URL: str = os.environ["DATABASE_URL"]

# ── Sync SQLAlchemy engine (worker, services, connectors) ─────────────────────
# pool_size=5 / max_overflow=5 → max 10 concurrent sync connections per process.
sync_engine = create_engine(
    DATABASE_URL,
    pool_size=15,        # Keep 15 warm connections for sync services (worker, connectors, library)
    max_overflow=35,     # Allow up to 50 total during peaks (500 users × 200ms req ÷ ~100ms hold)
    pool_pre_ping=True,  # drops stale connections before handing them out
)
SyncSessionLocal = sessionmaker(bind=sync_engine, autocommit=False, autoflush=False)


# ── psycopg2 context manager (services still using raw cursors) ───────────────
@contextmanager
def db_connection():
    """
    Sync psycopg2 connection — auto-commits on success, rolls back on error,
    always closes. Use as:

        with db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(...)
    """
    conn = psycopg2.connect(DATABASE_URL)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
