# Realtime Collaborative Tactical Whiteboard

Project foundation for a full-stack realtime tactical whiteboard.

## Stack

- Frontend: React, Vite, TypeScript
- Backend: NestJS, TypeScript
- Shared package: TypeScript types in `packages/shared`
- Database location: Prisma schema in `backend/prisma/`
- Local services: PostgreSQL and Redis via Docker Compose

## Collaboration Features

- Multi-cursor: canvas pointer positions are sent over Socket.IO and broadcast through the Redis adapter.
- Collaborative text editing: double-click a text object to edit. Text updates use Yjs updates, persist to Postgres, and update the board event stream.
- Soft text leases: active text editors are shown on the canvas; leases are advisory and do not block CRDT editing.
- Comments and annotations: use the comment tool to pin canvas comments, or comment on the selected object from the comments panel.
- Offline-first queue: board operations attempted while realtime is disconnected are stored in IndexedDB, replayed after reconnect using `clientOpId` idempotency, and kept as conflicted if the server rejects them.
- Conflict resolution: stale object updates auto-merge when missed events changed different fields; same-field edits return structured conflict details. See `CONFLICT_RESOLUTION_PLAN.md`.

## Backend with Docker, Frontend Local

Use this flow for day-to-day development. Docker runs the backend dependencies and
NestJS API; Vite still runs locally for fast frontend iteration.

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env.local
docker compose up --build backend
pnpm install
pnpm dev:fe
```

The backend container waits for PostgreSQL and Redis, runs `prisma migrate deploy`,
then starts NestJS.

Default local URLs:

- Frontend: http://localhost:5173
- Backend API and Socket.IO: http://localhost:3001
- Backend health check: http://localhost:3001/health

## Local Scripts

These scripts are still useful for tests, builds, or running services outside Docker.

```bash
pnpm install
pnpm dev      # run frontend and backend locally in watch mode
pnpm dev:fe   # run Vite frontend only
pnpm dev:be   # run NestJS backend only
pnpm build
pnpm lint
pnpm test
```

## Docker Ports and Troubleshooting

Defaults are chosen to avoid common local conflicts:

- `BACKEND_PORT=3001` maps to backend container port `3000`.
- `POSTGRES_PORT=5432` maps to PostgreSQL container port `5432`.
- `REDIS_PORT=6380` maps to Redis container port `6379`.

If a port is busy, edit `.env` and rerun `docker compose up --build backend`.
For example, set `POSTGRES_PORT=5434` if another PostgreSQL is already using
`5432`. Frontend API calls are controlled by `frontend/.env.local`:
`VITE_API_BASE_URL=http://localhost:3001`.

## Scripts

```bash
docker compose up --build backend   # run backend + PostgreSQL + Redis
docker compose ps                   # inspect service status
docker compose logs -f backend       # follow backend logs
docker compose down                  # stop containers
```

## Realtime Architecture Notes

PostgreSQL is the durable source of truth for rooms, users, board events, board snapshots, comments, and text document state. Redis is used for ephemeral collaboration infrastructure: Socket.IO fanout, cursor presence, and soft text leases. If Redis is restarted, users may lose transient cursor or lease state, but persisted board/comment/text data remains in Postgres.

## Structure

```txt
backend/          NestJS API foundation and Prisma schema
frontend/         React + Vite app foundation
packages/shared/  Shared TypeScript exports
```
