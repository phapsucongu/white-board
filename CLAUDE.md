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

A `docker-compose.yml` at the repo root provides PostgreSQL (port 5432) and Redis (port 6379, declared but unused — planned for Socket.IO adapter scaling). Start with `docker compose up -d postgres`. The backend uses `.env` for `DATABASE_URL`; it reads both `../.env` (repo root) and `.env` (backend dir) via NestJS ConfigModule.

## Architecture

### Monorepo layout

```
├── pnpm-workspace.yaml      # frontend, backend, packages/*
├── backend/                  # NestJS, CommonJS modules, Jest
│   └── prisma/schema.prisma  # single source of DB truth
├── frontend/                 # React + Vite, ESM, Vitest
└── packages/shared/          # @whiteboard/shared — shared TypeScript types
```

`@whiteboard/shared` is a workspace dependency consumed by both frontend and backend. It defines `BoardObject`, `BoardObjectType`, `BoardObjectId`, `RoomId`, `UserId`, and `SocketEventName`. The `SocketEventName` type in shared is **stale** — it lists legacy event names (`board:op`, `shape:preview`, `text:lease:*`) that don't match the actual events currently used (`board:event`, `board:event:accepted`, `board:event:broadcast`, `board:event:rejected`).

### Backend module structure

- **`AppModule`** — top-level, imports all feature modules, exports PrismaModule
- **`AuthModule`** — register, login, refresh, logout; JWT signing + bcrypt refresh token rotation
- **`UsersModule`** — user lookup, creation, public-user projection
- **`RoomsModule`** — CRUD for rooms and members; also contains `VersionHistoryController` and `VersionHistoryService` for event log inspection and version tagging
- **`BoardModule`** — `BoardService`: event-sourced board operations (`object:create`, `object:update`, `object:delete`) with optimistic concurrency at both board level (`baseVersion`) and object level (`expectedVersion`)
- **`RealtimeModule`** — `RoomGateway` (Socket.IO gateway) + `PresenceService` (in-memory, multi-socket per user)
- **`PermissionsModule`** — role-based guards (`canViewRoom`, `canEditRoom`, `canManageRoom`) + `@RequiredRoomRole` decorator
- **`PrismaModule`** — singleton `PrismaService` for database access

The gateway authenticates sockets via middleware in `afterInit`. Token extraction supports both `auth.token` (Socket.IO handshake auth) and `Authorization` header (HTTP upgrade). Board event acceptance goes through `board:event` → server validates, applies, broadcasts to other room members via `board:event:broadcast` and confirms to sender via `board:event:accepted`.

### Database model

Defined in `backend/prisma/schema.prisma`. Key tables:

- **User** — id, email, passwordHash, displayName
- **RefreshSession** — per-user sessions with hashed token secrets, support rotation on refresh
- **Room** — id, name, ownerId (FK to User)
- **RoomMember** — junction with roomId + userId unique constraint, role enum (OWNER/EDITOR/VIEWER)
- **BoardState** — one row per room (roomId is unique), materialized snapshot (snapshotJson JSON column) with version counter
- **BoardEvent** — append-only event log, unique on (roomId, version), stores eventType + payloadJson + actorId
- **VersionTag** — user-labeled checkpoints at specific versions, unique on (roomId, version, label)

### Board event sourcing and sync

The server uses an **append-only event log** with a **materialized snapshot** pattern:

1. `applyBoardEvent` runs in a `$transaction` — reads current `BoardState.version`, increments it, writes a `BoardEvent` row, upserts the `BoardState` snapshot
2. Optimistic concurrency: if `baseVersion` doesn't match the current version, a `ConflictException` (HTTP 409) is thrown
3. Object-level concurrency: `expectedVersion` on update/delete payloads is checked against the object's current version in the snapshot

Reconnect sync uses a delta-vs-snapshot threshold (`MAX_DELTA_SYNC_EVENTS = 50`). If the client's `lastKnownVersion` is within 50 versions of current, the server returns missed events (delta sync). Otherwise, it returns the full snapshot.

`normalizeSnapshot` silently drops invalid objects from the snapshot — this masks schema migration issues and data corruption.

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
- `frontend/src/realtime/useRoomRealtime.ts` — the largest and most complex file. Handles Socket.IO lifecycle, presence normalization, undo/redo stack management with pending-history queuing, delta/snapshot sync application, and event emission with history entry tracking.
- `frontend/src/auth/AuthContext.tsx` — React context providing `accessToken`, `user`, `login`, `register`, `logout`, and `runWithAuth` (auto-refresh wrapper). On mount, auto-attempts session restoration from stored refresh token.

### Undo/redo architecture

Undo/redo is **client-side only**. The server is stateless regarding history — it only validates version numbers. Each board operation creates a `BoardHistoryEntry` with `undo` and `redo` operations (inverse pairs). When the server acks an event, it completes the pending history entry. Undo/redo emits the inverse operation as a new board event.

The pending queue is FIFO-based — it always dequeues from the front. If server acknowledgements arrive out of order, the wrong history entry gets completed. There is no ID-based correlation between `board:event:accepted` and the pending intent.

Undo/redo version bumping (`prepareRedoEntryAfterUndo`, `prepareUndoEntryAfterRedo`) hardcodes `expectedVersion + 1` and `expectedVersion = 1`. If the server ever uses a non-sequential version counter, this produces stale values.

### Known sharp edges

These are known issues tracked in `PROJECT_REVIEW.md`:

1. **`isCreateBoardObjectPayload` type guard only accepts `rectangle`** (`useRoomRealtime.ts:811`). Creating a circle, line, or text throws an unhandled exception from `createHistoryEntry` → app crash. The guard should accept any `BoardObject['type']`.
2. **Visual flicker on object creation** — the draft is cleared immediately after drawing but the confirmed object only appears after the server round-trip. No optimistic update.
3. **Socket status stuck at `'error'`** between reconnect attempts — `status` is set to `'error'` on `connect_error` but never reset to `'connecting'` on the `connect` event.
4. **WebSocket-only transport** (`transports: ['websocket']` in `useRoomRealtime.ts:257`) — disables Socket.IO's long-polling fallback, breaking the app behind restrictive corporate proxies.
5. **Event payloads stored as raw input** — `payloadJson: input.payload` couples the audit trail to the request format. Any schema change breaks historical event readability.
6. **Undo/redo has zero test coverage** — the most complex frontend logic is entirely untested.
7. **CSS color values hardcoded** — no custom properties, making theming difficult.
8. **`BoardObject` geometry split** — `x`/`y` are top-level but `width`/`height` are inside `props`, architecturally inconsistent.
9. **`@whiteboard/shared` `SocketEventName` type is stale** — lists events the system no longer uses.
10. **Ownership transfer explicitly throws "not implemented"** (`rooms.service.ts:204`).

### TypeScript configurations

- `tsconfig.base.json` — shared base: `strict: true`, `target: ES2022`, `moduleResolution: Bundler`
- `backend/tsconfig.json` — extends base, adds `CommonJS` module, decorator metadata, `rootDir: ./src`
- `frontend/tsconfig.json` — extends base, adds `composite: true`, `jsx: react-jsx`, DOM libs, `noEmit`
