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

# Install ca-certificates for HTTPS requests
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*

# Install opencode
RUN curl -fsSL https://opencode.ai/install | bash

# Add opencode to PATH
ENV PATH="/root/.opencode/bin:${PATH}"

# Copy the standalone binary from builder
COPY --from=builder /app/dist/ralpher /app/ralpher

# Create data directory
RUN mkdir -p /app/data

# Set environment variables
ENV NODE_ENV=production
ENV RALPHER_PORT=80
ENV RALPHER_DATA_DIR=/app/data

# Expose port 80
EXPOSE 80

# Run the server
CMD ["/app/ralpher"]
