# Build stage
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build the standalone binary for Linux (auto-detect target)
RUN bun src/build.ts

# Production stage - minimal image
FROM debian:bookworm-slim

WORKDIR /app

# Install required packages:
# - ca-certificates: for HTTPS requests
# - curl: for HEALTHCHECK
# - tini: init process for proper signal handling (Ctrl+C works)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    tini \
  && rm -rf /var/lib/apt/lists/*

# Copy the standalone binary from builder
COPY --from=builder /app/dist/ralpher /app/ralpher

# Create a non-root user for running the application
RUN groupadd --system ralpher && \
    useradd --system --gid ralpher --no-create-home ralpher

# Create data directory and set ownership
RUN mkdir -p /app/data && chown -R ralpher:ralpher /app/data

# Set environment variables
ENV NODE_ENV=production
ENV RALPHER_PORT=80
ENV RALPHER_DATA_DIR=/app/data

# Expose port 80
EXPOSE 80

# Run as non-root user
USER ralpher

# Health check using the /api/health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${RALPHER_PORT}/api/health || exit 1

# Use tini as init process for proper signal handling
ENTRYPOINT ["/usr/bin/tini", "--"]

# Run the server
CMD ["/app/ralpher"]
