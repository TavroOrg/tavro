# Tavro Local Stack

Run the full Tavro platform on your own machine using Docker. No coding knowledge is required — just follow each step in order.

**What this sets up:**
- A Postgres database with all required schemas
- A Risk API (FastAPI)
- A Temporal workflow engine
- An MCP server
- A worker for loading agent cards

---

## Prerequisites

You need two free tools installed before you begin.

### 1. Install Docker Desktop

Docker Desktop runs all services in isolated containers so nothing interferes with your machine.

| OS | Download |
|----|----------|
| Windows | https://www.docker.com/products/docker-desktop/ |
| macOS | https://www.docker.com/products/docker-desktop/ |
| Linux | https://docs.docker.com/engine/install/ |

After installing, **open Docker Desktop and wait until it shows "Engine running"** in the bottom-left corner. Docker must be running before any command below will work.

### 2. Install Git

Git is used to download this project.

| OS | Download / Command |
|----|--------------------|
| Windows | https://git-scm.com/download/win |
| macOS | Run `xcode-select --install` in Terminal |
| Linux (Debian/Ubuntu) | Run `sudo apt install git` in Terminal |

---

## Step 1 — Download the project

Open a terminal (PowerShell on Windows, Terminal on macOS/Linux) and run:

```bash
git clone https://github.com/TavroOrg/tavro_open_source.git
cd tavro_open_source
```

---

## Step 2 — Create your config file

The project needs a `config.yaml` file with your credentials and settings. A template called `config.yaml.example` is included.

**Windows (PowerShell):**
```powershell
Copy-Item config.yaml.example config.yaml
```

**macOS / Linux:**
```bash
cp config.yaml.example config.yaml
```

---

## Step 3 — Fill in your config values

Open `config.yaml` in any text editor (Notepad, VS Code, TextEdit, nano, etc.) and replace the placeholder values with your real credentials.

**Key fields to fill in:**

| Field | What to put here |
|-------|-----------------|
| `secrets.OPENAI_API_KEY` | Your OpenAI API key (starts with `sk-`) |
| `catalog_connector.azure.*` | Your Azure AD app credentials (only needed for the connector feature) |
| `oAuth.GITHUB_CLIENT_ID` | From your GitHub OAuth App — see the [GitHub OAuth Setup](#github-oauth-setup-required-for-mcp-authentication) section |
| `oAuth.GITHUB_CLIENT_SECRET` | From your GitHub OAuth App — see the [GitHub OAuth Setup](#github-oauth-setup-required-for-mcp-authentication) section |
| `oAuth.JWT_SIGNING_KEY` | Any long random string you choose (e.g. `my-secret-key-2025-xyz`) |
| `mcp.mcp_root_url` | Leave empty for local use; set to your ngrok URL when connecting remotely |

> **Tip:** The core services (database, API, workflows) start even if OAuth and connector fields are empty. Fill in only what you need.

---

## Step 4 — Build and start all services

This single command builds all Docker images and starts every service in the background. Your terminal stays free.

```bash
docker compose up --build -d
```

> The **first run takes 3–10 minutes** because Docker downloads base images and installs dependencies. Subsequent starts are much faster.

---

## Step 5 — Verify everything is running

Check that all containers started successfully:

```bash
docker compose ps
```

You should see these services listed with status **Up** or **running**:

| Service | Description |
|---------|-------------|
| `postgres-setup` | Database |
| `worker` | Agent card worker (idle, waiting for commands) |
| `fastapi` | Risk classification API |
| `temporal` | Workflow engine |
| `mcp-server` | MCP server |

If any service shows **Exit** or **Error**, see the [Troubleshooting](#troubleshooting) section below.

---

## Step 6 — Open the web UIs

Once all services are up, open these URLs in your browser:

| Tool | URL | Purpose |
|------|-----|---------|
| FastAPI docs | http://localhost/docs | Explore and test the Risk API |
| Temporal UI | http://localhost:8233/temporal | Monitor workflow executions |

---

## Step 7 — Load sample data (optional)

To load the included sample agent cards into the database, run:

```bash
docker compose --profile manual run --rm sample-loader
```

This command runs once and exits automatically. It loads all JSON files from the `sample-data/` folder.

---

## Step 8 — Run the connector (optional)

The connector pulls agent cards from external sources (e.g. Azure) using the credentials in your `config.yaml`.

```bash
docker compose --profile manual run --rm connector
```

This also runs once and exits automatically.

> **Note:** If an agent does not have a description, the Temporal workflow will not be triggered for that agent.

---

## GitHub OAuth Setup (Required for MCP Authentication)

The MCP server uses GitHub OAuth to authenticate users. You must create a GitHub OAuth App and paste its credentials into `config.yaml` before the MCP server will accept connections.

### Step A — Create a GitHub OAuth App

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
| **Localhost** (local testing only) | `http://localhost:9000` | `http://localhost:9000/oauth/callback` |
| **ngrok** (remote / cloud AI tools) | `https://abc123.ngrok-free.app` | `https://abc123.ngrok-free.app/oauth/callback` |

> If you plan to use ngrok, complete the ngrok setup in the next section first to get your public URL, then come back and create the OAuth App with the ngrok values.

4. Click **Register application**
5. On the next page, copy the **Client ID**
6. Click **Generate a new client secret** and copy the secret immediately (it is only shown once)

### Step B — Add credentials to config.yaml

Open `config.yaml` and paste the values you copied:

```yaml
oAuth:
  GITHUB_CLIENT_ID: "paste-your-client-id-here"
  GITHUB_CLIENT_SECRET: "paste-your-client-secret-here"
  JWT_SIGNING_KEY: "any-long-random-string-you-choose"
```

The `JWT_SIGNING_KEY` can be any string you invent — it is used to sign login tokens internally. Make it long and random (e.g. `my-tavro-secret-key-2025-abc123xyz`).

### Step C — Restart the MCP server to apply the new credentials

```bash
docker compose restart mcp-server
```

> If you later switch between localhost and ngrok, you must **update the GitHub OAuth App's callback URL** on GitHub (Settings → Developer settings → OAuth Apps → your app → Edit) AND update `config.yaml`, then restart the MCP server again.

---

## Expose the MCP Server Publicly with ngrok

By default the MCP server is only reachable on your own machine. To connect it to cloud AI tools like **Claude** or **ChatGPT**, you need a public URL. ngrok creates a secure tunnel from the internet to your local machine in one command — no server or firewall changes required.

### Step A — Install ngrok

| OS | Command / Steps |
|----|-----------------|
| **Windows** | Download the installer from https://ngrok.com/download, run it, then open a new PowerShell window |
| **macOS** | `brew install ngrok/ngrok/ngrok` (requires [Homebrew](https://brew.sh)) |
| **Linux** | `curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \| sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" \| sudo tee /etc/apt/sources.list.d/ngrok.list && sudo apt update && sudo apt install ngrok` |

### Step B — Authenticate ngrok (one-time setup)

1. Sign up for a free account at https://ngrok.com
2. Copy your **Authtoken** from the ngrok dashboard (Your Authtoken → Copy)
3. Run this command (replace `<your-token>` with your actual token):

```bash
ngrok config add-authtoken <your-token>
```

### Step C — Start the ngrok tunnel

Make sure your Docker stack is already running, then open a **new terminal window** and run:

```bash
ngrok http 9000
```

ngrok will display a screen like this:

```
Forwarding   https://abc123.ngrok-free.app -> http://localhost:9000
```

**Copy the `https://...ngrok-free.app` URL** — you need it in the next step and for the GitHub OAuth App.

> This terminal window must stay open while you use the MCP server remotely. Use a separate window for all other commands.

### Step D — Set the public URL in config.yaml

Open `config.yaml` and paste the ngrok URL into the `mcp_root_url` field:

```yaml
mcp:
  mcp_host: "localhost"
  mcp_port: "9000"
  mcp_root_url: "https://abc123.ngrok-free.app"
```

Then apply the change with a container restart (no rebuild needed):

```bash
docker compose restart mcp-server
```

> **Free ngrok plan:** you get a new URL every time you restart ngrok. Each time, update both `mcp_root_url` in `config.yaml` **and** the callback URL in your GitHub OAuth App, then run `docker compose restart mcp-server`.

---

## Connect to Claude (claude.ai)

Claude's web interface supports remote MCP servers directly. No desktop app required.

**Before you begin:** complete the [GitHub OAuth Setup](#github-oauth-setup-required-for-mcp-authentication) and [ngrok setup](#expose-the-mcp-server-publicly-with-ngrok) above. The MCP server must be publicly reachable.

1. Open https://claude.ai in your browser and sign in
2. Click your profile icon (top-right) → **Settings**
3. Go to **Connectors** → **Add Connector**
4. Enter a name (e.g. `Tavro`) and paste your MCP server URL:

```
https://abc123.ngrok-free.app/mcp
```

Replace `abc123.ngrok-free.app` with your actual ngrok URL. The `/mcp` path at the end is required.

5. Click **Add** — Claude will redirect you to GitHub to authorize the connection
6. Approve the GitHub OAuth prompt
7. Return to Claude — start a new conversation and the Tavro tools will be available (look for the tools icon or type `use tavro`)

---

## Connect to ChatGPT (OpenAI)

**Before you begin:** complete the [GitHub OAuth Setup](#github-oauth-setup-required-for-mcp-authentication) and [ngrok setup](#expose-the-mcp-server-publicly-with-ngrok) above.

1. Go to https://chatgpt.com and sign in
2. Click your profile icon → **Settings → Apps**
3. Click **Register an App** and enter your MCP server URL:

```
https://abc123.ngrok-free.app/mcp
```

Replace with your actual ngrok URL. The `/mcp` path is required.

4. Authenticate via GitHub when prompted
5. Save and start a new chat — the Tavro tools will be listed in the tools panel

> **Using the OpenAI API directly?** Pass the MCP server URL under the `tools` section of your API request. See the [OpenAI MCP documentation](https://platform.openai.com/docs/guides/tools) for the payload format.

---

## Stopping the stack

To stop all running services (data is preserved):

```bash
docker compose down
```

---

## Resetting from scratch

To stop all services **and delete all data** (wipes the database):

```bash
docker compose down -v
docker compose up --build -d
```

> **Warning:** `down -v` permanently deletes all database data. Only use this if you want a completely clean slate.

---

## How data flows

```
sample-loader / connector
        │
        ▼
   worker.py  ──── upserts core tables (Steps 1–18) ──▶  Postgres
        │
        ▼
  FastAPI POST /classify-risk
        │
        ▼
  Temporal Workflow  ──── writes risk data ──▶  Postgres (risk_management schema)
                     └─── refreshes curated.agent_360
```

> Inside Docker, services talk to each other by service name (e.g. `http://fastapi:80`), not `localhost`. This is handled automatically — you do not need to change anything.

---

## Troubleshooting

**A service shows "Exit" in `docker compose ps`**

View its logs to see the error:
```bash
docker compose logs <service-name>
# Example:
docker compose logs fastapi
```

**"Cannot connect to the Docker daemon" error**

Docker Desktop is not running. Open Docker Desktop and wait for "Engine running" before retrying.

**Port already in use (e.g. port 80 or 5432)**

Another application on your machine is using that port. Either stop that application or check with your team for an alternate port configuration.

**First build fails halfway through**

Re-run the same command — Docker will resume from where it left off:
```bash
docker compose up --build -d
```

**Want to see live logs for all services:**
```bash
docker compose logs -f
```
Press `Ctrl + C` to stop watching logs (services keep running).
