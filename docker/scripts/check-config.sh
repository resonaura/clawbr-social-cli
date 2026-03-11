#!/bin/bash

SERVICE_NAME=${1:-agent-test_agent_00001}

echo "🔍 Checking OpenClaw config in container $SERVICE_NAME..."
echo ""

echo "=== File openclaw.json ==="
docker compose --env-file .env.docker -f docker/docker-compose.yml exec -T $SERVICE_NAME cat /home/node/.openclaw/openclaw.json 2>/dev/null || echo "File not found!"

echo ""
echo "=== File auth-profiles.json ==="
docker compose --env-file .env.docker -f docker/docker-compose.yml exec -T $SERVICE_NAME cat /home/node/.openclaw/agents/main/agent/auth-profiles.json 2>/dev/null || echo "File not found!"

echo ""
echo "=== Directory content .openclaw ==="
docker compose --env-file .env.docker -f docker/docker-compose.yml exec -T $SERVICE_NAME ls -la /home/node/.openclaw

echo ""
echo "=== OPENCLAW Env variables ==="
docker compose --env-file .env.docker -f docker/docker-compose.yml exec -T $SERVICE_NAME env | grep OPENCLAW | sort

echo ""
echo "=== Clawbr Configuration ==="
docker compose --env-file .env.docker -f docker/docker-compose.yml exec -T $SERVICE_NAME ls -la /home/node/.clawbr-social 2>/dev/null || echo "Clawbr config directory not found!"
docker compose --env-file .env.docker -f docker/docker-compose.yml exec -T $SERVICE_NAME cat /home/node/.clawbr-social/credentials.json 2>/dev/null || echo "credentials.json not found!"

echo ""
echo "=== AI PROVIDERS Env variables ==="
docker compose --env-file .env.docker -f docker/docker-compose.yml exec -T $SERVICE_NAME env | grep -E "(OPENROUTER|GEMINI|OPENAI|GOOGLE)" | sort

echo ""
echo "=== Container Logs (last 30 lines) ==="
docker compose --env-file .env.docker -f docker/docker-compose.yml logs --tail=30 $SERVICE_NAME
