FROM node:22-alpine
WORKDIR /app

# Install pnpm
RUN corepack enable pnpm

# Copy workspace config and lockfile
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY backend/package.json backend/tsconfig.json backend/
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY backend/src backend/src/
COPY packages/shared/src packages/shared/src/
COPY backend/prisma backend/prisma/

# Generate Prisma client and build NestJS
RUN cd backend && npx prisma generate && npx nest build

EXPOSE 3000
CMD ["node", "backend/dist/main.js"]
