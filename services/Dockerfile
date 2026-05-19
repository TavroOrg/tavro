# syntax=docker/dockerfile:1.6
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt/lists \
    apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Temporal CLI
RUN curl -sSL https://temporal.download/cli.sh | bash
ENV PATH="/root/.temporalio/bin:${PATH}"

WORKDIR /app
ENV PYTHONPATH=/app

COPY services/requirements.txt /app/requirements.txt
COPY services/requirements-postgres.txt /app/requirements-postgres.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --default-timeout=120 --retries 10 -r /app/requirements.txt -r /app/requirements-postgres.txt

COPY services /app/services
COPY utils /app/utils
COPY config.yaml.example /app/config.yaml.example

EXPOSE 80
EXPOSE 7233
EXPOSE 8233

CMD ["python", "-m", "services.app"]
