import io
import mimetypes
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel

UPLOAD_DIR = Path(os.getenv("CHAT_UPLOAD_DIR", "./uploads/chat_attachments"))

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "text/csv",
    "application/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

MAX_BYTES = 20 * 1024 * 1024  # 20 MB

router = APIRouter(prefix="/chat-attachments", tags=["Chat Attachments"])


class AttachmentRef(BaseModel):
    id: str
    name: str
    mime_type: str
    size: int
    url: str


@router.post("/upload", response_model=AttachmentRef, status_code=201)
async def upload_chat_attachment(file: UploadFile = File(...)):
    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"

    if mime not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail=f"File type '{mime}' is not allowed. Accepted: PDF, images, CSV, Excel.")

    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 20 MB limit.")

    att_id = str(uuid.uuid4())
    folder = UPLOAD_DIR / att_id
    folder.mkdir(parents=True, exist_ok=True)

    safe_name = Path(file.filename or "unnamed").name
    (folder / safe_name).write_bytes(data)

    return AttachmentRef(
        id=att_id,
        name=safe_name,
        mime_type=mime,
        size=len(data),
        url=f"/chat-attachments/{att_id}/download",
    )


@router.get("/{att_id}/download")
async def download_chat_attachment(att_id: str):
    folder = UPLOAD_DIR / att_id
    if not folder.exists():
        raise HTTPException(status_code=404, detail="Attachment not found.")
    files = list(folder.iterdir())
    if not files:
        raise HTTPException(status_code=404, detail="Attachment not found.")
    f = files[0]
    mime = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
    return FileResponse(
        str(f),
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{f.name}"'},
    )


@router.get("/{att_id}/extract-text", response_class=PlainTextResponse)
async def extract_text_from_attachment(att_id: str):
    """Return extracted plain-text content of a stored attachment for LLM context."""
    folder = UPLOAD_DIR / att_id
    if not folder.exists():
        raise HTTPException(status_code=404, detail="Attachment not found.")
    files = list(folder.iterdir())
    if not files:
        raise HTTPException(status_code=404, detail="Attachment not found.")

    f = files[0]
    mime = mimetypes.guess_type(str(f))[0] or ""
    ext = f.suffix.lower()

    if mime == "application/pdf" or ext == ".pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(str(f))
            pages = [page.extract_text() or "" for page in reader.pages]
            text = "\n\n".join(pages).strip()
            return text or f"[PDF: {f.name} — no extractable text found]"
        except ImportError:
            return f"[PDF: {f.name} — text extraction unavailable (install pypdf)]"
        except Exception as exc:
            return f"[PDF: {f.name} — extraction error: {exc}]"

    if mime in ("text/csv", "application/csv") or ext == ".csv":
        try:
            import pandas as pd
            df = pd.read_csv(str(f))
            return df.to_csv(index=False) or f"[CSV: {f.name} — empty file]"
        except Exception as exc:
            return f"[CSV: {f.name} — parse error: {exc}]"

    if mime in (
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ) or ext in (".xlsx", ".xls"):
        try:
            import pandas as pd
            df = pd.read_excel(str(f))
            return df.to_csv(index=False) or f"[Excel: {f.name} — empty file]"
        except Exception as exc:
            return f"[Excel: {f.name} — parse error: {exc}]"

    if mime.startswith("image/") or ext in (".png", ".jpg", ".jpeg", ".webp"):
        try:
            from PIL import Image
            import pytesseract
            image = Image.open(str(f))
            text = pytesseract.image_to_string(image).strip()
            return text or f"[Image: {f.name} — no text detected]"
        except ImportError:
            return f"[Image: {f.name} — install pytesseract and Pillow for OCR]"
        except Exception as exc:
            return f"[Image: {f.name} — OCR error: {exc}]"

    # Plain text / fallback
    try:
        return f.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        return f"[File: {f.name} — read error: {exc}]"
