<div align="center">

  <!-- LOGO: upload travo_logo.png to your repo and update the src below -->
  <img src="assets\images\travo_logo.png" alt="Tavro Logo" width="80" />

  <h1>Tavro Agent BizOps</h1>

  <p><em>Accelerating enterprise agent adoption through metadata-driven BizOps.</em></p>
  
  <div align="center">
  <img src="assets\images\agentbizops3.png" alt="Agent BizOps" width="400">
</div>

  <p>
    <a href="https://www.tavro.ai/tavro/"><strong> Free Cloud Trial</strong></a>
    &nbsp;·&nbsp;
    <a href="https://www.tavro.ai/contact-us/"><strong> Live Demo</strong></a>
    &nbsp;·&nbsp;
    <a href="https://tavrocommunity.slack.com/join/shared_invite/zt-3xowwir93-_QZV_jMAtFDkAAfrwY9RWQ#/shared-invite/email"><strong> Slack Community</strong></a>
    &nbsp;·&nbsp;
    <a href="https://www.youtube.com/@Tavro-AI"><strong> YouTube</strong></a>
  </p>
  <sub>Built with ♥ by <a href="https://tavro.ai">Tavro</a></sub>

  <hr />


</div>


Run the full Tavro platform on your own machine using Docker. No coding knowledge is required. Follow each step in order.

**What this sets up:**
- A Postgres database with all required schemas and extensions
- Tavro API (FastAPI)
- Temporal workflow engine
- MCP server with auth
- Worker for loading agent cards
- Tavro web app

---

## Prerequisites

You need these tools installed before you begin.

### 1. Docker Desktop

Docker Desktop runs all services in isolated containers.

| OS | Download |
|----|----------|
| Windows | https://www.docker.com/products/docker-desktop/ |
| macOS | https://www.docker.com/products/docker-desktop/ |
| Linux | https://docs.docker.com/engine/install/ |

After installing, open Docker Desktop and wait until it shows **Engine running**.

### 2. Git

Git is used to download this project.

| OS | Download / Command |
|----|--------------------|
| Windows | https://git-scm.com/download/win |
| macOS | Run `xcode-select --install` in Terminal |
| Linux (Debian/Ubuntu) | Run `sudo apt install git` in Terminal |

---

## Getting Started

### 1. Clone the repository

```bash
https://github.com/TavroOrg/tavro.git
cd tavro
```

### 2. Install Python dependencies

No local Python dependency setup is required for running the stack. Docker handles service dependencies.

### 3. Create local config files

Windows (PowerShell):

```powershell
Copy-Item env_sample.txt .env
Copy-Item config.yaml.example config.yaml
```

macOS / Linux:

```bash
cp env_sample.txt .env
cp config.yaml.example config.yaml
```

### 4. Fill in required values

Update `.env` (minimum):
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `OPENAI_API_KEY`
- `VITE_ZITADEL_ISSUER` (default local value is usually `http://localhost:8080`)

Update `config.yaml` (minimum):
- `secrets.OPENAI_API_KEY`

Optional `config.yaml` fields:
- `mcp.mcp_root_url` (set only for remote/public MCP usage)
- `catalog_connector.*` (only if you use connector ingestion)
- `oAuth.*` values (if your flow needs provider credentials)

---

## Configuration Notes

- `docker-compose.yml` is the source of truth for local service wiring.
- Postgres host port is `5433` on your machine (`5432` inside Docker).
- On first database initialization, the Postgres image executes all SQL files under `sql/`.

---

## Deployment

### Build and start all services

```bash
docker compose up --build -d
```

First run may take several minutes.

### Verify services

```bash
docker compose ps
```

You should see these core services up:
- `tavro-postgres`
- `risk-temporal`
- `tavro-api`
- `risk-mcp-server`
- `risk-worker`
- `tavro-app`
- `copilot-sdk`
- `zitadel-api`
- `zitadel-login`
- `zitadel-configure-app`
- `proxy`

---

## Post-Deployment

### Open local URLs

| Tool | URL | Purpose |
|------|-----|---------|
| Tavro app | http://localhost:9000 | Main UI |
| API health | http://localhost:8000/health | API health check |
| API docs (direct) | http://localhost:8000/docs | FastAPI docs |
| API docs (via app) | http://localhost:9000/docs | FastAPI docs via proxy |
| Temporal UI | http://localhost:8233/temporal | Workflow monitoring |
| MCP endpoint| http://localhost:9001/zitadel/mcp | MCP endpoint (auth required) |
| Zitadel | http://localhost:8080 | Auth system |

### Quick smoke test

```powershell
(Invoke-WebRequest -UseBasicParsing http://localhost:8000/health).StatusCode
(Invoke-WebRequest -UseBasicParsing http://localhost:9000/health).StatusCode
(Invoke-WebRequest -UseBasicParsing http://localhost:4001/health).StatusCode
```

Expected: all `200`.

MCP auth behavior check:
- `GET http://localhost:9001/zitadel/mcp` returns `401` until authenticated. This is expected.

### Load sample data (optional)

```bash
docker compose --profile manual run --rm risk-sample-loader
```

If you need more sample agents or AI Use Case examples, please reach out at info@tavro.ai.

### Run connector ingestion (optional)

```bash
docker compose --profile manual run --rm risk-connector
```




---

## Common Commands

View logs:

```bash
docker compose logs -f tavro-api
```

Stop all services:

```bash
docker compose down
```

Reset everything (deletes data volumes):

```bash
docker compose down -v
docker compose up --build -d
```

---

## Troubleshooting

- If Docker commands fail, ensure Docker Desktop is running.
- If `config.yaml` mount fails, ensure `config.yaml` is a file (not a directory).
- If MCP returns `401`, that is expected before auth.
- If you changed SQL/bootstrap logic and want DB init scripts to rerun, use a fresh Postgres volume (`docker compose down -v`).
- If any container exits, inspect logs with `docker compose logs <service-name>`.
