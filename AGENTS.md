# Repository Guidelines

## Project Structure & Module Organization

This is a pnpm workspace for a realtime tactical whiteboard.

- `frontend/`: React 19 + Vite app. Source lives in `frontend/src/`, with feature folders such as `board/`, `auth/`, `realtime/`, `pages/`, and reusable UI in `components/`.
- `backend/`: NestJS API. Source lives in `backend/src/`; Prisma schema and migrations are in `backend/prisma/`.
- `packages/shared/`: Shared TypeScript exports consumed by both apps.
- `design/`: Static design references and experiments.
- Root config includes `eslint.config.mjs`, `tsconfig.base.json`, and `docker-compose.yml`.

## Build, Test, and Development Commands

Run commands from the repository root.

- `pnpm install`: install all workspace dependencies.
- `cp .env.example .env`: create local environment config.
- `cp frontend/.env.example frontend/.env.local`: point local Vite at the Docker backend.
- `docker compose up --build backend`: run PostgreSQL, Redis, apply Prisma migrations, and start the backend API.
- `pnpm dev`: run frontend and backend in watch mode.
- `pnpm dev:fe`: run the Vite frontend at `http://localhost:5173`.
- `pnpm dev:be`: run the NestJS backend locally outside Docker.
- `pnpm build`: build all workspace packages.
- `pnpm lint`: lint TypeScript and TSX files across the workspace.
- `pnpm test`: run backend Jest tests and frontend Vitest tests.
- `pnpm --filter backend prisma:generate`: regenerate Prisma client after schema changes.

## Coding Style & Naming Conventions

Use TypeScript throughout. Follow the existing style: two-space indentation, semicolons, single quotes, and named exports where practical. React components use `PascalCase` filenames such as `BoardCanvas.tsx`; hooks use `useX.ts`; services, controllers, DTOs, and guards follow NestJS naming such as `rooms.service.ts` and `jwt-auth.guard.ts`.

Keep shared contracts in `packages/shared/src/index.ts` instead of duplicating types across apps.

## Testing Guidelines

Backend tests use Jest with `*.spec.ts` files beside the code under test. Frontend tests use Vitest with `*.test.ts` files in `frontend/src/` or scenario-style files in `frontend/test/`. Add focused tests for auth, permissions, realtime behavior, board state, comments, offline replay, conflict resolution, and version history changes. Run `pnpm test` before opening a pull request.

## Commit & Pull Request Guidelines

The current history uses short, direct commit messages, for example `update UI` and `Interacting with rectangular objects`. Prefer concise imperative summaries such as `add room invite tests` or `fix board undo state`.

Pull requests should include a short description, testing performed, related issue or task links, and screenshots or recordings for UI changes. Note any schema, migration, or environment variable changes explicitly.

## Security & Configuration Tips

Do not commit `.env` files, secrets, database dumps, or generated `dist/` output. Keep `.env.example` and `frontend/.env.example` updated when configuration changes. Review Prisma migrations before committing them. Redis backs ephemeral collaboration state such as Socket.IO fanout, live cursors, and soft text leases; Postgres remains authoritative for board events, comments, and text document state.

## Conflict Resolution Notes

Use `CONFLICT_RESOLUTION_PLAN.md` as the roadmap for collaborative conflict work. Object updates may auto-merge only when missed events changed different fields; same-field edits must preserve structured conflict details through Socket.IO and the offline outbox.
