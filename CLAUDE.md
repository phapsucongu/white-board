# CLAUDE.md - Project Instructions

You are assisting with the **Realtime Collaborative Tactical Whiteboard** project.

## Project goal

Build a web app where multiple authenticated users can collaborate in real time on a tactical whiteboard/canvas. Users can draw and manipulate objects, see presence/cursors, reconnect safely, use undo/redo, access version history, and work under account-based permissions.

## Fixed technical stack

Use this stack unless the user explicitly asks to change it:

- Frontend: React + Vite + TypeScript
- Canvas: React-Konva / Konva
- Client local state: Zustand
- Server state/data fetching: TanStack Query
- Backend: NestJS + TypeScript
- Realtime: Socket.IO
- Database: PostgreSQL
- ORM: Prisma
- Cache/pubsub/presence, optional later: Redis or Valkey
- Auth: JWT access token + refresh token rotation
- Testing: Vitest/React Testing Library on frontend, Jest/Supertest on backend

## Architectural rules

1. Server is authoritative for persistent board state.
2. Client may optimistically render, but server must validate every persistent operation.
3. Split realtime events into:
   - Persistent board operations: create/update/delete/undo/redo/version restore.
   - Ephemeral events: cursor, selection, viewport, presence heartbeat.
4. Persistent operations must include:
   - `roomId`
   - `operationId`
   - `clientId`
   - `objectId` when applicable
   - `baseVersion` or equivalent version guard
   - validated payload
5. Authorization is required on both REST and WebSocket handlers.
6. Viewers cannot mutate board state.
7. Editors can mutate board state.
8. Owners can manage room settings, roles, and destructive actions.
9. Every object must have stable IDs and version metadata.
10. Reconnect must use `lastKnownVersion`; if delta replay is unavailable, server sends full snapshot.

## Coding rules

- Use TypeScript strict typing.
- Do not use `any` unless unavoidable and explained.
- Prefer small pure functions for operation validation and state application.
- Keep API DTOs explicit.
- Validate all REST and Socket.IO payloads.
- Keep domain logic outside controllers/gateways when possible.
- Do not place secrets in code.
- Do not make broad refactors while implementing a feature.
- Do not introduce new dependencies without explaining why.
- Do not change public API/event names without updating docs.

## Required workflow for every task

Before editing code:

1. Restate the task in 3-5 bullets.
2. List files you will inspect or modify.
3. Identify affected contracts:
   - REST API
   - WebSocket event names/payloads
   - Prisma schema
   - frontend state shape
4. Mention risks or edge cases.

After editing code:

1. Summarize changed files.
2. Explain how to test manually.
3. List commands to run.
4. Mention docs that need updates.

## Do not do these

- Do not rewrite the whole architecture.
- Do not mix auth, canvas rendering, realtime sync, and database migration in one uncontrolled change.
- Do not create fake APIs that are not wired to backend.
- Do not store board history only on the client.
- Do not trust role sent by client.
- Do not emit persistent changes directly to other clients before server validation.
