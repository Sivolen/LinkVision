#!/usr/bin/env bash
# LinkVision — installer for Ubuntu/Debian
# Usage: sudo ./install.sh
# Optional environment variables:
#   LINKVISION_INSTALL_SERVICE=true|false
#   LINKVISION_PORT=8005
#   LINKVISION_HTTPS=true|false
#   LINKVISION_BEHIND_PROXY=true|false
#   LINKVISION_PYTHON=/usr/bin/python3
#   http/https proxy: use -p http://proxy:port

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}$*${NC}"; }
warn() { echo -e "${YELLOW}$*${NC}"; }
error() { echo -e "${RED}$*${NC}" >&2; }

usage() {
    cat <<USAGE
Usage: $0 [-p http://proxy:port]

Environment variables:
  LINKVISION_INSTALL_SERVICE=true|false  Install/start systemd service (root only)
  LINKVISION_PORT=8005                   Production HTTP port
  LINKVISION_HTTPS=true|false            Set Secure cookies for HTTPS
  LINKVISION_BEHIND_PROXY=true|false     Trust X-Forwarded-* from reverse proxy
  LINKVISION_PYTHON=/path/to/python3     Python interpreter (default: python3)
USAGE
}

PROXY_ARG=""
while getopts ":p:h" opt; do
    case "$opt" in
        p) PROXY_ARG="$OPTARG" ;;
        h) usage; exit 0 ;;
        :) error "Option -$OPTARG requires an argument."; usage; exit 1 ;;
        \?) error "Invalid option: -$OPTARG"; usage; exit 1 ;;
    esac
done

# Resolve the actual checkout directory instead of assuming /opt/LinkVision.
# This also makes the installer work when the repository lives elsewhere.
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f "$SCRIPT_DIR/requirements.txt" || ! -f "$SCRIPT_DIR/app.py" ]]; then
    error "This script must be run from a complete LinkVision checkout."
    error "Missing requirements.txt or app.py in: $SCRIPT_DIR"
    exit 1
fi

if [[ $EUID -eq 0 ]]; then
    SUDO=""
    INSTALL_SERVICE_DEFAULT="true"
else
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    else
        SUDO=""
    fi
    INSTALL_SERVICE_DEFAULT="false"
fi

if ! command -v apt-get >/dev/null 2>&1; then
    error "apt-get not found. This installer supports Ubuntu/Debian systems."
    exit 1
fi

if [[ -n "$SUDO" ]]; then
    # Fail early with a useful message instead of halfway through installation.
    if ! sudo -v; then
        error "Administrator privileges are required to install system packages."
        exit 1
    fi
elif [[ $EUID -ne 0 ]]; then
    warn "Running without root privileges. System packages cannot be installed and systemd setup will be skipped."
fi

LINKVISION_PORT="${LINKVISION_PORT:-8005}"
LINKVISION_HTTPS="${LINKVISION_HTTPS:-false}"
LINKVISION_BEHIND_PROXY="${LINKVISION_BEHIND_PROXY:-false}"
INSTALL_SERVICE="${LINKVISION_INSTALL_SERVICE:-$INSTALL_SERVICE_DEFAULT}"
PYTHON_BIN="${LINKVISION_PYTHON:-python3}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    info "Python interpreter not found; installing Python 3 and venv support..."
    "$SUDO" apt-get update
    "$SUDO" apt-get install -y python3 python3-pip python3-venv
fi

PY_VERSION="$($PYTHON_BIN -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")')"
PY_MAJOR="$($PYTHON_BIN -c 'import sys; print(sys.version_info.major)')"
PY_MINOR="$($PYTHON_BIN -c 'import sys; print(sys.version_info.minor)')"

if [[ "$PY_MAJOR" -lt 3 || ( "$PY_MAJOR" -eq 3 && "$PY_MINOR" -lt 10 ) ]]; then
    error "Python 3.10+ is required; found $PY_VERSION."
    exit 1
fi
info "Python $PY_VERSION found."

info "Installing system build dependencies..."
"$SUDO" apt-get update
"$SUDO" apt-get install -y git build-essential libssl-dev libffi-dev python3-dev

info "Creating/updating Python virtual environment..."
if [[ ! -x "$SCRIPT_DIR/venv/bin/python" ]]; then
    "$PYTHON_BIN" -m venv "$SCRIPT_DIR/venv"
else
    info "Virtual environment already exists."
fi

VENV_PYTHON="$SCRIPT_DIR/venv/bin/python"
VENV_PIP="$SCRIPT_DIR/venv/bin/pip"

info "Installing Python dependencies..."
"$VENV_PIP" install --upgrade pip setuptools wheel
if [[ -n "$PROXY_ARG" ]]; then
    "$VENV_PIP" install --proxy "$PROXY_ARG" -r requirements.txt
else
    "$VENV_PIP" install -r requirements.txt
fi

# Create .env before the first migration/startup. This fixes the common
# standalone-install problem where Secure cookies are enabled on plain HTTP.
# Production behind HTTPS should use LINKVISION_HTTPS=true.
if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
    SECRET_KEY="$($VENV_PYTHON -c 'import secrets; print(secrets.token_hex(32))')"
    cat > "$SCRIPT_DIR/.env" <<ENV
SECRET_KEY=$SECRET_KEY
SESSION_COOKIE_SECURE=$LINKVISION_HTTPS
BEHIND_PROXY=$LINKVISION_BEHIND_PROXY
LOG_LEVEL=INFO
ENV
    chmod 600 "$SCRIPT_DIR/.env"
    info ".env created with a random SECRET_KEY."
else
    chmod 600 "$SCRIPT_DIR/.env"
    info ".env already exists; existing settings were preserved."
fi

# Read DATABASE_URL from .env when it was not exported by the shell. The
# migration entrypoint itself reads process environment, so export only this
# value here; the application loads the full .env during startup.
if [[ -z "${DATABASE_URL:-}" && -f "$SCRIPT_DIR/.env" ]]; then
    ENV_DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$SCRIPT_DIR/.env" | head -n 1)"
    if [[ -n "$ENV_DATABASE_URL" ]]; then
        export DATABASE_URL="$ENV_DATABASE_URL"
    fi
fi

info "Preparing database schema..."
if [[ "${DATABASE_URL:-}" == postgresql://* || "${DATABASE_URL:-}" == postgres://* ]]; then
    warn "PostgreSQL detected. The installer does not mutate an existing PostgreSQL schema."
    warn "For an existing database, apply the supported schema migration before starting LinkVision."
else
    chmod +x "$SCRIPT_DIR/apply_migrations.sh"
    "$SCRIPT_DIR/apply_migrations.sh"
fi

info "Creating upload/log directories..."
mkdir -p "$SCRIPT_DIR/static/uploads/icons" \
         "$SCRIPT_DIR/static/uploads/maps" \
         "$SCRIPT_DIR/logs"
chmod 755 "$SCRIPT_DIR/static/uploads" "$SCRIPT_DIR/static/uploads/icons" "$SCRIPT_DIR/static/uploads/maps"

if [[ "$INSTALL_SERVICE" == "true" && $EUID -eq 0 ]]; then
    if ! command -v systemctl >/dev/null 2>&1; then
        error "systemctl not found; cannot install the systemd service."
        exit 1
    fi

    SERVICE_FILE="$SCRIPT_DIR/linkvision.service"
    cat > "$SERVICE_FILE" <<EOF_SERVICE
[Unit]
Description=LinkVision - Network Infrastructure Visualization
After=network.target

[Service]
User=root
Group=root
WorkingDirectory=$SCRIPT_DIR
Environment="PATH=$SCRIPT_DIR/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="PYTHONPATH=$SCRIPT_DIR"
Environment="FLASK_ENV=production"
Environment="FLASK_APP=app.py"
ExecStart=$SCRIPT_DIR/venv/bin/gunicorn -k eventlet -w 1 -b 0.0.0.0:$LINKVISION_PORT wsgi:app
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=LinkVision
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF_SERVICE

    ln -sf "$SERVICE_FILE" /etc/systemd/system/linkvision.service
    systemctl daemon-reload
    systemctl enable linkvision.service
    systemctl restart linkvision.service
    info "systemd service installed and started."
else
    warn "systemd installation skipped."
fi

echo
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}       LinkVision installation OK       ${NC}"
echo -e "${GREEN}========================================${NC}"
echo
info "Project: $SCRIPT_DIR"
echo "Production port: $LINKVISION_PORT"
echo "HTTPS cookies: $LINKVISION_HTTPS"
echo "Behind proxy:  $LINKVISION_BEHIND_PROXY"
echo
echo "Manual start:"
echo "  cd $SCRIPT_DIR"
echo "  $SCRIPT_DIR/venv/bin/python app.py"
echo
echo "Production/systemd logs:"
echo "  sudo journalctl -u linkvision.service -n 50"
echo
echo "First admin password (printed once by the application):"
echo "  sudo journalctl -u linkvision.service -n 100 | grep -A2 'Temporary admin password'"
echo
if [[ "$INSTALL_SERVICE" != "true" || $EUID -ne 0 ]]; then
    warn "If this is a production HTTPS deployment, set SESSION_COOKIE_SECURE=True and BEHIND_PROXY=True in .env before exposing the application."
fi
