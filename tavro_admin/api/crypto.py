import base64
import os


def _fernet():
    from cryptography.fernet import Fernet

    key = os.getenv("ADMIN_ENCRYPTION_KEY", "").strip()
    if not key:
        # Dev-only deterministic fallback — set ADMIN_ENCRYPTION_KEY in production.
        # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
        raw = b"tavro-admin-dev-key-00000000000!"  # exactly 32 bytes
        key = base64.urlsafe_b64encode(raw).decode()
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except Exception:
        return ""
