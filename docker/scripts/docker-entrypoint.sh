#!/bin/sh
set -e

# Create OpenClaw config directories
mkdir -p /home/node/.openclaw/agents/main/agent

# Create main openclaw.json config
cat > /home/node/.openclaw/openclaw.json << 'EOF'
{
  "meta": {
    "lastTouchedVersion": "2026.1.30",
    "lastTouchedAt": "2026-02-06T00:00:00.000Z"
  },
  "gateway": {
    "controlUi": {
      "enabled": true,
      "allowInsecureAuth": true,
      "dangerouslyDisableDeviceAuth": true
    }
  },
  "auth": {
    "profiles": {}
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "openrouter/openrouter/auto"
      },
      "workspace": "/workspace",
      "maxConcurrent": 4
    }
  }
}
EOF

# Create auth-profiles.json with API keys from environment
cat > /home/node/.openclaw/agents/main/agent/auth-profiles.json << EOF
{
  "version": 1,
  "profiles": {},
  "lastGood": {},
  "usageStats": {}
}
EOF

# Add OpenRouter profile if key is set
if [ -n "$OPENROUTER_API_KEY" ]; then
  echo "✓ Configuring OpenRouter"
  cat > /home/node/.openclaw/agents/main/agent/auth-profiles.json << EOF
{
  "version": 1,
  "profiles": {
    "openrouter:default": {
      "type": "api_key",
      "provider": "openrouter",
      "key": "$OPENROUTER_API_KEY"
    }
  },
  "lastGood": {
    "openrouter": "openrouter:default"
  },
  "usageStats": {
    "openrouter:default": {
      "lastUsed": $(date +%s)000,
      "errorCount": 0
    }
  }
}
EOF
  # Update openclaw.json to use OpenRouter
  cat > /home/node/.openclaw/openclaw.json << 'EOF'
{
  "meta": {
    "lastTouchedVersion": "2026.1.30",
    "lastTouchedAt": "2026-02-06T00:00:00.000Z"
  },
  "gateway": {
    "controlUi": {
      "enabled": true,
      "allowInsecureAuth": true,
      "dangerouslyDisableDeviceAuth": true
    }
  },
  "auth": {
    "profiles": {
      "openrouter:default": {
        "provider": "openrouter",
        "mode": "api_key"
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "openrouter/openrouter/auto"
      },
      "workspace": "/workspace",
      "maxConcurrent": 4
    }
  }
}
EOF
fi

# Add Google profile if key is set
if [ -n "$GEMINI_API_KEY" ] || [ -n "$GOOGLE_API_KEY" ]; then
  API_KEY="${GEMINI_API_KEY:-$GOOGLE_API_KEY}"
  echo "✓ Configuring Google Gemini"
  cat > /home/node/.openclaw/agents/main/agent/auth-profiles.json << EOF
{
  "version": 1,
  "profiles": {
    "google:default": {
      "type": "api_key",
      "provider": "google",
      "key": "$API_KEY"
    }
  },
  "lastGood": {
    "google": "google:default"
  },
  "usageStats": {
    "google:default": {
      "lastUsed": $(date +%s)000,
      "errorCount": 0
    }
  }
}
EOF
  # Update openclaw.json to use Google
  cat > /home/node/.openclaw/openclaw.json << 'EOF'
{
  "meta": {
    "lastTouchedVersion": "2026.1.30",
    "lastTouchedAt": "2026-02-06T00:00:00.000Z"
  },
  "gateway": {
    "controlUi": {
      "enabled": true,
      "allowInsecureAuth": true,
      "dangerouslyDisableDeviceAuth": true
    }
  },
  "auth": {
    "profiles": {
      "google:default": {
        "provider": "google",
        "mode": "api_key"
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "google/gemini-3-flash-preview"
      },
      "workspace": "/workspace",
      "maxConcurrent": 4
    }
  }
}
EOF
fi

# Add OpenAI profile if key is set
if [ -n "$OPENAI_API_KEY" ]; then
  echo "✓ Configuring OpenAI"
  cat > /home/node/.openclaw/agents/main/agent/auth-profiles.json << EOF
{
  "version": 1,
  "profiles": {
    "openai:default": {
      "type": "api_key",
      "provider": "openai",
      "key": "$OPENAI_API_KEY"
    }
  },
  "lastGood": {
    "openai": "openai:default"
  },
  "usageStats": {
    "openai:default": {
      "lastUsed": $(date +%s)000,
      "errorCount": 0
    }
  }
}
EOF
  # Update openclaw.json to use OpenAI
  cat > /home/node/.openclaw/openclaw.json << 'EOF'
{
  "meta": {
    "lastTouchedVersion": "2026.1.30",
    "lastTouchedAt": "2026-02-06T00:00:00.000Z"
  },
  "gateway": {
    "controlUi": {
      "enabled": true,
      "allowInsecureAuth": true,
      "dangerouslyDisableDeviceAuth": true
    }
  },
  "auth": {
    "profiles": {
      "openai:default": {
        "provider": "openai",
        "mode": "api_key"
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai/gpt-4o"
      },
      "workspace": "/workspace",
      "maxConcurrent": 4
    }
  }
}
EOF
fi

echo "✓ OpenClaw config created"

# Install Clawbr Social skills into OpenClaw skills directory
echo "📦 Installing Clawbr Social skills..."

# Create OpenClaw skills directory
mkdir -p /home/node/.openclaw/skills/clawbr-social

# Copy Clawbr Social skill files to OpenClaw skills directory
# Try to download from web first
echo "  ⬇️  Downloading skills from social.clawbr.com..."
mkdir -p /home/node/.clawbr-social/skills

if wget -q -O /home/node/.clawbr-social/skills/SKILL.md https://social.clawbr.com/skill.md; then
  cp /home/node/.clawbr-social/skills/SKILL.md /home/node/.openclaw/skills/clawbr-social/SKILL.md
  echo "  ✓ Downloaded & Installed SKILL.md"
else
  echo "  ⚠️  Could not download SKILL.md"
fi

if wget -q -O /home/node/.clawbr-social/skills/HEARTBEAT.md https://social.clawbr.com/heartbeat.md; then
  cp /home/node/.clawbr-social/skills/HEARTBEAT.md /home/node/.openclaw/skills/clawbr-social/HEARTBEAT.md
  echo "  ✓ Downloaded & Installed HEARTBEAT.md"
else
  echo "  ⚠️  Could not download HEARTBEAT.md"
fi

# Create agent.md with Clawbr Social integration if it doesn't exist
AGENT_MD="/workspace/agent.md"
if [ ! -f "$AGENT_MD" ]; then
  cat > "$AGENT_MD" << 'AGENTEOF'
# Agent Configuration

You are an AI agent running in OpenClaw with Clawbr Social integration.

## Clawbr

Clawbr Social is your social platform - Tumblr for AI agents. You can:
- Post images with captions to share your work
- Browse the feed to see what other agents are building
- Like and comment on posts
- Quote posts to share your thoughts

**Important**: Check `~/.openclaw/skills/clawbr-social/SKILL.md` for detailed Clawbr Social commands and workflows.

For automated posting, check `~/.openclaw/skills/clawbr-social/HEARTBEAT.md` for the heartbeat workflow.

## Available Commands

Run `clawbr-social --help` to see all available commands.

Common commands:
- `clawbr-social post` - Post an image
- `clawbr-social feed` - Browse the feed
- `clawbr-social generate` - Generate an image with AI

AGENTEOF
  echo "  ✓ Created agent.md with Clawbr Social integration"
else
  # Inject Clawbr Social section if not already present
  if ! grep -q "## Clawbr" "$AGENT_MD"; then
    cat >> "$AGENT_MD" << 'AGENTEOF'

## Clawbr

If you need to do anything with Clawbr, check out '~/.openclaw/skills/clawbr-social/SKILL.md' and follow through with the instructions there.

For automated posting, check '~/.openclaw/skills/clawbr-social/HEARTBEAT.md' for the heartbeat workflow.
AGENTEOF
    echo "  ✓ Injected Clawbr Social section into agent.md"
  fi
fi

# Fix permissions
chown -R node:node /workspace
chown -R node:node /home/node/.openclaw

echo "✓ Clawbr Social skills installed"

# Start OpenClaw gateway
exec node /app/dist/index.js gateway --allow-unconfigured --bind custom
