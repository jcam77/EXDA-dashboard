#!/bin/bash
# find_and_run_backend.sh
# Usage: ./find_and_run_backend.sh <mac-hostname> [backend-command]
# Example: ./find_and_run_backend.sh your-mac.local "run v0.2"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <mac-hostname> [backend-command]"
    echo "Example: $0 your-mac.local 'run v0.2'"
    exit 1
fi

MAC_HOSTNAME="$1"
BACKEND_CMD="${2:-run v0.2}"

# Use timeout and handle ping failures gracefully
echo "Looking up IP address for $MAC_HOSTNAME..."
IP=$(timeout 5 ping -c 1 "$MAC_HOSTNAME" 2>/dev/null | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}' | head -1)

if [ -z "$IP" ]; then
    echo "❌ Could not resolve IP for $MAC_HOSTNAME."
    echo "   Check if:"
    echo "   - Your Mac is online and connected to the same network"
    echo "   - Hostname is correct (System Settings > Sharing on Mac)"
    echo "   - mDNS/Bonjour is working (try: ping $MAC_HOSTNAME manually)"
    exit 2
fi

echo "✅ Your Mac's current IP is: $IP"
echo "🔧 Setting OLLAMA_HOST to http://$IP:11434"
echo "🚀 Running: $BACKEND_CMD"

export OLLAMA_HOST="http://$IP:11434"

# Execute the command and capture exit code
$BACKEND_CMD
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo "❌ Command failed with exit code: $EXIT_CODE"
    exit $EXIT_CODE
else
    echo "✅ Command completed successfully"
fi

