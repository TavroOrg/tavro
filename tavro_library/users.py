import os
from dataclasses import dataclass
from typing import Optional

import psycopg2

from .connection import fetch_one_read


@dataclass
class ApprovedUser:
    email: str
    name: str
    org_name: str
    tenant_id: Optional[str]


def _as_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _fallback_approved_user(email: str) -> ApprovedUser:
    # Minimal profile used when external approval registry is not available.
    return ApprovedUser(
        email=email,
        name=email,
        org_name="",
        tenant_id=None,
    )


async def get_approved_user(email: str) -> Optional[ApprovedUser]:
    """
    Resolve login approval by email.

    Behavior:
    - If table `tavro_requests` exists, enforce approval_status='approved'.
    - If the table is missing and strict mode is disabled, allow fallback login.
    - Set MCP_REQUIRE_USER_APPROVAL=true to enforce strict approval at all times.
    """
    if not email:
        print("[DB] No email claim available in auth token")
        return None

    strict_approval_required = _as_bool(
        os.getenv("MCP_REQUIRE_USER_APPROVAL"),
        default=False,
    )

    try:
        row = await fetch_one_read(
            """
            SELECT email, name, org_name, tenant_id, approval_status
            FROM   tavro_requests
            WHERE  email = %s
            LIMIT  1
            """,
            email,
        )
    except psycopg2.errors.UndefinedTable:
        if strict_approval_required:
            print("[DB] approval table 'tavro_requests' is missing and strict approval is enabled")
            return None

        print("[DB] approval table 'tavro_requests' not found; allowing login fallback")
        return _fallback_approved_user(email)
    except Exception as e:
        if strict_approval_required:
            print(f"[DB] approval lookup failed and strict approval is enabled: {e}")
            return None

        print(f"[DB] approval lookup failed; allowing login fallback: {e}")
        return _fallback_approved_user(email)

    if row is None:
        if strict_approval_required:
            print(f"[DB] no approved user row found for email: {email}")
            return None

        print(f"[DB] no approval row found for email: {email}; allowing login fallback")
        return _fallback_approved_user(email)

    approval_status = str(row.get("approval_status", "")).strip().lower()
    if approval_status != "approved":
        if strict_approval_required:
            print(f"[DB] user {email} not approved (status={row.get('approval_status')})")
            return None

        print(f"[DB] user {email} approval status is {row.get('approval_status')}; allowing login fallback")
        return _fallback_approved_user(email)

    print(f"[DB] user approved: email={email}, tenant_id={row.get('tenant_id')}")
    return ApprovedUser(
        email=row["email"],
        name=row.get("name") or email,
        org_name=row.get("org_name") or "",
        tenant_id=row.get("tenant_id"),
    )
