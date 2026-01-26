# Ralpher API Reference

This document describes the REST API for the Ralpher Loop Management System.

## Base URL

```
http://localhost:3000/api
```

The port can be configured via `RALPHER_PORT` or `PORT` environment variables.

## Authentication

Currently, the API does not require authentication. This is intended for local development and trusted network environments.

## Response Format

All responses are JSON. Successful responses return the requested data directly. Error responses follow this format:

```json
{
  "error": "error_code",
  "message": "Human-readable error description"
}
```

## Command Execution Architecture

All API endpoints that perform server-side operations (git commands, file operations, etc.) use a unified PTY (pseudo-terminal) execution model:

1. **PTY Session Creation**: A temporary PTY shell session is created on the opencode server
2. **WebSocket Connection**: Commands are sent via WebSocket with unique markers
3. **Output Capture**: Command output is captured between markers for clean results
4. **Cleanup**: The PTY session is removed after command completion

This architecture works identically in both spawn mode (local opencode server) and connect mode (remote opencode server). The following operations use PTY execution:

- Git operations (`/api/git/branches`, loop git operations)
- File existence checks (`/api/check-planning-dir`)
- File reads (`/api/loops/:id/plan`, `/api/loops/:id/status-file`)
- Directory listings

## Endpoints

### Health Check

#### GET /api/health

Check if the server is running.

**Response**

```json
{
  "healthy": true,
  "version": "1.0.0"
}
```

---

### Loops CRUD

#### GET /api/loops

List all loops.

**Response**

```json
[
  {
    "config": {
      "id": "uuid",
      "name": "My Loop",
      "directory": "/path/to/project",
      "prompt": "Implement feature X",
      "createdAt": "2026-01-20T10:00:00.000Z",
      "updatedAt": "2026-01-20T10:00:00.000Z",
      "stopPattern": "<promise>COMPLETE</promise>$",
      "git": {
        "branchPrefix": "ralph/",
        "commitPrefix": "[Ralph]"
      }
    },
    "state": {
      "id": "uuid",
      "status": "idle",
      "currentIteration": 0,
      "recentIterations": []
    }
  }
]
```

#### POST /api/loops

Create a new loop.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable name |
| `directory` | string | Yes | Absolute path to working directory |
| `prompt` | string | Yes | Task prompt/PRD |
| `model` | object | No | Model selection |
| `model.providerID` | string | No | Provider ID (e.g., "anthropic") |
| `model.modelID` | string | No | Model ID (e.g., "claude-sonnet-4-20250514") |
| `maxIterations` | number | No | Maximum iterations (unlimited if not set) |
| `maxConsecutiveErrors` | number | No | Max errors before failsafe (default: 10) |
| `stopPattern` | string | No | Completion regex (default: `<promise>COMPLETE</promise>$`) |
| `git` | object | No | Git configuration |
| `git.branchPrefix` | string | No | Branch prefix (default: "ralph/") |
| `git.commitPrefix` | string | No | Commit message prefix (default: "[Ralph]") |
| `baseBranch` | string | No | Base branch to create the loop from (default: current branch) |

**Example Request**

```json
{
  "name": "Add dark mode",
  "directory": "/Users/me/projects/myapp",
  "prompt": "Implement a dark mode toggle in the settings page. Use CSS variables for theming.",
  "model": {
    "providerID": "anthropic",
    "modelID": "claude-sonnet-4-20250514"
  },
  "maxIterations": 10
}
```

**Response**

Returns the created loop object with status `201 Created`.

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `validation_error` | Missing or invalid fields |
| 400 | `invalid_body` | Request body is not valid JSON |

#### GET /api/loops/:id

Get a specific loop by ID.

**Response**

Returns the loop object.

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |

#### PATCH /api/loops/:id

Update a loop's configuration.

**Request Body**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Update name |
| `prompt` | string | Update prompt |
| `model` | object | Update model |
| `maxIterations` | number | Update max iterations |
| `maxConsecutiveErrors` | number | Update max consecutive errors |
| `stopPattern` | string | Update stop pattern |
| `git` | object | Update git config (partial) |

**Response**

Returns the updated loop object.

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |

#### DELETE /api/loops/:id

Delete a loop.

**Response**

```json
{
  "success": true
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |

---

### Loop Control

Loops are automatically started when created. The following endpoints control loop lifecycle after creation.

#### POST /api/loops/:id/accept

Accept a completed loop and merge its branch.

**Response**

```json
{
  "success": true,
  "mergeCommit": "abc123..."
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |
| 400 | `accept_failed` | Cannot accept (e.g., loop still running) |

#### POST /api/loops/:id/push

Push a completed loop's branch to remote for PR workflow.

**Response**

```json
{
  "success": true,
  "remoteBranch": "ralph/my-feature"
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |
| 400 | `push_failed` | Cannot push (e.g., loop still running or no remote) |

#### POST /api/loops/:id/discard

Discard a loop and delete its git branch.

**Response**

```json
{
  "success": true
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |
| 400 | `discard_failed` | Cannot discard |

#### POST /api/loops/:id/purge

Permanently delete a merged or deleted loop from storage.

**Response**

```json
{
  "success": true
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |
| 400 | `purge_failed` | Cannot purge (loop not in final state) |

---

### Pending Prompt

Modify the prompt for the next iteration while a loop is running.

#### PUT /api/loops/:id/pending-prompt

Set the pending prompt for the next iteration.

**Request Body**

```json
{
  "prompt": "Also update the tests for the feature"
}
```

**Response**

```json
{
  "success": true
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |
| 409 | `not_running` | Loop is not running |
| 400 | `validation_error` | Prompt is empty |

#### DELETE /api/loops/:id/pending-prompt

Clear the pending prompt.

**Response**

```json
{
  "success": true
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |
| 409 | `not_running` | Loop is not running |

---

### Loop Data

#### GET /api/loops/:id/diff

Get the git diff for a loop's changes.

**Response**

```json
[
  {
    "path": "src/components/Button.tsx",
    "status": "modified",
    "additions": 15,
    "deletions": 3,
    "patch": "@@ -1,5 +1,10 @@\n import React from 'react';\n..."
  },
  {
    "path": "src/styles/dark.css",
    "status": "added",
    "additions": 42,
    "deletions": 0,
    "patch": "@@ -0,0 +1,42 @@\n+:root {\n+..."
  }
]
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |
| 400 | `no_git_branch` | No git branch exists for this loop |

#### GET /api/loops/:id/plan

Get the contents of `.planning/plan.md` from the loop's directory.

**Response**

```json
{
  "content": "# Project Plan\n\n## Goals\n...",
  "exists": true
}
```

#### GET /api/loops/:id/status-file

Get the contents of `.planning/status.md` from the loop's directory.

**Response**

```json
{
  "content": "# Status\n\n## Completed\n...",
  "exists": true
}
```

---

### Plan Mode

Plan mode allows reviewing and refining a plan before execution begins.

#### POST /api/loops/:id/plan/feedback

Send feedback to refine the plan during planning phase.

**Request Body**

```json
{
  "feedback": "Please also consider error handling for edge cases"
}
```

**Response**

```json
{
  "success": true
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 409 | `not_running` | Loop is not running or not found |
| 400 | `not_planning` | Loop is not in planning status |
| 400 | `validation_error` | Feedback is empty |

#### POST /api/loops/:id/plan/accept

Accept the plan and start loop execution.

**Response**

```json
{
  "success": true
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 409 | `not_running` | Loop is not running |
| 400 | `not_planning` | Loop is not in planning status |

#### POST /api/loops/:id/plan/discard

Discard the plan and delete the loop.

**Response**

```json
{
  "success": true
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |

---

### Models

#### GET /api/models

Get available AI models for a directory.

**Query Parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `directory` | Yes | Working directory path |

**Response**

```json
[
  {
    "providerID": "anthropic",
    "providerName": "Anthropic",
    "modelID": "claude-sonnet-4-20250514",
    "modelName": "Claude Sonnet 4",
    "connected": true
  },
  {
    "providerID": "openai",
    "providerName": "OpenAI",
    "modelID": "gpt-4o",
    "modelName": "GPT-4o",
    "connected": false
  }
]
```

---

### Preferences

#### GET /api/preferences/last-model

Get the last used model.

**Response**

```json
{
  "providerID": "anthropic",
  "modelID": "claude-sonnet-4-20250514"
}
```

Returns `null` if no model has been used.

#### PUT /api/preferences/last-model

Set the last used model.

**Request Body**

```json
{
  "providerID": "anthropic",
  "modelID": "claude-sonnet-4-20250514"
}
```

**Response**

```json
{
  "success": true
}
```

#### GET /api/preferences/last-directory

Get the last used working directory.

**Response**

```json
"/path/to/last/project"
```

Returns `null` if no directory has been used.

#### PUT /api/preferences/last-directory

Set the last used working directory.

**Request Body**

```json
{
  "directory": "/path/to/project"
}
```

**Response**

```json
{
  "success": true
}
```

---

### Configuration

#### GET /api/config

Get application configuration based on environment.

**Response**

```json
{
  "remoteOnly": false
}
```

| Field | Description |
|-------|-------------|
| `remoteOnly` | If true, spawn mode is disabled (set via RALPHER_REMOTE_ONLY env var) |

---

### Utilities

#### GET /api/check-planning-dir

Check if a directory has a `.planning` folder with files.

**Query Parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `directory` | Yes | Directory path to check |

**Response** (directory exists with files)

```json
{
  "exists": true,
  "hasFiles": true,
  "files": ["plan.md", "status.md"]
}
```

**Response** (directory doesn't exist)

```json
{
  "exists": false,
  "hasFiles": false,
  "files": [],
  "warning": "The .planning directory does not exist. Ralph Loops work best with planning documents."
}
```

---

### Server Settings

Ralpher supports two modes for connecting to the opencode backend. Both modes provide identical functionality - all commands (git, file operations, etc.) are executed via PTY over WebSocket regardless of mode.

#### GET /api/settings/server

Get current server settings.

**Response**

```json
{
  "mode": "spawn",
  "hostname": null,
  "port": null,
  "password": null
}
```

#### PUT /api/settings/server

Update server settings.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mode` | string | Yes | "spawn" (local opencode) or "connect" (remote server) |
| `hostname` | string | For connect | Hostname for connect mode |
| `port` | number | No | Port for connect mode |
| `password` | string | No | Password for Basic auth in connect mode |

**Response**

```json
{
  "success": true,
  "settings": {
    "mode": "connect",
    "hostname": "remote.example.com",
    "port": 8080,
    "password": "***"
  }
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `invalid_mode` | mode must be "spawn" or "connect" |
| 400 | `missing_hostname` | hostname is required for connect mode |

#### GET /api/settings/server/status

Get connection status.

**Response**

```json
{
  "connected": true,
  "mode": "spawn",
  "serverUrl": "http://localhost:41234"
}
```

#### POST /api/settings/server/test

Test connection with provided settings.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mode` | string | Yes | "spawn" or "connect" |
| `hostname` | string | For connect | Hostname for connect mode |
| `port` | number | No | Port for connect mode |
| `password` | string | No | Password for Basic auth |
| `directory` | string | No | Directory to test with (defaults to current) |

**Response**

```json
{
  "success": true,
  "message": "Connection successful"
}
```

#### POST /api/backend/reset

Force reset the backend connection. Aborts all active subscriptions and clears connection state. Useful for recovering from stale/hung connections.

**Response**

```json
{
  "success": true,
  "message": "Backend connection reset successfully"
}
```

#### POST /api/settings/reset-all

Delete database and reinitialize. This is a destructive operation that deletes all loops, sessions, and preferences. The database is recreated fresh with all migrations applied.

**Response**

```json
{
  "success": true,
  "message": "All settings have been reset. Database recreated."
}
```

---

### Git

#### GET /api/git/branches

Get all local branches for a directory.

**Query Parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `directory` | Yes | Directory path to check |

**Response**

```json
{
  "currentBranch": "main",
  "branches": [
    { "name": "main", "current": true },
    { "name": "feature/auth", "current": false },
    { "name": "ralph/add-tests", "current": false }
  ]
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `missing_parameter` | directory query parameter is required |
| 400 | `not_git_repo` | Directory is not a git repository |

---

### Events (WebSocket)

#### WS /api/ws

WebSocket endpoint for real-time event streaming. Supports optional loop filtering.

**Query Parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `loopId` | No | Filter events to a specific loop |

**Connection URL Examples**

```
ws://localhost:3000/api/ws              # All events
ws://localhost:3000/api/ws?loopId=abc   # Events for loop "abc" only
wss://example.com/api/ws                # Secure WebSocket
```

**Connection Message**

Upon successful connection, the server sends a confirmation:

```json
{"type":"connected","loopId":null}
```

If `loopId` was specified:

```json
{"type":"connected","loopId":"abc-123"}
```

**Event Types**

Each event is a JSON object with a `type` field:

| Event Type | Description |
|------------|-------------|
| `loop.created` | New loop was created |
| `loop.started` | Loop execution started |
| `loop.iteration.start` | Iteration began |
| `loop.iteration.end` | Iteration completed |
| `loop.message` | AI message received |
| `loop.tool_call` | Tool was invoked |
| `loop.progress` | Streaming text delta |
| `loop.log` | Application log entry |
| `loop.git.commit` | Git commit made |
| `loop.completed` | Loop finished successfully |
| `loop.stopped` | Loop was stopped manually |
| `loop.error` | Error occurred |
| `loop.deleted` | Loop was deleted |
| `loop.accepted` | Branch was merged |
| `loop.pushed` | Branch was pushed to remote |
| `loop.discarded` | Branch was deleted |

**Keep-Alive**

Send a ping message to receive a pong response:

```json
// Client sends:
{"type":"ping"}

// Server responds:
{"type":"pong"}
```

**Example Events**

```json
{"type":"loop.iteration.start","loopId":"abc-123","iteration":3,"timestamp":"2026-01-20T10:15:00.000Z"}

{"type":"loop.log","loopId":"abc-123","id":"log-1","level":"info","message":"Sending prompt to AI","timestamp":"2026-01-20T10:15:01.000Z"}

{"type":"loop.tool_call","loopId":"abc-123","iteration":3,"tool":{"id":"tc-1","name":"Write","input":{"path":"/src/foo.ts"},"status":"running"},"timestamp":"2026-01-20T10:15:05.000Z"}
```

**JavaScript Example**

```javascript
const ws = new WebSocket('ws://localhost:3000/api/ws');

ws.onopen = () => {
  console.log('Connected');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'connected') {
    console.log('Connection confirmed');
    return;
  }
  console.log('Event:', data.type, data);
};

ws.onclose = () => {
  console.log('Disconnected');
  // Implement reconnection logic as needed
};
```

---

## Data Types

### Loop Status

| Status | Description |
|--------|-------------|
| `idle` | Created but not started |
| `starting` | Initializing backend connection |
| `planning` | In plan mode, awaiting plan approval |
| `running` | Actively executing |
| `waiting` | Between iterations |
| `completed` | Stop pattern matched |
| `stopped` | Manually stopped |
| `failed` | Error occurred |
| `max_iterations` | Hit iteration limit |
| `merged` | Changes merged (final state) |
| `pushed` | Branch pushed to remote (final state) |
| `deleted` | Marked for deletion (final state) |

### File Diff Status

| Status | Description |
|--------|-------------|
| `added` | New file |
| `modified` | File changed |
| `deleted` | File removed |
| `renamed` | File renamed |

### Log Levels

| Level | Description |
|-------|-------------|
| `agent` | AI agent activity |
| `info` | General information |
| `warn` | Warning messages |
| `error` | Error messages |
| `debug` | Debug/verbose output |

---

## Examples

### Create a Loop

Loops are automatically started upon creation. The API will reject creation if there are uncommitted changes.

```bash
# Create a loop (starts automatically)
curl -X POST http://localhost:3000/api/loops \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Add user authentication",
    "directory": "/path/to/project",
    "prompt": "Implement JWT-based authentication with login and signup endpoints"
  }'

# Response: {"config":{"id":"abc-123",...},"state":{"status":"running",...}}

# Watch events via WebSocket (use wscat or similar)
wscat -c ws://localhost:3000/api/ws?loopId=abc-123
```

### Handle Uncommitted Changes

Uncommitted changes are checked at loop creation time:

```bash
# Try to create a loop with uncommitted changes
curl -X POST http://localhost:3000/api/loops \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Loop",
    "directory": "/path/to/dirty/project",
    "prompt": "Do something"
  }'
# Response: 409 {"error":"uncommitted_changes","changedFiles":["src/foo.ts"]}

# Commit or stash your changes first, then try again
```

### Modify Next Iteration Prompt

```bash
# While loop is running, set a pending prompt
curl -X PUT http://localhost:3000/api/loops/abc-123/pending-prompt \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Continue, but also add unit tests for the auth module"}'
```

### Accept Completed Loop

```bash
# After loop completes, review and accept
curl -X POST http://localhost:3000/api/loops/abc-123/accept
# Response: {"success":true,"mergeCommit":"def456..."}
```
