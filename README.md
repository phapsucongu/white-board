# Realtime Collaborative Tactical Whiteboard

Project foundation for a full-stack realtime tactical whiteboard.

## Stack

- Frontend: React, Vite, TypeScript
- Backend: NestJS, TypeScript
- Shared package: TypeScript types in `packages/shared`
- Database location: Prisma schema in `backend/prisma/`
- Local services: PostgreSQL and Redis via Docker Compose

## Setup

```bash
pnpm install
cp .env.example .env
docker compose up -d
```

## Scripts

```bash
pnpm dev      # run frontend and backend in watch mode
pnpm dev:fe   # run Vite frontend
pnpm dev:be   # run NestJS backend
pnpm build
pnpm lint
pnpm test
```

Default local URLs:

- Frontend: http://localhost:5173
- Backend health check: http://localhost:3000/health

## Structure

```txt
backend/          NestJS API foundation and Prisma schema
frontend/         React + Vite app foundation
packages/shared/  Shared TypeScript exports
```

Business features such as auth, rooms, realtime board operations, canvas tools, and database models are intentionally left for later tasks.
