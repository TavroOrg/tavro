#!/bin/sh
# Inject enterprise routers into /app/api/ before uvicorn starts.
# Enterprise files are baked into the image at /enterprise/ so they
# survive the ./tavro_api:/app dev-mode volume mount.
set -e

mkdir -p /app/api/routers
cp /enterprise/api/routers/compliance.py            /app/api/routers/compliance.py
cp /enterprise/api/routers/compliance_research.py   /app/api/routers/compliance_research.py
cp /enterprise/api/routers/audit.py                 /app/api/routers/audit.py
cp /enterprise/api/llm.py                           /app/api/llm.py

exec uvicorn main:app --host 0.0.0.0 --port 8000
