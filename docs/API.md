# Ralpher API Reference

This document describes the REST API for the Ralpher Loop Management System.

## Base URL

```
http://localhost:3000/api
```

The port can be configured via the `RALPHER_PORT` environment variable.

## Authentication

The API itself does not implement authentication. In production deployments, Ralpher runs behind a reverse proxy that enforces authentication and authorization. In local development, no authentication is needed.

## Response Format

All responses are JSON. Successful responses return the requested data directly. Error responses follow this format:

```json
{
  "error": "error_code",
  "message": "Human-readable error description"
}
```

## Command Execution Architecture

All API endpoints that perform deterministic server-side operations (git commands, file operations, etc.) use the `CommandExecutor` abstraction:

1. **Local execution** (`stdio` agent transport): commands run directly on the local host.
2. **Remote execution** (`ssh` agent transport): commands run over SSH on the target workspace host.
3. **Bounded execution**: command operations enforce timeouts and explicit success/failure results.

This execution channel is independent from ACP agent session streaming. The following operations use deterministic command execution:

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
  "version": "0.0.0-development"
}
```

The `version` field is read from `package.json` at startup and will reflect the actual build version.

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
        "commitScope": "ralph"
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

Loop names are **automatically generated** from the prompt using AI. The `name` field is not accepted in the request body.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workspaceId` | string | Yes | ID of the workspace to create the loop in |
| `prompt` | string | Yes | Task prompt/PRD (non-empty) |
| `model` | object | Yes | Model selection |
| `model.providerID` | string | Yes | Provider ID (e.g., "anthropic") |
| `model.modelID` | string | Yes | Model ID (e.g., "claude-sonnet-4-20250514") |
| `model.variant` | string | No | Model variant (e.g., "thinking") |
| `planMode` | boolean | Yes | Start in plan creation mode |
| `maxIterations` | number | No | Maximum iterations (unlimited if not set) |
| `maxConsecutiveErrors` | number | No | Max errors before failsafe (default: 10) |
| `activityTimeoutSeconds` | number | No | Seconds without events before treating as error (default: 900, min: 60) |
| `stopPattern` | string | No | Completion regex (default: `<promise>COMPLETE</promise>$`) |
| `git` | object | No | Git configuration |
| `git.branchPrefix` | string | No | Branch prefix (default: "ralph/") |
| `git.commitScope` | string | No | Conventional commit scope (default: "ralph"). Used in commit messages as `type(scope): description`. The deprecated `git.commitPrefix` is still accepted and automatically converted (e.g., `"[Ralph]"` becomes `"ralph"`). |
| `baseBranch` | string | No | Base branch to create the loop from (default: auto-detected default branch) |
| `clearPlanningFolder` | boolean | No | Clear .planning folder before starting (default: false) |
| `draft` | boolean | No | Save as draft without starting (default: false) |

**Example Request**

```json
{
  "workspaceId": "ws-abc123",
  "prompt": "Implement a dark mode toggle in the settings page. Use CSS variables for theming.",
  "model": {
    "providerID": "anthropic",
    "modelID": "claude-sonnet-4-20250514"
  },
  "planMode": false,
  "maxIterations": 10,
  "activityTimeoutSeconds": 300
}
```

**Note:** The loop name will be automatically generated from the prompt (e.g., "implement-dark-mode-toggle"). Names are sanitized to kebab-case format, max 50 characters. If generation fails, a timestamp-based fallback name is used (e.g., "loop-2026-01-27-143022").

**Response**

Returns the created loop object with status `201 Created`. The response includes the auto-generated loop name in `config.name`.

- If `draft: true`, the loop is saved with status `draft` and no git branch is created
- If `planMode: true`, the loop starts in `planning` status
- Otherwise, the loop is started immediately and returns with status `running`

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `validation_error` | Missing or invalid fields |
| 400 | `invalid_json` | Request body is not valid JSON |
| 400 | `model_not_enabled` | The selected model is not available or not connected |
| 400 | `provider_not_found` | The specified provider was not found |
| 400 | `model_not_found` | The specified model was not found on the provider |
| 404 | `workspace_not_found` | Workspace not found for the given workspaceId |
| 500 | `start_failed` | Loop created but failed to start (normal mode) |
| 500 | `start_plan_failed` | Loop created but failed to start plan mode |
| 500 | `create_failed` | Loop creation failed |

#### GET /api/loops/:id

Get a specific loop by ID.

**Response**

Returns the loop object.

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |

#### PATCH /api/loops/:id

Update a loop's configuration. Cannot be used on running or starting loops — stop the loop first.

**Request Body**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Manually update name (optional, names are auto-generated on creation) |
| `directory` | string | Update working directory |
| `prompt` | string | Update prompt |
| `model` | object | Update model |
| `maxIterations` | number | Update max iterations |
| `maxConsecutiveErrors` | number | Update max consecutive errors |
| `activityTimeoutSeconds` | number | Update activity timeout |
| `stopPattern` | string | Update stop pattern |
| `baseBranch` | string | Update base branch |
| `clearPlanningFolder` | boolean | Update clear planning folder flag |
| `planMode` | boolean | Update plan mode flag |
| `git` | object | Update git config (partial) |

**Response**

Returns the updated loop object.

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `validation_error` | Invalid fields (e.g., empty name) |
| 400 | `invalid_json` | Request body is not valid JSON |
| 404 | `not_found` | Loop not found |
| 409 | `base_branch_immutable` | Cannot change base branch after loop has started |
| 500 | `update_failed` | Update operation failed |

#### PUT /api/loops/:id

Update a draft loop's configuration. Only works for loops in `draft` status.

**Request Body**

Same fields as PATCH.

**Response**

Returns the updated loop object.

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `not_draft` | Only draft loops can be updated via PUT |
| 400 | `validation_error` | Invalid fields (e.g., empty name) |
| 400 | `invalid_json` | Request body is not valid JSON |
| 404 | `not_found` | Loop not found |
| 409 | `base_branch_immutable` | Cannot change base branch after loop has started |
| 500 | `update_failed` | Update operation failed |

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

Loops are automatically started when created (unless `draft: true`). The following endpoints control loop lifecycle after creation.

#### POST /api/loops/:id/draft/start

Start a draft loop. Transitions the loop from `draft` status to either `planning` or `running`.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `planMode` | boolean | Yes | If true, start in plan mode; if false, start immediately |

**Response**

Returns the updated loop object.

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |
| 400 | `not_draft` | Loop is not in draft status |
| 400 | `validation_error` | Request body must contain planMode boolean |
| 400 | `invalid_json` | Request body is not valid JSON |
| 500 | `start_failed` | Failed to start loop (normal mode) |
| 500 | `start_plan_failed` | Failed to start plan mode |

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

When the push succeeds normally:

```json
{
  "success": true,
  "remoteBranch": "ralph/my-feature",
  "syncStatus": "clean"
}
```

When the branch is already up to date with the remote:

```json
{
  "success": true,
  "remoteBranch": "ralph/my-feature",
  "syncStatus": "already_up_to_date"
}
```

When merge conflicts are detected and being resolved (push deferred):

```json
{
  "success": true,
  "syncStatus": "conflicts_being_resolved"
}
```

Note: When `syncStatus` is `"conflicts_being_resolved"`, the `remoteBranch` field is absent.

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

#### POST /api/loops/:id/mark-merged

Mark a loop as externally merged and sync the local environment. Switches the repository back to the original branch, pulls latest changes from the remote, deletes the working branch, and transitions the loop to `deleted` status.

This is useful when a loop's branch was merged externally (e.g., via GitHub PR) and the user wants to sync their local environment with the merged changes.

Only works for loops in final states (pushed, merged, completed, max_iterations, deleted).

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
| 400 | `mark_merged_failed` | Cannot mark as merged (e.g., loop is still running) |

---

### Pending Values

Set or clear pending message and/or model for the next iteration. This is the primary way to interact with running loops.

#### POST /api/loops/:id/pending

Set pending message and/or model for next iteration. By default (`immediate: true`), the current iteration is interrupted and the pending values are applied immediately in a new iteration. Set `immediate: false` to wait for the current iteration to complete naturally.

Works for active loops (running, waiting, planning, starting) and can also jumpstart loops in supported stopped states (completed, stopped, failed, max_iterations).

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | No | Message to queue for next iteration |
| `model` | object | No | Model change: `{ providerID, modelID }` |
| `immediate` | boolean | No | If true (default), interrupt current iteration and apply immediately. If false, wait for current iteration to complete. |

At least one of `message` or `model` must be provided.

**Response**

```json
{
  "success": true
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `validation_error` | Neither message nor model provided, or message is empty |
| 400 | `model_not_enabled` | The selected model is not available |
| 404 | `not_found` | Loop not found |
| 409 | `not_running` | Loop is not in an active or jumpstart-eligible state |

#### DELETE /api/loops/:id/pending

Clear all pending values (message and model).

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
| 409 | `not_running` | Loop is not in an active state |

---

### Pending Prompt (Legacy)

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
| 400 | `no_git_branch` | No git branch was created for this loop |
| 400 | `no_worktree` | Loop has no worktree path |
| 500 | `diff_failed` | Diff operation failed |

#### GET /api/loops/:id/plan

Get the contents of `.planning/plan.md` from the loop's worktree directory.

**Response**

```json
{
  "content": "# Project Plan\n\n## Goals\n...",
  "exists": true
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |
| 400 | `no_worktree` | Loop has no worktree path |

#### GET /api/loops/:id/status-file

Get the contents of `.planning/status.md` from the loop's worktree directory.

**Response**

```json
{
  "content": "# Status\n\n## Completed\n...",
  "exists": true
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |
| 400 | `no_worktree` | Loop has no worktree path |

#### GET /api/loops/:id/comments

Get all review comments for a loop.

**Response**

```json
{
  "success": true,
  "comments": [
    {
      "id": "uuid",
      "loopId": "loop-uuid",
      "reviewCycle": 1,
      "commentText": "Please fix the error handling in the auth module",
      "createdAt": "2026-01-25T10:00:00.000Z",
      "status": "addressed",
      "addressedAt": "2026-01-25T12:00:00.000Z"
    }
  ]
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |

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
| 400 | `plan_not_ready` | Plan is not ready yet (still generating) |

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

### Review Comments

After a loop is pushed or merged, reviewers can submit comments that the loop will address.

#### POST /api/loops/:id/address-comments

Start addressing reviewer comments. Creates a new review cycle and restarts the loop.

**Request Body**

```json
{
  "comments": "Please fix the type errors in the auth module and add unit tests"
}
```

**Response**

```json
{
  "success": true,
  "reviewCycle": 1,
  "branch": "ralph/my-feature",
  "commentIds": ["uuid-1", "uuid-2"]
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |
| 400 | `validation_error` | Comments field is required/empty |
| 409 | `already_running` | Loop is already running |

#### GET /api/loops/:id/review-history

Get the review history for a loop, including past review cycles.

**Response**

```json
{
  "success": true,
  "history": {
    "addressable": true,
    "completionAction": "push",
    "reviewCycles": 2,
    "reviewBranches": ["ralph/my-feature-review-1", "ralph/my-feature-review-2"]
  }
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Loop not found |

---

### Models

#### GET /api/models

Get available AI models for a workspace directory.

**Query Parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `directory` | Yes | Working directory path |
| `workspaceId` | Yes | Workspace ID for server connection |

**Response**

```json
[
  {
    "providerID": "anthropic",
    "providerName": "Anthropic",
    "modelID": "claude-sonnet-4-20250514",
    "modelName": "Claude Sonnet 4",
    "connected": true,
    "variants": ["thinking"]
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

The `variants` field is optional and only present when the model supports multiple variants.

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `missing_directory` | directory query parameter is required |
| 400 | `missing_workspace_id` | workspaceId query parameter is required |
| 404 | `workspace_not_found` | Workspace not found |
| 500 | `models_failed` | Failed to retrieve models |

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

#### GET /api/preferences/markdown-rendering

Get the markdown rendering preference.

**Response**

```json
{
  "enabled": true
}
```

Defaults to `true` if not set.

#### PUT /api/preferences/markdown-rendering

Set the markdown rendering preference.

**Request Body**

```json
{
  "enabled": false
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
| 400 | `validation_error` | `enabled` must be a boolean |
| 500 | `save_failed` | Failed to save preference |

#### GET /api/preferences/log-level

Get the server log level preference.

**Response**

```json
{
  "level": "info",
  "defaultLevel": "info",
  "availableLevels": ["silly", "trace", "debug", "info", "warn", "error", "fatal"],
  "isFromEnv": false
}
```

| Field | Description |
|-------|-------------|
| `level` | Current active log level |
| `defaultLevel` | Default log level ("info") |
| `availableLevels` | All valid log level names |
| `isFromEnv` | Whether the log level was set via `RALPHER_LOG_LEVEL` environment variable |

#### PUT /api/preferences/log-level

Set the server log level. Takes effect immediately for both frontend and backend logging.

**Request Body**

```json
{
  "level": "debug"
}
```

Valid levels: `silly`, `trace`, `debug`, `info`, `warn`, `error`, `fatal`.

**Response**

```json
{
  "success": true,
  "level": "debug"
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `validation_error` | Level is required |
| 400 | `invalid_level` | Invalid log level name |
| 500 | `save_failed` | Failed to save preference |

#### GET /api/preferences/dashboard-view-mode

Get the dashboard view mode preference.

**Response**

```json
{
  "mode": "rows"
}
```

Defaults to `"rows"` if not set.

#### PUT /api/preferences/dashboard-view-mode

Set the dashboard view mode preference.

**Request Body**

```json
{
  "mode": "cards"
}
```

Valid modes: `"rows"` or `"cards"`.

**Response**

```json
{
  "success": true,
  "mode": "cards"
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `validation_error` | Mode must be "rows" or "cards" |
| 500 | `save_failed` | Failed to save preference |

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
| `remoteOnly` | If true, local `stdio` transport is disabled and only `ssh` transport is allowed (set via RALPHER_REMOTE_ONLY env var) |

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

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `invalid_request` | Missing `directory` query parameter |
| 404 | `workspace_not_found` | No workspace found for the given directory |
| 500 | `check_failed` | Failed to check the planning directory |

---

### Workspaces

Workspaces represent project directories managed by Ralpher. Each workspace has its own server connection settings and can have multiple loops.

#### GET /api/workspaces

List all workspaces.

**Response**

```json
[
  {
    "id": "ws-uuid",
    "name": "My Project",
    "directory": "/path/to/project",
    "serverSettings": {
      "agent": {
        "provider": "opencode",
        "transport": "stdio"
      }
    },
    "createdAt": "2026-01-20T10:00:00.000Z",
    "updatedAt": "2026-01-20T10:00:00.000Z"
  }
]
```

#### POST /api/workspaces

Create a new workspace. Validates that the directory exists on the remote server and is a git repository.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Workspace display name |
| `directory` | string | Yes | Absolute path to git repository |
| `serverSettings` | object | No | Workspace connection settings (defaults to `{ agent: { provider: "opencode", transport: "stdio" } }`) |

**Response**

Returns the created workspace with status `201 Created`.

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `validation_error` | Missing or invalid fields |
| 400 | `validation_failed` | Failed to validate directory on remote server |
| 400 | `not_git_repo` | Directory is not a git repository |
| 404 | `directory_not_found` | Directory does not exist on the remote server |
| 409 | `duplicate_workspace` | A workspace already exists for this directory |
| 500 | `create_failed` | Workspace creation failed |

#### GET /api/workspaces/:id

Get a specific workspace by ID.

**Response**

Returns the workspace object.

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `workspace_not_found` | Workspace not found |

#### PUT /api/workspaces/:id

Update a workspace.

**Request Body**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Update display name |
| `serverSettings` | object | Update server connection settings |

**Response**

Returns the updated workspace.

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `workspace_not_found` | Workspace not found |
| 500 | `update_failed` | Update operation failed |

#### DELETE /api/workspaces/:id

Delete a workspace.

**Response**

```json
{
  "success": true
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `workspace_not_found` | Workspace not found |
| 400 | `delete_failed` | Cannot delete workspace |

#### GET /api/workspaces/by-directory

Look up a workspace by its directory path.

**Query Parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `directory` | Yes | Directory path to look up |

**Response**

Returns the workspace object.

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `missing_parameter` | directory query parameter is required |
| 404 | `workspace_not_found` | No workspace found for this directory |

#### GET /api/workspaces/export

Export all workspace configurations as JSON for backup or migration.

**Response**

```json
{
  "version": 1,
  "workspaces": [
    {
      "name": "My Project",
      "directory": "/path/to/project",
      "serverSettings": {
        "agent": {
          "provider": "opencode",
          "transport": "stdio"
        }
      }
    }
  ]
}
```

#### POST /api/workspaces/import

Import workspace configurations from JSON. Each workspace's directory is validated on the remote server before creation. Workspaces with existing directories are skipped.

**Request Body**

```json
{
  "version": 1,
  "workspaces": [
    {
      "name": "My Project",
      "directory": "/path/to/project",
      "serverSettings": {
        "agent": {
          "provider": "opencode",
          "transport": "stdio"
        }
      }
    }
  ]
}
```

**Response**

```json
{
  "created": 2,
  "skipped": 1,
  "failed": 0,
  "details": [
    { "name": "Project A", "directory": "/path/a", "status": "created" },
    { "name": "Project B", "directory": "/path/b", "status": "skipped", "reason": "A workspace already exists for directory: /path/b" },
    { "name": "Project C", "directory": "/path/c", "status": "created" }
  ]
}
```

---

### AGENTS.md Optimization

Manage the workspace's `AGENTS.md` file, which provides AI coding agent guidelines. Ralpher can append an optimization section to improve agent performance with Ralph Loops.

#### GET /api/workspaces/:id/agents-md

Get the current AGENTS.md content and optimization status for a workspace.

**Response**

```json
{
  "content": "# AGENTS.md - AI Coding Agent Guidelines\n...",
  "fileExists": true,
  "analysis": {
    "isOptimized": true,
    "currentVersion": 1,
    "updateAvailable": false
  }
}
```

| Field | Description |
|-------|-------------|
| `content` | File contents (empty string if file doesn't exist) |
| `fileExists` | Whether the AGENTS.md file exists in the workspace |
| `analysis.isOptimized` | Whether the file already has a Ralpher optimization section |
| `analysis.currentVersion` | Version of the existing optimization, or `null` |
| `analysis.updateAvailable` | Whether a newer optimization version is available |

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `workspace_not_found` | Workspace not found |
| 500 | `read_failed` | Failed to read AGENTS.md |

#### POST /api/workspaces/:id/agents-md/preview

Preview what the optimized AGENTS.md would look like without writing changes.

**Response**

```json
{
  "currentContent": "# AGENTS.md\n...",
  "proposedContent": "# AGENTS.md\n...\n## Agentic Workflow...",
  "analysis": {
    "isOptimized": false,
    "currentVersion": null,
    "updateAvailable": true
  },
  "fileExists": true,
  "ralpherSection": "## Agentic Workflow — Planning & Progress Tracking\n..."
}
```

| Field | Description |
|-------|-------------|
| `currentContent` | Current file contents (empty string if not found) |
| `proposedContent` | What the file would look like after optimization |
| `analysis` | Current optimization state |
| `fileExists` | Whether the file currently exists |
| `ralpherSection` | The Ralpher section that would be added or updated |

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `workspace_not_found` | Workspace not found |
| 500 | `read_failed` | Failed to read AGENTS.md |
| 500 | `preview_failed` | Failed to generate preview |

#### POST /api/workspaces/:id/agents-md/optimize

Apply the Ralpher optimization to the workspace's AGENTS.md file. If the file already has an optimization section at the current version, returns without changes.

**Response (optimization applied)**

```json
{
  "success": true,
  "alreadyOptimized": false,
  "content": "# AGENTS.md\n...\n## Agentic Workflow...",
  "analysis": {
    "isOptimized": true,
    "currentVersion": 1,
    "updateAvailable": false
  }
}
```

**Response (already optimized)**

```json
{
  "success": true,
  "alreadyOptimized": true,
  "content": "# AGENTS.md\n...",
  "analysis": {
    "isOptimized": true,
    "currentVersion": 1,
    "updateAvailable": false
  }
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `workspace_not_found` | Workspace not found |
| 500 | `read_failed` | Failed to read AGENTS.md |
| 500 | `write_failed` | Failed to write optimized AGENTS.md |
| 500 | `optimize_failed` | Failed to optimize AGENTS.md |

---

### Server Settings

Server settings are configured per-workspace. Each workspace can have different connection settings, allowing different providers/transports per project.
Settings use a single contract:

```json
{
  "agent": {
    "provider": "opencode | copilot",
    "transport": "stdio | ssh",
    "hostname": "required for ssh",
    "port": 22,
    "username": "optional",
    "password": "optional"
  }
}
```

Execution behavior is derived automatically from `agent.transport`:
- `stdio` → local deterministic execution
- `ssh` → remote deterministic execution over SSH

#### GET /api/workspaces/:id/server-settings

Get server settings for a specific workspace.

**Response**

```json
{
  "agent": {
    "provider": "opencode",
    "transport": "stdio"
  }
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Workspace not found |

#### PUT /api/workspaces/:id/server-settings

Update server settings for a workspace.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent.provider` | string | Yes | `opencode` or `copilot` |
| `agent.transport` | string | Yes | `stdio` or `ssh` |
| `agent.hostname` | string | For `ssh` | SSH hostname |
| `agent.port` | number | No | SSH port (default `22`) |
| `agent.username` | string | No | SSH username |
| `agent.password` | string | No | SSH password |

**Response**

```json
{
  "agent": {
    "provider": "copilot",
    "transport": "ssh",
    "hostname": "remote.example.com",
    "port": 22,
    "username": "vscode",
    "password": "***"
  }
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `validation_error` | Invalid settings payload |
| 404 | `workspace_not_found` | Workspace not found |

#### GET /api/workspaces/:id/server-settings/status

Get connection status for a workspace.

**Response**

```json
{
  "connected": true,
  "provider": "opencode",
  "transport": "ssh",
  "capabilities": ["session/list", "session/load"],
  "serverUrl": "ssh://remote.example.com:22",
  "directoryExists": true,
  "isGitRepo": true
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `workspace_not_found` | Workspace not found |

#### POST /api/workspaces/:id/server-settings/test

Test connection with provided settings for a workspace.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent.provider` | string | Yes | `opencode` or `copilot` |
| `agent.transport` | string | Yes | `stdio` or `ssh` |
| `agent.hostname` | string | For `ssh` | SSH hostname |
| `agent.port` | number | No | SSH port (default `22`) |
| `agent.username` | string | No | SSH username |
| `agent.password` | string | No | SSH password |

If no body (or `{}`) is provided, the workspace's current settings are used.

**Response**

```json
{
  "success": true,
  "message": "Connection successful"
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `invalid_json` | Request body is not valid JSON |
| 400 | `validation_error` | Proposed settings do not match schema |
| 404 | `workspace_not_found` | Workspace not found |

#### POST /api/workspaces/:id/server-settings/reset

Reset the connection for a specific workspace. Clears connection state so the next operation will establish a fresh connection.

**Response**

```json
{
  "success": true
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `not_found` | Workspace not found |

#### POST /api/server-settings/test

Test a server connection without requiring a workspace. Useful for validating connection settings before creating a workspace.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `settings` | object | Yes | Server settings to test |
| `settings.agent.provider` | string | Yes | `opencode` or `copilot` |
| `settings.agent.transport` | string | Yes | `stdio` or `ssh` |
| `settings.agent.hostname` | string | For `ssh` | SSH hostname |
| `settings.agent.port` | number | No | SSH port (default `22`) |
| `settings.agent.username` | string | No | SSH username |
| `settings.agent.password` | string | No | SSH password |
| `directory` | string | Yes | Directory path to test against |

**Response**

```json
{
  "success": true,
  "message": "Connection successful"
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `validation_error` | Missing or invalid fields |
| 500 | — | Connection test failed (returns `{ success: false, error: "..." }`) |

#### POST /api/settings/reset-all

Delete database and reinitialize. This is a destructive operation that deletes all loops, workspaces, sessions, and preferences. The database is recreated fresh with all migrations applied.

**Response**

```json
{
  "success": true,
  "message": "All settings have been reset. Database recreated."
}
```

---

### Server

#### POST /api/server/kill

Terminate the server process. This is a **destructive** operation. In containerized environments (e.g., Kubernetes), this will cause the container to restart, potentially pulling an updated image.

The server sends a success response before scheduling the exit to ensure the client receives confirmation.

**Response**

```json
{
  "success": true,
  "message": "Server is shutting down. The connection will be lost."
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

#### GET /api/git/default-branch

Get the default branch for a git repository (e.g., "main" or "master").

**Query Parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `directory` | Yes | Directory path to check |

**Response**

```json
{
  "defaultBranch": "main"
}
```

**Errors**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `missing_parameter` | directory query parameter is required |
| 400 | `not_git_repo` | Directory is not a git repository |
| 500 | `git_error` | Failed to retrieve default branch |

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
| `loop.session_aborted` | AI session was aborted |
| `loop.error` | Error occurred |
| `loop.deleted` | Loop was deleted |
| `loop.accepted` | Branch was merged |
| `loop.pushed` | Branch was pushed to remote |
| `loop.discarded` | Branch was deleted |
| `loop.sync.started` | Branch sync with base started |
| `loop.sync.clean` | Branch sync completed cleanly |
| `loop.sync.conflicts` | Merge conflicts detected during sync |
| `loop.plan.ready` | Plan is ready for review (planning mode) |
| `loop.plan.feedback` | Feedback was sent on plan |
| `loop.plan.accepted` | Plan was accepted, execution starting |
| `loop.plan.discarded` | Plan was discarded, loop deleted |
| `loop.todo.updated` | TODO list was updated |
| `loop.pending.updated` | Pending message/model was updated |

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

{"type":"loop.plan.ready","loopId":"abc-123","planContent":"# Plan\n\n## Goals\n...","timestamp":"2026-01-20T10:16:00.000Z"}

{"type":"loop.todo.updated","loopId":"abc-123","todos":[{"id":"1","content":"Implement feature","status":"in_progress"}],"timestamp":"2026-01-20T10:17:00.000Z"}
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
| `draft` | Saved as draft, not started (no git branch or session) |
| `planning` | In plan mode, awaiting plan approval |
| `starting` | Initializing backend connection |
| `running` | Actively executing |
| `waiting` | Between iterations |
| `completed` | Stop pattern matched |
| `stopped` | Manually stopped |
| `failed` | Error occurred |
| `max_iterations` | Hit iteration limit |
| `resolving_conflicts` | Resolving merge conflicts with base branch before push |
| `merged` | Changes merged into original branch |
| `pushed` | Branch pushed to remote (can receive reviews) |
| `deleted` | Marked for deletion (terminal state) |

Note: Only `deleted` is a true terminal state (no further transitions possible). `merged` and `pushed` can transition to `idle` (restart) or `deleted`.

### File Diff Status

| Status | Description |
|--------|-------------|
| `added` | New file |
| `modified` | File changed |
| `deleted` | File removed |
| `renamed` | File renamed |

### Log Levels

Log levels used in `loop.log` events:

| Level | Description |
|-------|-------------|
| `agent` | AI agent activity |
| `user` | User-initiated actions |
| `info` | General information |
| `warn` | Warning messages |
| `error` | Error messages |
| `debug` | Debug/verbose output |
| `trace` | Detailed trace output |

### Review Comment Status

| Status | Description |
|--------|-------------|
| `pending` | Comment is being worked on |
| `addressed` | Comment has been addressed |

### Iteration Outcome

| Outcome | Description |
|---------|-------------|
| `continue` | Iteration complete, loop continues |
| `complete` | Stop pattern matched, loop complete |
| `error` | Error occurred during iteration |
| `plan_ready` | Plan created and ready for review (planning mode) |

### Commit Message Format

Ralpher generates commit messages following the [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) specification:

```
type(scope): description
```

The `scope` is configured via `git.commitScope` (default: `"ralph"`). Valid types: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `build`, `ci`, `chore`, `perf`, `revert`.

Examples:
- `feat(ralph): add JWT authentication endpoint`
- `fix(ralph): handle token expiration edge case`
- `chore(ralph): iteration 3 - auth.ts, tests.ts`

### TODO Item

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `content` | string | TODO item description |
| `status` | string | "pending", "in_progress", "completed", or "cancelled" |
| `priority` | string | "high", "medium", or "low" |

---

## Examples

### Create a Loop

Loops are automatically started upon creation (unless `draft: true`).

```bash
# Create a loop (starts automatically, name is auto-generated)
curl -X POST http://localhost:3000/api/loops \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws-abc123",
    "prompt": "Implement JWT-based authentication with login and signup endpoints",
    "model": { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" },
    "planMode": false
  }'

# Response: {"config":{"id":"abc-123",...},"state":{"status":"running",...}}

# Watch events via WebSocket (use wscat or similar)
wscat -c ws://localhost:3000/api/ws?loopId=abc-123
```

### Create a Draft Loop

Draft loops are saved without starting. You can edit them before starting.

```bash
# Create a draft loop (name is auto-generated)
curl -X POST http://localhost:3000/api/loops \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws-abc123",
    "prompt": "Implement JWT-based authentication",
    "model": { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" },
    "planMode": false,
    "draft": true
  }'

# Response: {"config":{"id":"abc-123",...},"state":{"status":"draft",...}}

# Later, update the draft
curl -X PUT http://localhost:3000/api/loops/abc-123 \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Implement JWT-based authentication with refresh tokens"
  }'

# Start the draft
curl -X POST http://localhost:3000/api/loops/abc-123/draft/start \
  -H "Content-Type: application/json" \
  -d '{"planMode": false}'
```

### Create a Loop with Plan Mode

Plan mode lets you review and refine the plan before execution.

```bash
# Create a loop in plan mode (name is auto-generated)
curl -X POST http://localhost:3000/api/loops \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws-abc123",
    "prompt": "Refactor the authentication module to use async/await",
    "model": { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" },
    "planMode": true
  }'

# Response: {"config":{"id":"abc-123",...},"state":{"status":"planning",...}}

# Send feedback on the plan
curl -X POST http://localhost:3000/api/loops/abc-123/plan/feedback \
  -H "Content-Type: application/json" \
  -d '{"feedback": "Also consider adding error handling for token expiration"}'

# Accept the plan and start execution
curl -X POST http://localhost:3000/api/loops/abc-123/plan/accept
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

### Address Reviewer Comments

After pushing a loop, you can address reviewer comments:

```bash
# Push the loop first
curl -X POST http://localhost:3000/api/loops/abc-123/push
# Response: {"success":true,"remoteBranch":"ralph/my-feature","syncStatus":"clean"}

# Later, address reviewer comments
curl -X POST http://localhost:3000/api/loops/abc-123/address-comments \
  -H "Content-Type: application/json" \
  -d '{"comments": "Please fix the type errors and add error handling"}'
# Response: {"success":true,"reviewCycle":1,"branch":"ralph/my-feature"}

# Get review history
curl http://localhost:3000/api/loops/abc-123/review-history
# Response: {"success":true,"history":{"addressable":true,"completionAction":"push","reviewCycles":1,"reviewBranches":[]}}
```
