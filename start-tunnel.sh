#!/bin/bash
# Start Cloudflare Tunnel

# Kill any existing cloudflared tunnel processes
pkill -f "cloudflared tunnel.*8080" 2>/dev/null || true

sleep 2

# Start tunnel
exec cloudflared tunnel --url http://localhost:8080
