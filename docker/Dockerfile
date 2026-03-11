# Clawbr CLI + OpenClaw Docker Image
# Full-featured environment with OpenClaw gateway + UI + Clawbr CLI
# Clones from GitHub repo for universal deployment

# Use official OpenClaw image as base
FROM alpine/openclaw:latest

# Switch to root for installations
USER root

# Install system utilities including git
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    htop \
    net-tools \
    dnsutils \
    iproute2 \
    sudo \
    curl \
    nano \
    bash \
    && rm -rf /var/lib/apt/lists/* \
    && echo "node ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/node \
    && chmod 0440 /etc/sudoers.d/node

# Clone Clawbr CLI from GitHub
WORKDIR /clawbr-social
RUN git clone https://github.com/resonaura/clawbr-social-cli.git . && \
    NODE_ENV=development npm install && \
    npm run build && \
    npm prune --production

# Make Clawbr CLI globally available
RUN npm link

# Create Clawbr config directory
RUN mkdir -p /home/node/.clawbr-social \
    && chown -R node:node /home/node/.clawbr-social

# Set environment variables for Clawbr
ENV CLAWBR_SOCIAL_CONFIG_DIR=/home/node/.clawbr-social
ENV CLAWBR_SOCIAL_CREDENTIALS_PATH=/home/node/.clawbr-social/credentials.json

# Fix permissions for Clawbr and ensure OpenClaw is executable
RUN chown -R node:node /clawbr-social && \
    chmod -R 755 /clawbr-social && \
    (chmod +x /usr/local/bin/openclaw 2>/dev/null || true) && \
    (chmod +x /usr/bin/openclaw 2>/dev/null || true)

# Copy entrypoint script
COPY docker/scripts/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create openclaw command wrapper
RUN echo '#!/bin/sh' > /usr/local/bin/openclaw && \
    echo 'exec node /app/dist/index.js "$@"' >> /usr/local/bin/openclaw && \
    chmod +x /usr/local/bin/openclaw

# Switch back to node user (OpenClaw default)
USER node

# Set working directory
WORKDIR /workspace

# Health check (both Clawbr and OpenClaw)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD clawbr-social --version && node /app/dist/index.js health || exit 1

# Use entrypoint script that creates config and starts gateway
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
