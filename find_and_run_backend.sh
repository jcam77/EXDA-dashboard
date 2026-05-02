#!/bin/bash
# find_and_run_backend.sh
# Advanced helper for remote Ollama host resolution.
# Usage: ./find_and_run_backend.sh <hostname> [start-command]
# Example: ./find_and_run_backend.sh lab-host.local "./run exda"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <hostname> [start-command]"
    echo "Example: $0 lab-host.local './run exda'"
    exit 1
fi

TARGET_HOSTNAME="$1"
START_CMD="${2:-./run exda}"

# Use timeout and handle ping failures gracefully
echo "Looking up IP address for $TARGET_HOSTNAME..."
IP=$(timeout 5 ping -c 1 "$TARGET_HOSTNAME" 2>/dev/null | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}' | head -1)

if [ -z "$IP" ]; then
    echo "Could not resolve IP for $TARGET_HOSTNAME."
    echo "Check if:"
    echo " - Target machine is online and reachable from this computer"
    echo " - Hostname is correct"
    echo " - DNS/mDNS resolution works (try: ping $TARGET_HOSTNAME manually)"
    exit 2
fi

echo "Resolved host IP: $IP"
echo "Setting OLLAMA_HOST to http://$IP:11434"
echo "Running: $START_CMD"

export OLLAMA_HOST="http://$IP:11434"

# Execute the command and capture exit code
$START_CMD
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo "Command failed with exit code: $EXIT_CODE"
    exit $EXIT_CODE
else
    echo "Command completed successfully"
fi
