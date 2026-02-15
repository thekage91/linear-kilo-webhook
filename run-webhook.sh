#!/bin/bash
# Start Webhook Service

cd /home/davidesicignani/.openclaw/workspace/linear-kilo-webhook
source venv/bin/activate

export $(cat .env | xargs)

exec uvicorn src.main:app --host 0.0.0.0 --port 8080
