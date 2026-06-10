# GitHub Copilot Instructions

This repository is a Realtime Collaborative Tactical Whiteboard.

## Use this stack

Frontend: React + Vite + TypeScript, React-Konva, Zustand, TanStack Query.  
Backend: NestJS + TypeScript, Socket.IO, PostgreSQL, Prisma.  
Auth: JWT access token + refresh token rotation.

## Core behavior

- Users authenticate with accounts.
- Rooms have roles: Owner, Editor, Viewer.
- Editors and Owners can mutate board state.
- Viewers can join and observe only.
- Persistent board operations go through the server.
- Ephemeral cursor/presence events are not persisted.
- Reconnect uses `lastKnownVersion` and returns deltas or snapshot.
- Version history uses board events and snapshots.

## Copilot must avoid

- Generating unvalidated Socket.IO handlers.
- Trusting client-provided roles.
- Changing event names without updating docs.
- Storing secrets in source.
- Mixing unrelated features in one change.

## Preferred code style

- TypeScript strict.
- Explicit DTOs and interfaces.
- Small services with testable functions.
- Clear error handling.
- Use guards/middleware for auth and role checks.
