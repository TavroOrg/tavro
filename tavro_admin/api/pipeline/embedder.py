from __future__ import annotations

import asyncio

from fastembed import TextEmbedding

EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
EMBEDDING_DIM = 384
EMBEDDING_BATCH_SIZE = 50

_model: TextEmbedding | None = None
_model_lock = asyncio.Lock()


async def _get_model() -> TextEmbedding:
    global _model
    if _model is None:
        async with _model_lock:
            if _model is None:
                _model = await asyncio.to_thread(TextEmbedding, model_name=EMBEDDING_MODEL)
    return _model


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embeds document/passage text (row chunks). No instruction prefix —
    BGE's asymmetric convention only prefixes the query side at search time."""
    model = await _get_model()
    return await asyncio.to_thread(
        lambda: [vector.tolist() for vector in model.embed(texts, batch_size=EMBEDDING_BATCH_SIZE)]
    )
