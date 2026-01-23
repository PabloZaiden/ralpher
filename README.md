# Ralpher

A full-stack web application for managing **Ralph Loops** - an autonomous AI development pattern that solves the problem of context accumulation in AI coding assistants.

## What is a Ralph Loop?

A Ralph Loop (named after the "Ralph Wiggum technique") is an autonomous AI development pattern that uses an external loop to repeatedly feed prompts to an AI agent. The agent works on a task until a specific completion condition is met. Each iteration starts with a fresh context window, relying on the filesystem (via `.planning/` documents) for state persistence.

### Key Principles

| Principle | Description |
|-----------|-------------|
| **Fresh Context per Iteration** | Each iteration starts with a clean context window |
| **State Persistence** | Progress tracked via `.planning/plan.md` and `.planning/status.md` in target project |
| **Stop Condition** | Loop terminates when AI output ends with `<promise>COMPLETE</promise>` |
| **Git Safety** | Work isolated in branch, committed per iteration, merged on acceptance |

## Features

- **Web Dashboard**: Real-time monitoring of multiple concurrent loops
- **REST API**: Full control over loop lifecycle (create, start, stop, accept, discard)
- **Git Integration**: Automatic branch per loop, commit per iteration, merge on accept
- **Real-time Updates**: Server-Sent Events (SSE) for live log streaming
- **Model Selection**: Choose AI models from available providers
- **Pending Prompt**: Modify next iteration's prompt while loop is running

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.3.5 or later
- Git
- An [OpenCode](https://opencode.ai) compatible AI provider API key

### Installation

```bash
# Clone the repository
git clone https://github.com/pablozaiden/ralpher.git
cd ralpher

# Install dependencies
bun install
```

### Development

```bash
# Start development server with hot reload
bun dev
```

The web UI will be available at `http://localhost:3000` (or the port specified by `RALPHER_PORT`).

### Production

```bash
# Build standalone executable
bun run build

# Run the executable
./dist/ralpher
```

The build creates a single standalone executable (~55 MB) that includes the Bun runtime and all dependencies. No installation required on the target machine.

### Cross-compilation

Build for different platforms:

```bash
bun run build --target=bun-linux-x64
bun run build --target=bun-linux-arm64
bun run build --target=bun-darwin-x64
bun run build --target=bun-darwin-arm64
bun run build --target=bun-windows-x64
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RALPHER_PORT` | Server port | `3000` |
| `RALPHER_DATA_DIR` | Data directory for persistence | `./data` |

### Data Directory

Ralpher stores loop configurations and state in the data directory:

```
data/
├── loops/           # Loop configs and state (JSON files)
├── sessions/        # Backend session mappings
└── preferences.json # User preferences (last model, etc.)
```

For Docker deployments, mount this directory as a volume:

```yaml
services:
  ralpher:
    image: ralpher:latest
    volumes:
      - ralpher-data:/app/data
    environment:
      - RALPHER_DATA_DIR=/app/data

volumes:
  ralpher-data:
```

## Usage

### Creating a Loop

1. Click "New Loop" in the dashboard
2. Enter a name and the working directory path
3. Write your task prompt (the PRD/requirements)
4. Optionally select a model and configure max iterations
5. Click "Create"

### Starting a Loop

1. Click on a loop card to view details
2. Click "Start" to begin execution
3. If uncommitted changes exist, choose to commit, stash, or cancel
4. Watch real-time logs as the AI works

### Accepting Changes

When a loop completes (or you stop it manually):

1. Review the diff tab to see all changes
2. Click "Accept (Merge)" to merge the branch into the original
3. Or delete the loop to discard changes

### Modifying In-Flight

While a loop is running:

- Use the "Prompt" tab to set a "pending prompt" for the next iteration
- The current iteration continues with its original prompt
- The next iteration will use your updated prompt

## API Reference

See [docs/API.md](docs/API.md) for complete API documentation.

### Quick Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/loops` | GET | List all loops |
| `/api/loops` | POST | Create a new loop |
| `/api/loops/:id` | GET | Get loop details |
| `/api/loops/:id` | PATCH | Update loop config |
| `/api/loops/:id` | DELETE | Delete a loop |
| `/api/loops/:id/start` | POST | Start loop execution |
| `/api/loops/:id/stop` | POST | Stop loop execution |
| `/api/loops/:id/accept` | POST | Merge git branch |
| `/api/loops/:id/push` | POST | Push branch to remote |
| `/api/loops/:id/discard` | POST | Delete git branch |
| `/api/loops/:id/pending-prompt` | PUT | Set next iteration prompt |
| `/api/ws` | WebSocket | Real-time events stream |

## Technology Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3.5+ |
| Language | TypeScript (strict mode) |
| Frontend | React 19 |
| Styling | Tailwind CSS v4 |
| AI Integration | @opencode-ai/sdk |
| Real-time | WebSocket |

## Architecture

### Server Modes

Ralpher supports two modes for connecting to the opencode backend:

| Mode | Description |
|------|-------------|
| **Spawn** | Ralpher spawns a local opencode server process automatically |
| **Connect** | Ralpher connects to a remote opencode server via URL |

Both modes work identically from the user's perspective - the same UI and API endpoints work regardless of mode.

## Testing

```bash
# Run all tests
bun test

# Run with timeout (via npm script)
bun run test

# Run specific test file
bun test tests/api/loops-crud.test.ts

# Type check
bun x tsc --noEmit
```

## Development

### Code Style

- TypeScript strict mode enabled
- 2-space indentation
- Named exports for components
- Tailwind CSS utility classes

See [AGENTS.md](AGENTS.md) for detailed coding guidelines.

### Adding a New API Endpoint

1. Create or modify files in `src/api/`
2. Add route to the appropriate routes object
3. Export from `src/api/index.ts`
4. Add tests in `tests/api/`

### Adding a New Backend

1. Implement the `AgentBackend` interface from `src/backends/types.ts`
2. Create a new directory under `src/backends/`
3. Register the backend in `src/backends/registry.ts`

## The Ralph Wiggum Technique

The pattern works by:

1. **Starting**: Creates a git branch and sends the initial prompt
2. **Iterating**: AI responds, makes changes, and outputs status
3. **Committing**: After each iteration, changes are committed
4. **Checking**: If output ends with `<promise>COMPLETE</promise>`, stop
5. **Continuing**: Otherwise, send a continuation prompt with fresh context
6. **Accepting**: User reviews and merges the branch

This solves context rot because each iteration starts fresh, reading state from `.planning/` files instead of relying on conversation history.

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Run `bun run build && bun test`
5. Submit a pull request
