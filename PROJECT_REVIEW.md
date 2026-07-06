# Project Review: Real-Time Tactical Whiteboard

**Version:** v0.1.0 | **Date:** 2026-06-20 | **Branch:** `main`

Comprehensive review of this full-stack collaborative whiteboard. The project uses a **NestJS backend** (PostgreSQL/Prisma, Socket.IO) and **React frontend** (Konva canvas, Zustand state, Socket.IO client) in a pnpm monorepo.

---

## 🔴 High-Priority Issues

### 1. `isCreateBoardObjectPayload` only accepts `rectangle` type
**`frontend/src/realtime/useRoomRealtime.ts:811`**

```typescript
value.object.type === 'rectangle' &&
```

The type guard gates undo/redo history creation and delta sync. Creating any non-rectangle shape (circle, line, text) will:
- Throw an unhandled exception from `createHistoryEntry` → **app crash**
- Silently skip those shapes during delta sync

The type guard should accept any `BoardObject['type']`, not just `'rectangle'`.

### 2. Visual flicker on rectangle creation (no optimistic update)
**`frontend/src/board/BoardCanvas.tsx:274`**

When a user finishes drawing a rectangle, the draft is immediately cleared but the confirmed object only appears after the server round-trip completes. This creates a **visible blink** of up to hundreds of milliseconds. The store should be able to optimistically add objects before server confirmation.

### 3. `dequeuePendingHistory` assumes FIFO — no ID-based matching
**`frontend/src/realtime/useRoomRealtime.ts:200-205`**

The pending undo/redo queue always dequeues from the front. If network conditions cause the server to acknowledge events out of order, the wrong history entry gets completed. There's no correlation between the server's `board:event:accepted` and the specific pending intent.

---

## 🟡 Medium-Priority Issues

### 4. WebSocket-only transport disables Socket.IO polling fallback
**`frontend/src/realtime/useRoomRealtime.ts:257`**

```typescript
transports: ['websocket']
```

Corporate proxies and restrictive firewalls will block the app entirely. Socket.IO's auto-downgrade to long-polling is a critical reliability feature being bypassed.

### 5. Undo/redo version math assumes server increments by exactly +1
**`frontend/src/realtime/useRoomRealtime.ts` — `prepareRedoEntryAfterUndo`, `prepareUndoEntryAfterRedo`**

Both functions hardcode `expectedVersion + 1` and `expectedVersion = 1`. If the server ever uses a global version counter or skips versions, undo/redo produces stale `expectedVersion` values, causing server rejections.

### 6. Event payloads stored as raw input (tight coupling)
**`backend/src/board/board.service.ts:215`**

```typescript
payloadJson: input.payload as unknown as Prisma.InputJsonValue,
```

Internal fields like `expectedVersion` and `objectId` are persisted in the event log. This couples the audit trail to the request format — any future schema change breaks historical event readability.

### 7. No test coverage for undo/redo logic
**`frontend/src/realtime/useRoomRealtime.test.ts`**

The most complex logic in the frontend — `createHistoryEntry`, `completePendingHistory`, `applyRoomSync`, the undo/redo version bumping, and all three type guards — has **zero tests**.

### 8. Socket `status` stuck at `'error'` between reconnect attempts
**`frontend/src/realtime/useRoomRealtime.ts:334-339`**

On socket errors, `status` is set to `'error'` but never reset to `'connecting'` on the `connect` event. Only the `room:joined` handler sets it back, so there's a gap where the UI shows stale error state during automatic reconnection.

---

## 🟢 Low-Priority Issues

| # | Issue | File | Line |
|---|-------|------|------|
| 9 | `getVersionActorLabel` returns raw UUID — not user-friendly, intended stub but poor UX | `frontend/src/versions/versionHistory.ts` | 18 |
| 10 | `createBoardObjectId` fallback says "rectangle" for all object types — misleading | `frontend/src/board/boardStore.ts` | 337 |
| 11 | Dead `Number.isInteger` check — param already guaranteed by `ParseIntPipe` | `backend/src/rooms/version-history.service.ts` | 112 |
| 12 | CSS color values hardcoded — no custom properties, making theming difficult | `frontend/src/App.css` | multiple |
| 13 | `BoardObjectShape` not wrapped in `React.memo` — all shapes re-render on every state change | `frontend/src/board/BoardCanvas.tsx` | ~343 |
| 14 | Inconsistent async style — `loadVersionHistory` uses `.then()` chains vs `async/await` elsewhere | `frontend/src/pages/RoomPage.tsx` | 59 |
| 15 | Label validation inconsistency — DTO has `@MinLength(1)` but service trims and re-checks | `backend/src/rooms/version-history.service.ts` | 82-85 |
| 16 | `$transaction` mock is synchronous — no test coverage for transaction retry or rollback | `backend/src/board/board.service.spec.ts` | test setup |

---

## 📐 Architecture Notes

| Concern | Detail |
|---------|--------|
| **Optimistic concurrency** | Implemented at both board level (`baseVersion`) and object level (`expectedVersion`) — solid pattern |
| **Event sourcing** | Board operations are append-only events with materialized snapshot — correct approach for collaboration |
| **Redis declared but unused** | In `docker-compose.yml` but no code consumes it — likely planned for Socket.IO adapter scaling |
| **Ownership transfer gap** | Explicitly throws "not implemented" — known limitation |
| **NormalizeSnapshot drops invalid objects silently** | Would mask schema migration issues or data corruption |
| **No error boundary in React** | An unhandled exception in the realtime hook takes down the entire page |
| **BoardObject geometry split** | `x`/`y` are top-level but `width`/`height` are in `props` — architecturally inconsistent |
| **Undo/redo is client-side only** | Server is stateless regarding history; inverse operations emitted by client |

---

## 📊 Test Coverage Gaps

| Missing Test | File |
|-------------|------|
| `getReconnectSync` for non-existent room | `backend/src/board/board.service.spec.ts` |
| `getBoardSnapshotForRoom` (empty/return path) | `backend/src/board/board.service.spec.ts` |
| Duplicate version tag → 409 response | `backend/src/rooms/version-history.controller.spec.ts` |
| Version tag at version 0 (edge case) | `backend/src/rooms/version-history.controller.spec.ts` |
| Non-existent version → 404 | `backend/src/rooms/version-history.controller.spec.ts` |
| All undo/redo functions | `frontend/src/realtime/useRoomRealtime.test.ts` |
| `addObject`, `initializeRoom`, `setBoardSnapshot` store actions | `frontend/src/board/boardStore.test.ts` |
| PATCH validation (empty body → 400) | `backend/src/rooms/rooms.controller.spec.ts` |
| Transaction rollback behavior | `backend/src/board/board.service.spec.ts` |
| Mock `findMany` regression with dual `include` | `backend/src/rooms/rooms.controller.spec.ts` (latent bug in mock) |

---

## ✅ What's Well Done

- **Auth system**: JWT access + bcrypt refresh token rotation is properly implemented
- **Authorization**: Role-based guards (OWNER/EDITOR/VIEWER) with decorator-driven config
- **Idempotency guards**: Correct in both board store (`version <= boardVersion` checks) and server
- **Cross-room isolation**: Socket handlers check `payload.roomId !== roomId` before applying
- **Presence tracking**: Multi-socket per user, deduplication, proper leave/cleanup handling
- **Design system**: A well-specified "Tactical Precision" dark-mode theme with glassmorphism
- **Monorepo setup**: Clean workspace organization with shared types package

---

## 🔜 Recommended Next Steps

1. **Fix the type guard** (`isCreateBoardObjectPayload`) so undo/redo works for all shape types
2. **Implement optimistic object creation** to eliminate the canvas flicker
3. **Re-enable Socket.IO default transports** for network reliability
4. **Add undo/redo unit tests** — this is the riskiest untested code in the project
5. **Add a React Error Boundary** around the canvas/realtime components
6. **Extract CSS custom properties** for the color palette
7. **Make event-stored payloads independent** of the input request format
