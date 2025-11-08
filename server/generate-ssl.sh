#!/bin/bash

# ============================================
# SSL Certificate Generator for WebRTC Signaling Server
# ============================================

echo "🔐 WebRTC Signaling Server - SSL Certificate Generator"
echo "========================================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get server IP - cross-platform method
if command -v ip >/dev/null 2>&1; then
    # Linux systems with ip command
    SERVER_IP=$(ip route get 1 2>/dev/null | awk '{print $7}' | head -1)
elif command -v ifconfig >/dev/null 2>&1; then
    # macOS and older Linux systems with ifconfig
    SERVER_IP=$(ifconfig 2>/dev/null | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -Eo '([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -1)
else
    # Fallback to localhost
    SERVER_IP="127.0.0.1"
fi

# If still no IP found, use localhost
if [ -z "$SERVER_IP" ]; then
    SERVER_IP="127.0.0.1"
fi

echo -e "${YELLOW}📍 Detected Server IP: ${SERVER_IP}${NC}"
echo ""

# Ask for custom IP or domain
read -p "Press ENTER to use ${SERVER_IP}, or type custom IP/domain: " CUSTOM_ADDRESS

if [ -z "$CUSTOM_ADDRESS" ]; then
    ADDRESS=$SERVER_IP
else
    ADDRESS=$CUSTOM_ADDRESS
fi

echo -e "${GREEN}✅ Using address: ${ADDRESS}${NC}"
echo ""

# Create ssl directory
if [ ! -d "ssl" ]; then
    mkdir ssl
    echo -e "${GREEN}✅ Created ssl/ directory${NC}"
fi

# Generate certificate
echo -e "${YELLOW}🔧 Generating SSL certificate...${NC}"

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ssl/server.key \
  -out ssl/server.crt \
  -subj "/C=IT/ST=Lazio/L=Rome/O=Academic Project/CN=${ADDRESS}" \
  2>/dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ SSL certificate generated successfully!${NC}"
    echo ""
    echo "📄 Certificate Details:"
    echo "   - Key:  ssl/server.key"
    echo "   - Cert: ssl/server.crt"
    echo "   - Valid for: 365 days"
    echo "   - Common Name: ${ADDRESS}"
    echo ""
else
    echo -e "${RED}❌ Failed to generate certificate${NC}"
    exit 1
fi

# Update .env file
if [ -f ".env" ]; then
    echo -e "${YELLOW}🔧 Updating .env file...${NC}"

    # Check if SSL settings already exist
    if grep -q "ENABLE_SSL" .env; then
        # Update existing
        sed -i.bak 's/^ENABLE_SSL=.*/ENABLE_SSL=true/' .env
        sed -i.bak 's|^SSL_KEY_PATH=.*|SSL_KEY_PATH=./ssl/server.key|' .env
        sed -i.bak 's|^SSL_CERT_PATH=.*|SSL_CERT_PATH=./ssl/server.crt|' .env
        rm -f .env.bak 2>/dev/null
        echo -e "${GREEN}✅ Updated existing SSL configuration in .env${NC}"
    else
        # Add new
        echo "" >> .env
        echo "# SSL/TLS Configuration" >> .env
        echo "ENABLE_SSL=true" >> .env
        echo "SSL_KEY_PATH=./ssl/server.key" >> .env
        echo "SSL_CERT_PATH=./ssl/server.crt" >> .env
        echo -e "${GREEN}✅ Added SSL configuration to .env${NC}"
    fi
    echo ""
else
    echo -e "${YELLOW}⚠️  No .env file found. Creating...${NC}"
    cat > .env << EOF
# Essential settings
PORT=8080
ENABLE_SIP_GATEWAY=true
LOG_LEVEL=info

# SSL/TLS Configuration
ENABLE_SSL=true
SSL_KEY_PATH=./ssl/server.key
SSL_CERT_PATH=./ssl/server.crt

# Your SIP server
SIP_SERVER_HOST=192.168.1.212
SIP_SERVER_PORT=5060
SIP_DOMAIN=192.168.1.212

# RTPEngine
RTPENGINE_HOST=127.0.0.1
RTPENGINE_PORT=22222

# Network
PUBLIC_IP=auto

# Performance
MAX_SESSIONS=1000
HEARTBEAT_INTERVAL=30000
EOF
    echo -e "${GREEN}✅ Created .env file with SSL configuration${NC}"
    echo ""
fi

# Display connection info
echo "========================================================"
echo -e "${GREEN}✅ SSL Setup Complete!${NC}"
echo "========================================================"
echo ""
echo "🚀 Next Steps:"
echo ""
echo "1. Start the server:"
echo -e "   ${YELLOW}node signaling-server.js${NC}"
echo ""
echo "2. In your browser, accept the certificate:"
echo -e "   ${YELLOW}https://${ADDRESS}:8080${NC}"
echo ""
echo "3. Connect your WebRTC client using WSS:"
echo -e "   ${YELLOW}wss://${ADDRESS}:8080${NC}"
echo ""
echo "⚠️  IMPORTANT for LAN/Testing:"
echo "   - You MUST accept the self-signed certificate in browser first"
echo "   - Visit https://${ADDRESS}:8080 and click 'Advanced' → 'Accept Risk'"
echo "   - Do this on EVERY device that will use the signaling server"
echo ""
echo "📚 For more info, see: WSS_SETUP.md"
echo ""

# Test certificate
echo -e "${YELLOW}🔍 Verifying certificate...${NC}"
if command -v openssl >/dev/null 2>&1; then
    openssl x509 -in ssl/server.crt -text -noout | grep -E "Subject:|Issuer:|Not Before|Not After" 2>/dev/null
else
    echo "OpenSSL not available for detailed certificate verification"
fi
echo ""

echo -e "${GREEN}✨ Done!${NC}"
