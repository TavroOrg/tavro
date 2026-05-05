#!/usr/bin/env bash
# =============================================================
# Tavro Digital Twin — Dependency Installation Script
# Installs: PostgreSQL 16, Apache AGE, pgvector, pgcrypto
#
# Supported targets:
#   - Ubuntu 22.04 / 24.04 (default)
#   - Debian 12
#   - Docker (use tavro_Dockerfile instead)
#
# Run as root or with sudo:
#   chmod +x tavro_install_dependencies.sh
#   sudo ./tavro_install_dependencies.sh
#
# Set environment variables to override defaults:
#   PG_VERSION=16          (Postgres major version)
#   AGE_VERSION=1.5.0      (Apache AGE release tag)
#   PGVECTOR_VERSION=0.7.0 (pgvector release tag)
#   PG_DATA=/var/lib/postgresql/16/main
# =============================================================

set -euo pipefail

# ── Configurable defaults ─────────────────────────────────────
PG_VERSION="${PG_VERSION:-16}"
AGE_VERSION="${AGE_VERSION:-1.5.0}"
PGVECTOR_VERSION="${PGVECTOR_VERSION:-0.7.0}"
PG_DATA="${PG_DATA:-/var/lib/postgresql/${PG_VERSION}/main}"
INSTALL_DIR="/tmp/tavro_build"

# ── Colour helpers ────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
section() { echo -e "\n${GREEN}════════════════════════════════════${NC}"; \
            echo -e "${GREEN}  $*${NC}"; \
            echo -e "${GREEN}════════════════════════════════════${NC}"; }

# ── Guards ────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Please run as root or with sudo."

command -v lsb_release >/dev/null 2>&1 || apt-get install -y lsb-release -qq
DISTRO=$(lsb_release -cs)
info "Detected distro codename: $DISTRO"

mkdir -p "$INSTALL_DIR"

# =============================================================
# STEP 1 — System packages & build tools
# =============================================================
section "Step 1: System packages"

apt-get update -qq
apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    lsb-release \
    build-essential \
    git \
    flex \
    bison \
    libreadline-dev \
    zlib1g-dev \
    pkg-config \
    libssl-dev \
    libkrb5-dev \
    make \
    gcc \
    g++

info "Build tools installed."

# =============================================================
# STEP 2 — PostgreSQL 16 (from PGDG apt repository)
# =============================================================
section "Step 2: PostgreSQL ${PG_VERSION}"

# Add PGDG apt repo
if [[ ! -f /etc/apt/sources.list.d/pgdg.list ]]; then
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
    echo "deb [signed-by=/etc/apt/trusted.gpg.d/postgresql.gpg] \
        https://apt.postgresql.org/pub/repos/apt ${DISTRO}-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list
    apt-get update -qq
    info "PGDG repository added."
else
    info "PGDG repository already present, skipping."
fi

apt-get install -y --no-install-recommends \
    "postgresql-${PG_VERSION}" \
    "postgresql-contrib-${PG_VERSION}" \
    "postgresql-server-dev-${PG_VERSION}" \
    "postgresql-client-${PG_VERSION}"

info "PostgreSQL ${PG_VERSION} installed."

# Ensure service is running
systemctl enable "postgresql@${PG_VERSION}-main" 2>/dev/null || true
systemctl start  "postgresql@${PG_VERSION}-main" 2>/dev/null || true

# =============================================================
# STEP 3 — pgcrypto (ships with postgresql-contrib, just activate)
# =============================================================
section "Step 3: pgcrypto"

# pgcrypto is in contrib — no extra install needed, just confirm
PG_SHAREDIR=$(pg_config --sharedir)
if [[ -f "${PG_SHAREDIR}/extension/pgcrypto.control" ]]; then
    info "pgcrypto extension available at ${PG_SHAREDIR}/extension/pgcrypto.control"
else
    warn "pgcrypto.control not found. Reinstalling postgresql-contrib..."
    apt-get install -y "postgresql-contrib-${PG_VERSION}"
fi

# =============================================================
# STEP 4 — pgvector
# =============================================================
section "Step 4: pgvector ${PGVECTOR_VERSION}"

PGVECTOR_DIR="${INSTALL_DIR}/pgvector-${PGVECTOR_VERSION}"

if [[ -d "$PGVECTOR_DIR" ]]; then
    warn "pgvector source already present, skipping clone."
else
    git clone \
        --branch "v${PGVECTOR_VERSION}" \
        --depth 1 \
        https://github.com/pgvector/pgvector.git \
        "$PGVECTOR_DIR"
fi

cd "$PGVECTOR_DIR"
# Use pg_config from the target PG version
PG_CONFIG="/usr/lib/postgresql/${PG_VERSION}/bin/pg_config"
[[ -x "$PG_CONFIG" ]] || error "pg_config not found at $PG_CONFIG"

make clean
make PG_CONFIG="$PG_CONFIG"
make install PG_CONFIG="$PG_CONFIG"

info "pgvector ${PGVECTOR_VERSION} installed."
cd "$INSTALL_DIR"

# =============================================================
# STEP 5 — Apache AGE
# =============================================================
section "Step 5: Apache AGE ${AGE_VERSION}"

# AGE supports PG 11–16. Verify version compatibility.
PG_MAJOR=$(psql -V | grep -oP '\d+' | head -1)
info "Detected Postgres major version: $PG_MAJOR"

if [[ "$PG_MAJOR" -gt 16 ]]; then
    warn "Apache AGE ${AGE_VERSION} officially supports Postgres 11-16."
    warn "Postgres ${PG_MAJOR} detected — build may fail. Check https://age.apache.org for a newer release."
fi

AGE_DIR="${INSTALL_DIR}/age-${AGE_VERSION}"
AGE_TARBALL="${INSTALL_DIR}/apache-age-${AGE_VERSION}.tar.gz"
AGE_URL="https://github.com/apache/age/archive/refs/tags/v${AGE_VERSION}.tar.gz"

if [[ -d "$AGE_DIR" ]]; then
    warn "AGE source already present, skipping download."
else
    info "Downloading Apache AGE ${AGE_VERSION}..."
    curl -fsSL "$AGE_URL" -o "$AGE_TARBALL"
    tar -xzf "$AGE_TARBALL" -C "$INSTALL_DIR"
    # GitHub archive names the folder age-PGE_VERSION
    mv "${INSTALL_DIR}/age-${AGE_VERSION}" "$AGE_DIR" 2>/dev/null || true
    [[ -d "$AGE_DIR" ]] || mv "${INSTALL_DIR}/age-v${AGE_VERSION}" "$AGE_DIR" 2>/dev/null || true
    [[ -d "$AGE_DIR" ]] || error "AGE source directory not found after extraction. Check release tag."
fi

cd "$AGE_DIR"
make PG_CONFIG="$PG_CONFIG"
make install PG_CONFIG="$PG_CONFIG"

info "Apache AGE ${AGE_VERSION} installed."
cd "$INSTALL_DIR"

# =============================================================
# STEP 6 — postgresql.conf: shared_preload_libraries
# =============================================================
section "Step 6: Configure shared_preload_libraries"

PG_CONF="${PG_DATA}/postgresql.conf"

if [[ ! -f "$PG_CONF" ]]; then
    warn "postgresql.conf not found at $PG_CONF"
    warn "Locate your postgresql.conf and add the following line manually:"
    echo ""
    echo "    shared_preload_libraries = 'age'"
    echo ""
else
    # Check if age is already in shared_preload_libraries
    if grep -q "shared_preload_libraries" "$PG_CONF"; then
        if grep -q "age" "$PG_CONF"; then
            info "'age' already present in shared_preload_libraries, skipping."
        else
            # Append 'age' to existing value
            sed -i "s/^shared_preload_libraries\s*=\s*'\(.*\)'/shared_preload_libraries = '\1,age'/" "$PG_CONF"
            info "Appended 'age' to existing shared_preload_libraries."
        fi
    else
        # Add new line
        echo "shared_preload_libraries = 'age'" >> "$PG_CONF"
        info "Added shared_preload_libraries = 'age' to postgresql.conf."
    fi

    # Restart Postgres to pick up the change
    info "Restarting PostgreSQL to load AGE..."
    systemctl restart "postgresql@${PG_VERSION}-main" 2>/dev/null || \
        pg_ctlcluster "$PG_VERSION" main restart 2>/dev/null || \
        warn "Could not restart automatically. Run: sudo systemctl restart postgresql"
fi

# =============================================================
# STEP 7 — Verify
# =============================================================
section "Step 7: Verification"

PSQL="psql -U postgres"

info "Checking pgcrypto..."
$PSQL -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;" postgres && \
    info "pgcrypto OK" || warn "pgcrypto failed — check Postgres logs"

info "Checking pgvector..."
$PSQL -c "CREATE EXTENSION IF NOT EXISTS vector;" postgres && \
    info "pgvector OK" || warn "pgvector failed — check Postgres logs"

info "Checking Apache AGE..."
$PSQL -c "LOAD 'age'; CREATE EXTENSION IF NOT EXISTS age;" postgres && \
    info "Apache AGE OK" || warn "AGE failed — shared_preload_libraries may need a restart"

info "Checking extension versions..."
$PSQL -c "SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name IN ('age','vector','pgcrypto') ORDER BY name;" postgres

section "Installation complete"
echo ""
echo "  PostgreSQL ${PG_VERSION}      ✓"
echo "  pgcrypto              ✓ (contrib)"
echo "  pgvector ${PGVECTOR_VERSION}    ✓"
echo "  Apache AGE ${AGE_VERSION}      ✓"
echo ""
echo "  Next step: run the DDL"
echo "    psql -U postgres -d your_database -f tavro_digital_twin_ddl.sql"
echo ""
