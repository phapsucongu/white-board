# Conflict Resolution Plan

## Goals

Complete conflict handling for concurrent edits so the board can accept safe parallel work, reject risky writes with actionable details, and keep offline operations recoverable.

## Current State

- Board writes include `baseVersion` and object `expectedVersion`.
- Stale board versions are currently rejected before checking whether changes are actually compatible.
- Text editing uses Yjs persistence, but the text editor flow still commits whole-text updates instead of exposing true live character-level collaboration.
- Offline writes are queued, but replayed operations are removed too early to preserve conflicts.

## Phase 1: Object Field-Level Merge

- Add a backend conflict resolution service for `object:update`.
- When `baseVersion` is stale, read missed board events from Postgres.
- Auto-merge the update if intervening events touched different fields on the same object.
- Reject if the object was deleted, recreated, or the same scalar/`props`/`metadata` key was changed.
- Return structured conflict details: current version, object id, conflicting fields, client patch, and server patch.

## Phase 2: Client Conflict Handling

- Include `clientOpId` on accepted and rejected socket responses.
- Remove offline operations only after an accepted response.
- Mark rejected replay operations as `conflicted` in IndexedDB, with conflict details preserved.
- Show concise UI errors so users know whether a conflict can be retried or needs manual resolution.

## Phase 3: Collaborative Text Editing

- Move text editing to a live Yjs document per text object.
- Send incremental Yjs updates while editing, not only when committing.
- Keep Redis for live fanout and Postgres for persisted Yjs state.
- Use object-level text leases as presence and soft-lock hints, not as the sole conflict mechanism.

## Phase 4: Manual Resolution UI

- Add a conflict drawer for rejected offline or stale operations.
- Let users compare local patch vs latest server object.
- Provide actions: apply again, discard local change, or duplicate as a new object when appropriate.

## Test Plan

- Backend unit tests for compatible stale updates, same-field conflicts, deletes, and idempotent `clientOpId`.
- Gateway tests for accepted/rejected `clientOpId` and structured conflict details.
- Frontend tests for conflict message formatting and offline outbox status transitions.
- Manual verification with two clients editing the same object and same text object.
