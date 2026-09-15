# --- build ---
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/extension/package.json apps/extension/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @cally/web build && pnpm --filter @cally/api build

# --- runtime ---
FROM node:22-slim
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY --from=build /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/web/package.json apps/web/
COPY --from=build /app/apps/extension/package.json apps/extension/
RUN pnpm install --frozen-lockfile --prod --filter @cally/api...
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle.config.ts apps/api/
COPY --from=build /app/apps/api/src/db/schema.ts apps/api/src/db/schema.ts
COPY --from=build /app/apps/web/dist apps/web/dist
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/index.js"]
