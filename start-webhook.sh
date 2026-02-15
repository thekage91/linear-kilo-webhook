#!/bin/bash
# Start Linear Kilo Webhook Service

cd /home/davidesicignani/.openclaw/workspace/linear-kilo-webhook
source venv/bin/activate

# Kill any existing uvicorn processes on port 8080
pkill -f "uvicorn.*:8080" 2>/dev/null || true

# Start webhook service
exec uvicorn src.main:app --host 0.0.0.0 --port 8080 --log-level info
