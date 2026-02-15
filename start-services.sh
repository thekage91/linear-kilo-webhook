#!/bin/bash
# Start both webhook and tunnel services

cd /home/davidesicignani/.openclaw/workspace/linear-kilo-webhook
source venv/bin/activate

export $(grep -v '^#' .env | xargs)

echo "Starting webhook on port 8080..."
uvicorn src.main:app --host 0.0.0.0 --port 8080 &
WEBHOOK_PID=$!

echo "Starting cloudflare tunnel..."
cloudflared tunnel --url http://localhost:8080 &
TUNNEL_PID=$!

echo ""
echo "Services started:"
echo "  Webhook PID: $WEBHOOK_PID"
echo "  Tunnel PID: $TUNNEL_PID"
echo ""
echo "Press Ctrl+C to stop both services"

# Wait for both processes
wait $WEBHOOK_PID
wait $TUNNEL_PID
