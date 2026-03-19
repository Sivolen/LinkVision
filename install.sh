#!/bin/bash
# LinkVision Installer for Ubuntu
# This script automates the installation of LinkVision web application
# Run with sudo or as root for full system integration (optional)
# Usage: ./install.sh [-p http://proxy:port]
set -e  # exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   LinkVision Installer for Ubuntu     ${NC}"
echo -e "${GREEN}========================================${NC}"

# Parse command line arguments
PROXY_ARG=""
while getopts "p:" opt; do
    case $opt in
        p)
            PROXY_ARG="$OPTARG"
            echo -e "${GREEN}Using proxy: $PROXY_ARG${NC}"
            ;;
        \?)
            echo -e "${RED}Invalid option: -$OPTARG${NC}"
            echo "Usage: $0 [-p http://proxy:port]"
            exit 1
            ;;
        :)
            echo -e "${RED}Option -$OPTARG requires an argument.${NC}"
            echo "Usage: $0 [-p http://proxy:port]"
            exit 1
            ;;
    esac
done

# Check if running as root (recommended for systemd setup)
if [[ $EUID -ne 0 ]]; then
    echo -e "${YELLOW}Warning: Not running as root. Systemd service installation will be skipped.${NC}"
    echo -e "${YELLOW}If you want to install systemd service later, run this script with sudo.${NC}"
    INSTALL_SERVICE=false
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
else
    INSTALL_SERVICE=true
    # If running as root, enforce installation directory to /opt/LinkVision
    SCRIPT_DIR="/opt/LinkVision"
    echo -e "${GREEN}Running as root. Target directory set to: $SCRIPT_DIR${NC}"
fi

# Ensure project directory exists and switch to it
mkdir -p "$SCRIPT_DIR"
cd "$SCRIPT_DIR"
echo -e "${GREEN}Project directory: $SCRIPT_DIR${NC}"

# Check Python version
echo -e "
${GREEN}Checking Python version...${NC}"
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Python3 not found. Installing...${NC}"
    apt update && apt install -y python3 python3-pip python3-venv
fi

PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PY_MAJOR=$(python3 -c 'import sys; print(sys.version_info.major)')
PY_MINOR=$(python3 -c 'import sys; print(sys.version_info.minor)')

if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 8 ]; }; then
    echo -e "${RED}Error: Python 3.8+ required, found ${PY_MAJOR}.${PY_MINOR}${NC}"
    exit 1
fi
echo -e "${GREEN}Python $PY_VERSION found.${NC}"

# Install system dependencies
echo -e "
${GREEN}Installing system dependencies...${NC}"
apt update
apt install -y git build-essential libssl-dev libffi-dev python3-dev

# Create virtual environment if not exists
echo -e "
${GREEN}Setting up Python virtual environment...${NC}"
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo -e "${GREEN}Virtual environment created.${NC}"
else
    echo -e "${YELLOW}Virtual environment already exists.${NC}"
fi

# Activate venv and install requirements
echo -e "
${GREEN}Installing Python dependencies...${NC}"
source venv/bin/activate
pip install --upgrade pip setuptools wheel

# Install requirements with proxy if specified
if [ -n "$PROXY_ARG" ]; then
    echo -e "${GREEN}Installing requirements with proxy: $PROXY_ARG${NC}"
    pip install --proxy "$PROXY_ARG" -r requirements.txt
else
    echo -e "${GREEN}Installing requirements (no proxy)...${NC}"
    pip install -r requirements.txt
fi

# Generate secret key if not present
echo -e "
${GREEN}Checking configuration...${NC}"
if [ ! -f "config.py" ]; then
    echo -e "${YELLOW}config.py not found. Creating from template...${NC}"
    cat > config.py <<EOF
import os
class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY') or '$(openssl rand -base64 32)'
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or 'sqlite:///webnetmap.db'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    UPLOAD_FOLDER = os.path.join(os.path.abspath(os.path.dirname(__file__)), 'static/uploads')
    VERSION = '1.0.0'
EOF
    echo -e "${GREEN}config.py created with random secret key.${NC}"
else
    echo -e "${GREEN}config.py already exists.${NC}"
fi

# Initialize database
echo -e "
${GREEN}Initializing database...${NC}"
export FLASK_APP=app.py
if [ -d "migrations" ]; then
    flask db upgrade || echo -e "${YELLOW}Flask-Migrate not configured, skipping.${NC}"
else
    echo -e "${YELLOW}No migrations folder found. Database will be created on first run.${NC}"
fi

# Create upload directories
echo -e "
${GREEN}Creating upload directories...${NC}"
mkdir -p static/uploads/icons static/uploads/maps

# Set permissions
echo -e "
${GREEN}Setting permissions...${NC}"
chmod -R 755 static/uploads

# Ask about systemd service
if [ "$INSTALL_SERVICE" = true ]; then
    echo -e "
${GREEN}Do you want to install LinkVision as a systemd service? (y/n)${NC}"
    read -r install_service_choice
    if [[ "$install_service_choice" =~ ^[Yy]$ ]]; then
        echo -e "${GREEN}Creating systemd service with symbolic link...${NC}"

        SERVICE_FILE_SRC="$SCRIPT_DIR/linkvision.service"
        SERVICE_FILE_LINK="/etc/systemd/system/linkvision.service"

        # Create service file in project directory
        cat > "$SERVICE_FILE_SRC" <<EOF
[Unit]
Description=LinkVision - Network Infrastructure Visualization
After=network.target

[Service]
User=root
Group=root
WorkingDirectory=$SCRIPT_DIR
Environment="PATH=$SCRIPT_DIR/venv/bin"
ExecStart=$SCRIPT_DIR/venv/bin/python app.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

        # Create symbolic link to /etc/systemd/system/
        ln -sf "$SERVICE_FILE_SRC" "$SERVICE_FILE_LINK"

        systemctl daemon-reload
        systemctl enable linkvision.service
        systemctl start linkvision.service

        echo -e "${GREEN}Service file created at: $SERVICE_FILE_SRC${NC}"
        echo -e "${GREEN}Symbolic link created at: $SERVICE_FILE_LINK${NC}"
        echo -e "Status: systemctl status linkvision.service"
    else
        echo -e "${YELLOW}Skipping systemd service installation.${NC}"
    fi
else
    echo -e "${YELLOW}Not root – skipping systemd service installation.${NC}"
fi

# Completion message
echo -e "
${GREEN}========================================${NC}"
echo -e "${GREEN}   Installation complete!                ${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e ""
echo -e "You can now run LinkVision manually:"
echo -e "  cd $SCRIPT_DIR"
echo -e "  source venv/bin/activate"
echo -e "  python app.py"
echo -e ""
echo -e "Or if you installed systemd service, it's already running."
echo -e "Access the web interface at: http://localhost:5000"
echo -e ""
echo -e "Default admin credentials:"
echo -e "  Username: admin"
echo -e "  Password: admin"
echo -e "${YELLOW}Please change the admin password after first login!${NC}"