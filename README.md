# Ralpher

A full-stack web application for managing **Ralph Loops** - an autonomous AI development pattern that solves the problem of context accumulation in AI coding assistants.

## What is a Ralph Loop?

A Ralph Loop is an autonomous AI development pattern that uses an external loop to repeatedly feed prompts to an AI agent. The agent works on a task until a specific completion condition is met. Each iteration starts with a fresh context window, relying on the filesystem (via `.planning/` documents) for state persistence.

### Key Principles

| Principle | Description |
|-----------|-------------|
| **Fresh Context per Iteration** | Each iteration starts with a clean context window |
| **State Persistence** | Progress tracked via `.planning/plan.md` and `.planning/status.md` in target project |
| **Stop Condition** | Loop terminates when AI output ends with `<promise>COMPLETE</promise>` |
| **Git Safety** | Work isolated in branch, committed per iteration, merged on acceptance |

## Installation

Install the latest release binary:

```bash
curl -fsSL https://raw.githubusercontent.com/pablozaiden/ralpher/main/install.sh | sh
```

This downloads the appropriate binary for your platform (Linux/macOS, x64/arm64) and installs it to `~/.local/bin/ralpher`.

## Features

- **Web Dashboard**: Real-time monitoring of multiple concurrent loops
- **REST API**: Full control over loop lifecycle
- **Git Integration**: Automatic branch per loop, commit per iteration, merge on accept
- **Real-time Updates**: Live log streaming
- **Model Selection**: Choose AI models from available providers

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.3.5 or later
- Git
- An [OpenCode](https://opencode.ai) compatible AI provider API key

### Development Setup

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

The build creates a single standalone executable that includes the Bun runtime and all dependencies. No installation required on the target machine.

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

Ralpher stores all data in a SQLite database within the data directory:

```
data/
├── ralpher.db       # SQLite database (loops, sessions, preferences)
├── ralpher.db-shm   # SQLite shared memory (runtime)
└── ralpher.db-wal   # SQLite write-ahead log (runtime)
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
4. Select a model and configure max iterations
5. Click "Create" - the loop starts automatically

### Monitoring a Loop

1. Click on a loop card to view details
2. Watch real-time logs as the AI works
3. Use the "Prompt" tab to modify the next iteration's prompt
4. Use the "Diff" tab to see changes made so far

### Accepting Changes

When a loop completes (or you stop it manually):

1. Review the diff tab to see all changes
2. Click "Accept (Merge)" to merge the branch into the original
3. Or delete the loop to discard changes

### Addressing Reviewer Comments

After accepting or pushing a loop, you can iteratively improve the work based on reviewer feedback:

#### For Pushed Loops

1. Complete a loop and click "Push" to push the branch to the remote
2. Loop status becomes "Pushed" with an "Addressable" badge
3. After code review, click "Address Comments" button
4. Enter reviewer feedback in the modal
5. The loop restarts on the same branch to address the comments
6. Push again after completion - cycle repeats as needed

Each review cycle adds new commits to the same branch. Perfect for PR-based workflows where you iterate on feedback before merging.

#### For Merged Loops

1. Complete a loop and click "Accept (Merge)" to merge into main/base branch
2. Loop status becomes "Merged" with an "Addressable" badge  
3. After reviewing the merged changes, click "Address Comments"
4. Enter feedback about what needs improvement
5. The loop creates a new review branch (`<branch-prefix><name>-review-<N>`)
6. Work is done on the review branch, then merged back to main
7. Merge again after completion - cycle repeats as needed

Each review cycle creates a new branch from the base branch. Perfect for post-merge refinements and iterative improvements.

#### Review History

- View the "Review" tab in loop details to see:
  - **Comment History**: All submitted review comments grouped by cycle, showing:
    - Comment text and submission timestamp
    - Status badge: "Pending" (currently being worked on) or "Addressed" (completed)
    - When each comment was addressed (for completed comments)
  - Number of review cycles completed
  - List of review branches created
  - Whether the loop is currently addressable
- Review mode tracks all branches, cycles, and comments for full audit history
- Comments are automatically marked as "addressed" when the loop completes the review cycle

#### Ending Review Mode

- Click "Purge" on a merged/pushed loop to:
  - Clean up review branches
  - Mark loop as non-addressable
  - Permanently delete the loop record
- Once purged, the loop can no longer receive comments

### Modifying In-Flight

While a loop is running:

- Use the "Prompt" tab to set a "pending prompt" for the next iteration
- The current iteration continues with its original prompt
- The next iteration will use your updated prompt

## API Reference

See [docs/API.md](docs/API.md) for complete API documentation.

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
# Run all tests (recommended)
bun run test

# Run specific test file
bun test tests/api/loops-crud.test.ts

# Type check
bunx tsc --noEmit
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

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Run `bun run build && bun run test`
5. Submit a pull request
