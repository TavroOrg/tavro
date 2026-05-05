# Tavro Agent Catalog

Run the full Tavro platform on your own machine using Docker. No coding knowledge is required — just follow each step in order.

**What this sets up:**
- A Postgres database with all required schemas
- A Risk API (FastAPI)
- A Temporal workflow engine
- An MCP server
- A worker for loading agent cards

---

## Prerequisites

You need these tools installed before you begin.

### 1. Docker Desktop

Docker Desktop runs all services in isolated containers so nothing interferes with your machine.

| OS | Download |
|----|----------|
| Windows | https://www.docker.com/products/docker-desktop/ |
| macOS | https://www.docker.com/products/docker-desktop/ |
| Linux | https://docs.docker.com/engine/install/ |

After installing, **open Docker Desktop and wait until it shows "Engine running"** in the bottom-left corner. Docker must be running before any command below will work.

### 2. Git

Git is used to download this project.

| OS | Download / Command |
|----|--------------------|
| Windows | https://git-scm.com/download/win |
| macOS | Run `xcode-select --install` in Terminal |
| Linux (Debian/Ubuntu) | Run `sudo apt install git` in Terminal |

### 3. ngrok

ngrok is required to expose the MCP server publicly so cloud AI tools (Claude, ChatGPT) can reach it.

| OS | Steps |
|----|-------|
| Windows | Download from https://ngrok.com/download, run the installer, open a new PowerShell window |
| macOS | `brew install ngrok/ngrok/ngrok` (requires [Homebrew](https://brew.sh)) |
| Linux | `curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \| sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" \| sudo tee /etc/apt/sources.list.d/ngrok.list && sudo apt update && sudo apt install ngrok` |

Sign up for a free account at https://ngrok.com, then authenticate once:

```bash
ngrok config add-authtoken <your-token>
```

> Copy your Authtoken from the ngrok dashboard under **Your Authtoken → Copy**.

---

## Getting Started

### 1. Clone the Repository

Open a terminal (PowerShell on Windows, Terminal on macOS/Linux) and run:

```bash
git clone https://github.com/TavroOrg/tavro_open_source.git
cd tavro_open_source
```

If cloning fails, see GitHub's [troubleshooting guide](https://docs.github.com/en/repositories/creating-and-managing-repositories/troubleshooting-cloning-errors).

### 2. Install Python Dependencies

No Python dependencies are required for running the local stack — Docker handles all service dependencies.

### 3. Set Up GitHub Authentication

The MCP server uses GitHub OAuth to authenticate users. Before starting the stack, register a GitHub OAuth App and obtain your credentials.

Follow the setup guide at: https://gofastmcp.com/integrations/github

#### Step A — Create a GitHub OAuth App

1. Go to https://github.com/settings/developers
2. Click **OAuth Apps → New OAuth App**
3. Fill in the form:

| Field | Value |
|-------|-------|
| Application name | `Tavro MCP` (or any name you like) |
| Homepage URL | See table below |
| Authorization callback URL | See table below |

Use these values depending on how you are running the server:

| Mode | Homepage URL | Authorization callback URL |
|------|-------------|---------------------------|
| **Localhost** (local testing only) | `http://localhost:9000` | `http://localhost:9000/auth/callback` |
| **ngrok** (remote / cloud AI tools) | `https://abc123.ngrok-free.app` | `https://abc123.ngrok-free.app/auth/callback` |

> If you plan to connect cloud AI tools, start ngrok first (`ngrok http 9000`) to get your public URL, then create the OAuth App with the ngrok values.

4. Click **Register application**
5. Copy the **Client ID**
6. Click **Generate a new client secret** and copy the secret immediately (it is only shown once)

Required credentials: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

---

## Configuration

### Create `config.yaml`

A template called `config.yaml.example` is included. Copy it to create your config file:

**Windows (PowerShell):**
```powershell
Copy-Item config.yaml.example config.yaml
```

**macOS / Linux:**
```bash
cp config.yaml.example config.yaml
```

### Fill in Config Values

Open `config.yaml` in any text editor and replace the placeholder values with your real credentials:

| Field | What to put here |
|-------|-----------------|
| `secrets.OPENAI_API_KEY` | Your OpenAI API key (starts with `sk-`) |
| `catalog_connector.azure.*` | Your Azure AD app credentials (only needed for the connector feature) |
| `oAuth.GITHUB_CLIENT_ID` | Client ID from your GitHub OAuth App (Step 3 above) |
| `oAuth.GITHUB_CLIENT_SECRET` | Client secret from your GitHub OAuth App (Step 3 above) |
| `oAuth.JWT_SIGNING_KEY` | Any long random string you choose (e.g. `my-secret-key-2025-xyz`) |
| `mcp.mcp_root_url` | Leave empty for local use; set to your ngrok URL when connecting remotely |

Paste your GitHub OAuth credentials:

```yaml
oAuth:
  GITHUB_CLIENT_ID: "paste-your-client-id-here"
  GITHUB_CLIENT_SECRET: "paste-your-client-secret-here"
  JWT_SIGNING_KEY: "any-long-random-string-you-choose"
```

> **Tip:** The core services (database, API, workflows) start even if OAuth and connector fields are empty. Fill in only what you need.

---

## Pre-Deployment

### Start the ngrok Tunnel (for remote connections)

If you need cloud AI tools to reach your MCP server, open a **new terminal window** and run:

```bash
ngrok http 9000
```

ngrok displays a URL like:

```
Forwarding   https://abc123.ngrok-free.app -> http://localhost:9000
```

Copy the `https://...ngrok-free.app` URL, then update `config.yaml`:

```yaml
mcp:
  mcp_host: "localhost"
  mcp_port: "9000"
  mcp_root_url: "https://abc123.ngrok-free.app"
```

Keep this terminal window open while you use the MCP server remotely.

> **Free ngrok plan:** you get a new URL every time you restart ngrok. Each time, update both `mcp_root_url` in `config.yaml` **and** the callback URL in your GitHub OAuth App (Settings → Developer settings → OAuth Apps → your app → Edit), then restart the MCP server: `docker compose restart mcp-server`.

---

## Deployment

### Build and Start All Services

This single command builds all Docker images and starts every service in the background:

```bash
docker compose up --build -d
```

> The **first run takes 3–10 minutes** because Docker downloads base images and installs dependencies. Subsequent starts are much faster.

### Verify Services Are Running

```bash
docker compose ps
```

You should see these services with status **Up** or **running**:

| Service | Description |
|---------|-------------|
| `postgres-setup` | Database |
| `worker` | Agent card worker (idle, waiting for commands) |
| `fastapi` | Risk classification API |
| `temporal` | Workflow engine |
| `mcp-server` | MCP server |

If any service shows **Exit** or **Error**, check its logs: `docker compose logs <service-name>`

---

## Post-Deployment

### Open the Web UIs

| Tool | URL | Purpose |
|------|-----|---------|
| FastAPI docs | http://localhost/docs | Explore and test the Risk API |
| Temporal UI | http://localhost:8233/temporal | Monitor workflow executions |

### Load Sample Data (Optional)

Load the included sample agent cards into the database:

```bash
docker compose --profile manual run --rm sample-loader
```

This command runs once and exits automatically. It loads all JSON files from the `sample-data/` folder.

### Run the Connector (Optional)

Pull agent cards from external sources (e.g. Azure) using the credentials in your `config.yaml`:

```bash
docker compose --profile manual run --rm connector
```

> **Note:** If an agent does not have a description, the Temporal workflow will not be triggered for that agent.

### Connect to Claude (claude.ai)

Claude's web interface supports remote MCP servers directly.

1. Open https://claude.ai and sign in
2. Click your profile icon (top-right) → **Settings**
3. Go to **Connectors → Add Connector**
4. Enter a name (e.g. `Tavro`) and paste your MCP server URL:
   ```
   https://abc123.ngrok-free.app/mcp
   ```
   Replace with your actual ngrok URL. The `/mcp` path is required.
5. Click **Add** — Claude redirects you to GitHub to authorize the connection
6. Approve the GitHub OAuth prompt
7. Return to Claude — start a new conversation and the Tavro tools will be available

### Connect to ChatGPT (OpenAI)

1. Go to https://chatgpt.com and sign in
2. Click your profile icon → **Settings → Apps**
3. Click **Register an App** and enter your MCP server URL:
   ```
   https://abc123.ngrok-free.app/mcp
   ```
4. Authenticate via GitHub when prompted
5. Save and start a new chat — the Tavro tools will be listed in the tools panel

> **Using the OpenAI API directly?** Pass the MCP server URL under the `tools` section of your API request. See the [OpenAI MCP documentation](https://platform.openai.com/docs/guides/tools) for the payload format.

---

## Stopping the Stack

To stop all running services (data is preserved):

```bash
docker compose down
```

## Resetting from Scratch

To stop all services **and delete all data** (wipes the database):

```bash
docker compose down -v
docker compose up --build -d
```

> **Warning:** `down -v` permanently deletes all database data. Only use this if you want a completely clean slate.
