from dataclasses import dataclass
from typing import Optional

from .connection import fetch_one_read


@dataclass
class ApprovedUser:
    email: str
    name: str
    org_name: str
    tenant_id: Optional[str]


async def get_approved_user(email: str) -> Optional[ApprovedUser]:
    """
    Query the users table by email.
    Returns ApprovedUser only if approval_status = 'approved', otherwise None.
    """
    normalized_email = email.strip().lower()

    row = await fetch_one_read(
        """
        SELECT email, name, org_name, tenant_id, approval_status
        FROM   tavro_requests
        WHERE  lower(email) = %s
        LIMIT  1
        """,
        normalized_email,
    )

    if row is None:
        print(f"[DB] No user found for email: {normalized_email}")
        return None

    approval_status = str(row["approval_status"] or "").strip().lower()
    if approval_status != "approved":
        print(f"[DB] User {normalized_email} not approved (status={row['approval_status']})")
        return None

    print(f"[DB] User approved: email={normalized_email}, tenant_id={row['tenant_id']}")
    return ApprovedUser(
        email=row["email"],
        name=row["name"],
        org_name=row["org_name"],
        tenant_id=row["tenant_id"],
    )
