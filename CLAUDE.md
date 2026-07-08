# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Identity

Real-Time Collaborative Tactical Whiteboard — full-stack pnpm monorepo with a NestJS backend (PostgreSQL/Prisma, Socket.IO) and a React frontend (Konva canvas, Zustand state, Socket.IO client). Auth uses JWT access tokens + bcrypt refresh token rotation with role-based authorization (OWNER/EDITOR/VIEWER).

## Commands

All commands run from the repo root unless noted otherwise.

```bash
# Install dependencies (uses pnpm workspaces)
pnpm install

# Start both frontend (port 5173) and backend (port 3000) in parallel
pnpm dev

# Start only one side
pnpm dev:fe          # frontend only
pnpm dev:be          # backend only

# Build all workspace packages
pnpm build

# Run all tests across the monorepo
pnpm test

# Run backend tests (uses Jest)
cd backend && npx jest --passWithNoTests

# Run a single backend test file
cd backend && npx jest src/board/board.service.spec.ts

# Run a single backend test by name pattern
cd backend && npx jest -t "should apply create event"

# Run frontend tests (uses Vitest)
cd frontend && npx vitest run --passWithNoTests

# Run a single frontend test file
cd frontend && npx vitest run src/board/boardStore.test.ts

# Run Prisma operations (from backend directory)
cd backend && npx prisma generate    # regenerate Prisma client after schema changes
cd backend && npx prisma db push     # push schema changes to dev DB
cd backend && npx prisma migrate dev # create and apply a new migration

# Lint all workspace packages
pnpm lint

# Lint a single workspace
cd backend && npx eslint "src/**/*.ts"
cd frontend && npx eslint "src/**/*.{ts,tsx}"
```

### Database

A `docker-compose.yml` at the repo root provides PostgreSQL (port 5432) and Redis (port 6379). Start with `docker compose up -d postgres`. The backend uses `.env` for `DATABASE_URL`; it reads both `../.env` (repo root) and `.env` (backend dir) via NestJS ConfigModule. Redis is optional: when `REDIS_URL` is set, `CollaborationService.onModuleInit` attaches the `@socket.io/redis-adapter` to the Socket.IO server so the gateway can scale across multiple backend instances. Without it, everything runs single-instance in-memory.

## Architecture

### Monorepo layout

```
├── pnpm-workspace.yaml      # frontend, backend, packages/*
├── backend/                  # NestJS, CommonJS modules, Jest
│   └── prisma/schema.prisma  # single source of DB truth
├── frontend/                 # React + Vite, ESM, Vitest
└── packages/shared/          # @whiteboard/shared — shared TypeScript types
```

`@whiteboard/shared` is a workspace dependency consumed by both frontend and backend. It defines `BoardObject`, `BoardObjectType` (`rectangle | circle | line | text`), `BoardObjectId`, `RoomId`, `UserId`, `BoardEvent`, and `SocketEventName`. `SocketEventName` now enumerates the real gateway events (`board:event`, `board:event:accepted/broadcast/rejected`, `board:snapshot:restored`, `cursor:*`, `selection:*`, `text:lease:*`, etc.). Note the string casing seam: this shared `RoomRole` type is lowercase (`owner | editor | viewer`) while the backend Prisma `RoomRole` enum and `room-role.enum.ts` are uppercase (`OWNER | EDITOR | VIEWER`).

### Backend module structure

- **`AppModule`** — top-level, imports all feature modules, exports PrismaModule
- **`AuthModule`** — register, login, refresh, logout; JWT signing + bcrypt refresh token rotation
- **`UsersModule`** — user lookup, creation, public-user projection
- **`RoomsModule`** — CRUD for rooms and members (rooms carry a unique `inviteCode` for join-by-code); also hosts `VersionHistoryController`/`VersionHistoryService` (event log inspection + version tagging) and `CommentsController`/`CommentsService` (board/object-anchored comments)
- **`BoardModule`** — `BoardService`: event-sourced board operations (`object:create`, `object:update`, `object:delete`) with optimistic concurrency at both board level (`baseVersion`) and object level (`expectedVersion`). Also exports `ConflictResolutionService` (produces `BoardConflictException` with structured `details` — conflicting fields, client/server patches, current object). Event payloads are wrapped by `board-event-payload.codec.ts` before persistence.
- **`RealtimeModule`** — `RoomGateway` (Socket.IO gateway) + `PresenceService` (in-memory, multi-socket per user) + `RealtimeRoomEventsService` (emits `board:snapshot:restored` to a room after a version restore)
- **`CollaborationModule`** — `CollaborationService`: live cursors, object selections, text-edit leases, and **Yjs-based collaborative text** (`TextDocument` persistence, `text:yjs:*` update relay). Also owns Redis adapter wiring. Imported by `RealtimeModule`; **not** listed directly in `AppModule.imports`.
- **`PermissionsModule`** — role-based guards (`canViewRoom`, `canEditRoom`, `canManageRoom`) + `@RequiredRoomRole` decorator
- **`PrismaModule`** — singleton `PrismaService` for database access

The gateway authenticates sockets via middleware in `afterInit`. Token extraction supports both `auth.token` (Socket.IO handshake auth) and `Authorization` header (HTTP upgrade). Board event acceptance goes through `board:event` → server validates, applies, broadcasts to other room members via `board:event:broadcast` and confirms to sender via `board:event:accepted` (rejections via `board:event:rejected`). The gateway also handles `cursor:update`, `selection:update`, `text:lease:claim`/`release`, `text:yjs:update`, `comment:new`, and `shape:preview`, delegating live-collaboration state to `CollaborationService`.

### Database model

Defined in `backend/prisma/schema.prisma`. Key tables:

- **User** — id, email, passwordHash, displayName
- **RefreshSession** — per-user sessions with hashed token secrets, support rotation on refresh
- **Room** — id, name, ownerId (FK to User)
- **RoomMember** — junction with roomId + userId unique constraint, role enum (OWNER/EDITOR/VIEWER)
- **BoardState** — one row per room (roomId is unique), materialized snapshot (snapshotJson JSON column) with version counter
- **BoardEvent** — append-only event log, unique on (roomId, version), stores eventType + payloadJson + actorId + optional `clientOpId` (idempotency/ack correlation key)
- **VersionTag** — user-labeled checkpoints at specific versions, unique on (roomId, version, label)
- **Comment** — board- or object-anchored (`objectId`, optional `x`/`y`) discussion thread entries with `resolved` flag
- **TextDocument** — one row per text object (`objectId` unique), stores the Yjs doc as `ydocBase64` plus a materialized `text` string

### Board event sourcing and sync

The server uses an **append-only event log** with a **materialized snapshot** pattern:

1. `applyBoardEvent` runs in a `$transaction` — reads current `BoardState.version`, increments it, writes a `BoardEvent` row, upserts the `BoardState` snapshot
2. Optimistic concurrency: if `baseVersion` doesn't match the current version, a `ConflictException` (HTTP 409) is thrown
3. Object-level concurrency: `expectedVersion` on update/delete payloads is checked against the object's current version in the snapshot

Reconnect sync uses a delta-vs-snapshot threshold (`MAX_DELTA_SYNC_EVENTS = 50`). If the client's `lastKnownVersion` is within 50 versions of current, the server returns missed events (delta sync). Otherwise, it returns the full snapshot.

`normalizeSnapshot` silently drops invalid objects from the snapshot — this masks schema migration issues and data corruption.

Persisted `BoardEvent.payloadJson` is written through `encodeBoardEventPayload` (an `{ schemaVersion: 1, eventType, payload }` envelope) and read back through `decodeBoardEventPayload`, which also transparently unwraps legacy pre-envelope rows. When a stale event arrives, `ConflictResolutionService.resolveStaleEvent` attempts to rebase it against missed events before deciding whether to throw `BoardConflictException`.

### Frontend data flow

```
AuthContext (JWT tokens, user)
  └── RoomPage (loads room metadata + board snapshot via REST)
        ├── useRoomRealtime (Socket.IO connection, presence, board events)
        │     └── useBoardStore (Zustand — objects, boardVersion, viewport, tool)
        └── BoardCanvas (React-Konva, renders objects from store)
```

**Key files:**
- `frontend/src/api/client.ts` — typed REST API client with automatic JSON serialization, auth header injection, and error handling
- `frontend/src/board/boardStore.ts` — Zustand store managing board objects map, version tracking, tool selection, and viewport state. Applies accepted events idempotently (checks `version <= boardVersion`). Also contains `createLocalRectangleObject` for client-side rectangle geometry computation.
- `frontend/src/realtime/useRoomRealtime.ts` — the largest and most complex file. Handles Socket.IO lifecycle, presence/cursor/selection normalization, undo/redo stack management with pending-history queuing, delta/snapshot sync application, and event emission with history entry tracking.
- `frontend/src/realtime/offlineOutbox.ts` — IndexedDB-backed outbox (`whiteboard-offline` DB) that queues `board:event` operations while disconnected and replays them on reconnect; entries carry `pending`/`conflicted` status.
- `frontend/src/versions/versionHistory.ts` — client helpers for the version-history / version-tag REST endpoints.
- `frontend/src/auth/AuthContext.tsx` — React context providing `accessToken`, `user`, `login`, `register`, `logout`, and `runWithAuth` (auto-refresh wrapper). On mount, auto-attempts session restoration from stored refresh token.

### Undo/redo architecture

Undo/redo is **client-side only**. The server is stateless regarding history — it only validates version numbers. Each board operation creates a `BoardHistoryEntry` with `undo` and `redo` operations (inverse pairs). When the server acks an event, it completes the pending history entry. Undo/redo emits the inverse operation as a new board event.

The pending queue is FIFO-based. The gateway now echoes a `clientOpId` on `board:event:accepted`/`board:event:rejected`, so acks *can* be correlated by ID — but confirm `useRoomRealtime.ts` actually matches on it rather than blindly dequeuing from the front before assuming out-of-order acks are handled.

Undo/redo version bumping (`prepareRedoEntryAfterUndo`, `prepareUndoEntryAfterRedo`) hardcodes `expectedVersion + 1` and `expectedVersion = 1`. If the server ever uses a non-sequential version counter, this produces stale values.

### Known sharp edges

These are tracked in `PROJECT_REVIEW.md` (the authoritative list; some entries below have since been fixed — re-check against code before relying on any of them):

1. **Ownership transfer explicitly throws** — `rooms.service.ts` raises `BadRequestException('Ownership transfer is not implemented')`.
2. **Socket status can stick at `'error'`** between reconnect attempts — `status` is set to `'error'` on `connect_error`; verify it is reset to `'connecting'`/`'joined'` on recovery.
3. **Visual flicker on object creation** — historically the draft was cleared before the confirmed object arrived from the server round-trip; confirm whether the offline outbox / optimistic path now covers this.
4. **Undo/redo has thin test coverage** — the most complex frontend logic; treat changes there carefully.
5. **`BoardObject` geometry split** — `x`/`y` are top-level but `width`/`height` live inside `props`, an architectural inconsistency.
6. **CSS color values hardcoded** — no custom properties, making theming difficult.

Already fixed since earlier revisions of this doc (kept as history): the `isCreateBoardObjectPayload` guard now accepts all four object types; the WebSocket-only `transports` override is gone; `BoardEvent` payloads are now envelope-encoded via the codec; and `@whiteboard/shared`'s `SocketEventName` is current.

### TypeScript configurations

- `tsconfig.base.json` — shared base: `strict: true`, `target: ES2022`, `moduleResolution: Bundler`
- `backend/tsconfig.json` — extends base, adds `CommonJS` module, decorator metadata, `rootDir: ./src`
- `frontend/tsconfig.json` — extends base, adds `composite: true`, `jsx: react-jsx`, DOM libs, `noEmit`

## Agent skills

### Issue tracker

Issues and PRDs live as local markdown under `.scratch/<feature-slug>/`; there is no external issue tracker, so PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded on a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root (both created lazily when first needed). See `docs/agents/domain.md`.
