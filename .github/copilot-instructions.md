# GitHub Copilot Instructions

This repository is a real-time collaborative tactical whiteboard built as a pnpm monorepo.

## Architecture at a glance

- Frontend: React + Vite + TypeScript, Zustand, React-Konva, and Socket.IO client.
- Backend: NestJS + TypeScript, Prisma, PostgreSQL, and Socket.IO server.
- Shared types: workspace package in packages/shared.
- Auth: JWT access tokens with refresh token rotation and room roles (OWNER, EDITOR, VIEWER).

## What matters most

- Board mutations are server-authoritative. Do not trust client-provided roles or bypass server validation.
- Persistent board state should flow through the backend event-sourcing flow rather than being mutated only in the client.
- Socket event names and payload contracts are part of the public protocol; changing them requires coordinated updates.
- Keep changes scoped and avoid mixing unrelated features in one patch.

## Working conventions

- Prefer small, testable services and explicit DTOs/interfaces.
- Follow strict TypeScript and clear error handling.
- Use existing guards/middleware for auth and permission checks instead of adding ad-hoc checks.
- Add or update tests for behavior changes when practical.

## Useful commands

- pnpm install
- pnpm dev
- pnpm build
- pnpm test
- cd backend && npx jest --passWithNoTests
- cd frontend && npx vitest run --passWithNoTests
- cd backend && npx prisma generate

## Key places to inspect

- backend/src/board for board event handling and persistence
- backend/src/realtime for Socket.IO gateway and presence logic
- backend/src/permissions for role-based access control
- frontend/src/realtime and frontend/src/board for client-side realtime state and undo/redo behavior
- backend/prisma/schema.prisma for the database model

For full setup and workflow details, see README.md and CLAUDE.md.
