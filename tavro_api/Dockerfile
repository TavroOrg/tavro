FROM python:3.12-slim

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends curl libpq-dev gcc && \
    rm -rf /var/lib/apt/lists/*

# Install Temporal CLI (used by the embedded worker)
RUN curl -sSL https://temporal.download/cli.sh | bash
ENV PATH="/root/.temporalio/bin:${PATH}"

WORKDIR /app

# ── Install Python dependencies ───────────────────────────────────────────────
COPY tavro_api/requirements.txt /tmp/requirements.txt
COPY tavro-python-stack/services/requirements.txt /tmp/requirements-risk.txt
COPY tavro-python-stack/services/requirements-postgres.txt /tmp/requirements-postgres.txt
COPY tavro-python-stack/dist/tavro_agent_card-0.1.1-py3-none-any.whl /tmp/

RUN pip install  \
      -r /tmp/requirements.txt \
      -r /tmp/requirements-risk.txt \
      -r /tmp/requirements-postgres.txt && \
    pip install /tmp/tavro_agent_card-0.1.1-py3-none-any.whl

# ── Copy Digital Twin API source ─────────────────────────────────────────────
COPY tavro_api/ /app/

# ── Copy Risk stack source (keeps original import paths intact) ───────────────
COPY tavro-python-stack/services /app/services
COPY tavro-python-stack/utils    /app/utils
COPY tavro-python-stack/config.yaml.example /app/config.yaml.example

ENV PYTHONPATH=/app

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
