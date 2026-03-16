#!/bin/bash
# LinkVision Installer for Ubuntu
# This script automates the installation of LinkVision web application
# Run with sudo or as root for full system integration (optional)

set -e  # exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   LinkVision Installer for Ubuntu     ${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if running as root (recommended for systemd setup)
if [[ $EUID -ne 0 ]]; then
   echo -e "${YELLOW}Warning: Not running as root. Systemd service installation will be skipped.${NC}"
   echo -e "${YELLOW}If you want to install systemd service later, run this script with sudo.${NC}"
   INSTALL_SERVICE=false
else
   INSTALL_SERVICE=true
fi

# Get script directory (where this script is located)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${GREEN}Project directory: $SCRIPT_DIR${NC}"

# Check Python version
echo -e "\n${GREEN}Checking Python version...${NC}"
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Python3 not found. Installing...${NC}"
    apt update && apt install -y python3 python3-pip python3-venv
fi

PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
if (( $(echo "$PY_VERSION < 3.8" | bc -l) )); then
    echo -e "${RED}Error: Python 3.8+ required, found $PY_VERSION${NC}"
    exit 1
fi
echo -e "${GREEN}Python $PY_VERSION found.${NC}"

# Install system dependencies
echo -e "\n${GREEN}Installing system dependencies...${NC}"
apt update
apt install -y git build-essential libssl-dev libffi-dev python3-dev

# Create virtual environment if not exists
echo -e "\n${GREEN}Setting up Python virtual environment...${NC}"
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo -e "${GREEN}Virtual environment created.${NC}"
else
    echo -e "${YELLOW}Virtual environment already exists.${NC}"
fi

# Activate venv and install requirements
echo -e "\n${GREEN}Installing Python dependencies...${NC}"
source venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt

# Generate secret key if not present
echo -e "\n${GREEN}Checking configuration...${NC}"
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
echo -e "\n${GREEN}Initializing database...${NC}"
export FLASK_APP=app.py
if [ -d "migrations" ]; then
    flask db upgrade || echo -e "${YELLOW}Flask-Migrate not configured, skipping.${NC}"
else
    echo -e "${YELLOW}No migrations folder found. Database will be created on first run.${NC}"
fi

# Create upload directories
echo -e "\n${GREEN}Creating upload directories...${NC}"
mkdir -p static/uploads/icons static/uploads/maps

# Set permissions
echo -e "\n${GREEN}Setting permissions...${NC}"
chmod -R 755 static/uploads

# Ask about systemd service
if [ "$INSTALL_SERVICE" = true ]; then
    echo -e "\n${GREEN}Do you want to install LinkVision as a systemd service? (y/n)${NC}"
    read -r install_service_choice
    if [[ "$install_service_choice" =~ ^[Yy]$ ]]; then
        echo -e "${GREEN}Creating systemd service...${NC}"
        SERVICE_FILE="/etc/systemd/system/linkvision.service"
        cat > "$SERVICE_FILE" <<EOF
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
        systemctl daemon-reload
        systemctl enable linkvision.service
        systemctl start linkvision.service
        echo -e "${GREEN}Service installed and started.${NC}"
        echo -e "Status: systemctl status linkvision.service"
    else
        echo -e "${YELLOW}Skipping systemd service installation.${NC}"
    fi
else
    echo -e "${YELLOW}Not root – skipping systemd service installation.${NC}"
fi

# Completion message
echo -e "\n${GREEN}========================================${NC}"
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