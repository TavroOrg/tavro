FROM python:3.12-slim

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends curl libpq-dev gcc && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/* && \
    npm install -g @anthropic-ai/claude-code

# Install Temporal CLI (used by the embedded worker)
RUN curl -sSL https://temporal.download/cli.sh | bash
ENV PATH="/root/.temporalio/bin:${PATH}"

WORKDIR /app

# ── Install Python dependencies ───────────────────────────────────────────────
COPY tavro_api/requirements.txt /tmp/requirements.txt
COPY services/requirements.txt /tmp/requirements-risk.txt
COPY dist/tavro_agent_card-0.1.1-py3-none-any.whl /tmp/

RUN pip install  \
      -r /tmp/requirements.txt \
      -r /tmp/requirements-risk.txt && \
    pip install /tmp/tavro_agent_card-0.1.1-py3-none-any.whl

# ── Copy Digital Twin API source ─────────────────────────────────────────────
COPY tavro_api/ /app/

# ── Copy Risk stack source (keeps original import paths intact) ───────────────
COPY services          /app/services
COPY tavro_library     /app/tavro_library
COPY utils             /app/utils
COPY catalog_connector /app/catalog_connector
COPY catalog_connector /app/catalog_connector

ENV PYTHONPATH=/app

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
