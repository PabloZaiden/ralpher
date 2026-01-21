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
      "backend": {
        "type": "opencode",
        "mode": "spawn"
      },
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
| `backend` | object | No | Backend configuration |
| `backend.type` | string | No | Backend type (default: "opencode") |
| `backend.mode` | string | No | "spawn" or "connect" (default: "spawn") |
| `backend.hostname` | string | No | Hostname for connect mode |
| `backend.port` | number | No | Port for connect mode |
| `model` | object | No | Model selection |
| `model.providerID` | string | No | Provider ID (e.g., "anthropic") |
| `model.modelID` | string | No | Model ID (e.g., "claude-sonnet-4-20250514") |
| `maxIterations` | number | No | Maximum iterations (unlimited if not set) |
| `maxConsecutiveErrors` | number | No | Max errors before failsafe (default: 10) |
| `stopPattern` | string | No | Completion regex (default: `<promise>COMPLETE</promise>$`) |
| `git` | object | No | Git configuration |
| `git.branchPrefix` | string | No | Branch prefix (default: "ralph/") |
| `git.commitPrefix` | string | No | Commit message prefix (default: "[Ralph]") |

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

#### POST /api/loops/:id/start

Start loop execution.

**Request Body** (optional)

| Field | Type | Description |
|-------|------|-------------|
| `handleUncommitted` | string | How to handle uncommitted changes: "commit" or "stash" |

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
| 409 | `already_running` | Loop is already running |
| 409 | `uncommitted_changes` | Directory has uncommitted changes |

**Uncommitted Changes Response**

When uncommitted changes are detected:

```json
{
  "error": "uncommitted_changes",
  "message": "Target directory has uncommitted changes",
  "options": ["commit", "stash", "cancel"],
  "changedFiles": ["src/foo.ts", "src/bar.ts"]
}
```

Re-submit the request with `handleUncommitted` set to "commit" or "stash".

#### POST /api/loops/:id/stop

Stop a running loop.

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

### Events (SSE)

#### GET /api/events

Server-Sent Events stream for all loop events.

**Headers**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Events**

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
| `loop.discarded` | Branch was deleted |

**Example Event**

```
data: {"type":"loop.iteration.start","loopId":"abc-123","iteration":3,"timestamp":"2026-01-20T10:15:00.000Z"}

data: {"type":"loop.log","loopId":"abc-123","id":"log-1","level":"info","message":"Sending prompt to AI","timestamp":"2026-01-20T10:15:01.000Z"}

data: {"type":"loop.tool_call","loopId":"abc-123","iteration":3,"tool":{"id":"tc-1","name":"Write","input":{"path":"/src/foo.ts"},"status":"running"},"timestamp":"2026-01-20T10:15:05.000Z"}
```

#### GET /api/loops/:id/events

Server-Sent Events stream filtered to a specific loop.

Same format as `/api/events` but only includes events for the specified loop ID.

---

## Data Types

### Loop Status

| Status | Description |
|--------|-------------|
| `idle` | Created but not started |
| `starting` | Initializing backend connection |
| `running` | Actively executing |
| `waiting` | Between iterations |
| `completed` | Stop pattern matched |
| `stopped` | Manually stopped |
| `failed` | Error occurred |
| `max_iterations` | Hit iteration limit |
| `merged` | Changes merged (final state) |
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

### Create and Start a Loop

```bash
# Create a loop
curl -X POST http://localhost:3000/api/loops \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Add user authentication",
    "directory": "/path/to/project",
    "prompt": "Implement JWT-based authentication with login and signup endpoints"
  }'

# Response: {"config":{"id":"abc-123",...},"state":{...}}

# Start the loop
curl -X POST http://localhost:3000/api/loops/abc-123/start

# Watch events
curl -N http://localhost:3000/api/loops/abc-123/events
```

### Handle Uncommitted Changes

```bash
# Try to start
curl -X POST http://localhost:3000/api/loops/abc-123/start
# Response: 409 {"error":"uncommitted_changes","changedFiles":["src/foo.ts"]}

# Commit changes and start
curl -X POST http://localhost:3000/api/loops/abc-123/start \
  -H "Content-Type: application/json" \
  -d '{"handleUncommitted": "commit"}'
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
