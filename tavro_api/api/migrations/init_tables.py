"""
Auto-initialize missing tables on app startup.
Dynamically discovers and runs all SQL files from sql/core/ directory.
New tables are automatically picked up without manual list maintenance.
"""
from pathlib import Path
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

SQL_CORE_DIR = Path(__file__).parent.parent.parent.parent / "sql" / "core"


def _split_sql_statements(sql_content: str) -> list[str]:
    """
    Split a SQL file into executable statements.

    This keeps semicolons inside quoted strings intact so files containing
    multiple statements, such as CREATE TABLE followed by CREATE INDEX, can be
    executed safely with asyncpg.
    """
    statements: list[str] = []
    current: list[str] = []
    in_single_quote = False
    in_double_quote = False
    in_line_comment = False
    in_block_comment = False
    dollar_quote_tag: str | None = None
    i = 0

    while i < len(sql_content):
        char = sql_content[i]
        next_char = sql_content[i + 1] if i + 1 < len(sql_content) else ""

        if in_line_comment:
            current.append(char)
            if char == "\n":
                in_line_comment = False
            i += 1
            continue

        if in_block_comment:
            current.append(char)
            if char == "*" and next_char == "/":
                current.append(next_char)
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue

        if dollar_quote_tag is not None:
            if sql_content.startswith(dollar_quote_tag, i):
                current.append(dollar_quote_tag)
                i += len(dollar_quote_tag)
                dollar_quote_tag = None
                continue
            current.append(char)
            i += 1
            continue

        if not in_single_quote and not in_double_quote:
            if char == "-" and next_char == "-":
                current.append(char)
                current.append(next_char)
                in_line_comment = True
                i += 2
                continue
            if char == "/" and next_char == "*":
                current.append(char)
                current.append(next_char)
                in_block_comment = True
                i += 2
                continue
            if char == "$":
                j = i + 1
                while j < len(sql_content) and (
                    sql_content[j].isalnum() or sql_content[j] == "_"
                ):
                    j += 1
                if j < len(sql_content) and sql_content[j] == "$":
                    tag = sql_content[i : j + 1]
                    current.append(tag)
                    i = j + 1
                    dollar_quote_tag = tag
                    continue

        if char == "'" and not in_double_quote:
            escaped = i > 0 and sql_content[i - 1] == "\\"
            if not escaped:
                in_single_quote = not in_single_quote
        elif char == '"' and not in_single_quote:
            escaped = i > 0 and sql_content[i - 1] == "\\"
            if not escaped:
                in_double_quote = not in_double_quote

        if char == ";" and not in_single_quote and not in_double_quote:
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current = []
            i += 1
            continue

        current.append(char)
        i += 1

    tail = "".join(current).strip()
    if tail:
        statements.append(tail)

    return statements


def _get_sql_files() -> list[Path]:
    """
    Dynamically discover all SQL files in sql/core/ directory.
    Returns a sorted list of file paths.
    """
    if not SQL_CORE_DIR.exists():
        logger.warning("SQL_CORE_DIR does not exist: %s", SQL_CORE_DIR)
        return []

    sql_files = sorted(SQL_CORE_DIR.glob("*.sql"))
    if sql_files:
        logger.info("Discovered %s SQL table files to initialize", len(sql_files))
    return sql_files


async def initialize_tables(db: AsyncSession) -> None:
    """
    Auto-create missing tables by running all SQL files from sql/core/.

    Features:
    - Automatically discovers new SQL files
    - Safely executes files containing multiple statements
    - Remains idempotent when SQL uses IF NOT EXISTS
    """
    sql_files = _get_sql_files()

    if not sql_files:
        logger.info("No SQL table files found to initialize")
        return

    await db.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
    await db.commit()

    for file_path in sql_files:
        try:
            sql_content = file_path.read_text(encoding="utf-8")
            statements = _split_sql_statements(sql_content)

            for statement in statements:
                await db.execute(text(statement))

            await db.commit()
            logger.info("Initialized: %s", file_path.name)
        except Exception as exc:
            logger.error("Failed to initialize %s: %s", file_path.name, exc)
            await db.rollback()
            raise
