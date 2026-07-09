# ==========================================================================
# Tavro Admin Portal
# Stage 1: Build the React frontend
# Stage 2: Python FastAPI serving both the API and the built React app
# ==========================================================================

# ── Stage 1: React build ───────────────────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /frontend

COPY tavro_admin/package*.json ./
RUN npm install

COPY tavro_admin/ ./
RUN npm run build

# ── Stage 2: FastAPI runtime ───────────────────────────────────────────────────
FROM python:3.12-slim
WORKDIR /app

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends libpq-dev gcc && \
    rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY tavro_admin/requirements.txt /tmp/requirements.txt
COPY dist/tavro_agent_card-0.1.1-py3-none-any.whl /tmp/
RUN pip install --no-cache-dir -r /tmp/requirements.txt /tmp/tavro_agent_card-0.1.1-py3-none-any.whl

# Bake the embedding model into the image at build time so the DataHub catalog
# sync's embedding step never needs outbound internet at runtime.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding(model_name='sentence-transformers/all-MiniLM-L6-v2')"

# Pre-create directories so volume mounts overlay them (not replace them)
RUN mkdir -p /app/agent_cards

# Admin FastAPI source
COPY tavro_admin/api /app/api

# React build output served as static files
COPY --from=frontend /frontend/dist /app/static

# Connector code (required for the Connectors page run endpoints)
COPY tavro_admin/catalog_connector /app/catalog_connector
COPY worker.py /app/worker.py
COPY utils /app/utils

# DataHub catalog connector — extract/store step writes here (overlaid by the
# ./datahub bind mount in docker-compose); vector-ingest step reuses this script
# and schema verbatim, same as the standalone datahub-vector-ingest job.
COPY datahub/ingest_datahub_vectors.py /app/datahub/ingest_datahub_vectors.py
COPY sql/twin_datahub_context.sql /app/sql/twin_datahub_context.sql

ENV PYTHONPATH=/app

EXPOSE 7000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "7000"]
