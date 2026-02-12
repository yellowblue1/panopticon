# TypeScript Rules

## Tooling

- Biome for lint/format. Run `bun run lint:fix`. Do not use Prettier or ESLint.

## DI & Architecture

- Dependencies defined as interfaces in `domain/ports.ts` (e.g., `SummaryDeps`, `SessionManagerDeps`).
- Application-layer functions accept a `deps` parameter. Infrastructure provides concrete implementations.
- Composition root: `web/server.ts`. No DI container.

## Project-Specific Patterns

- In-flight deduplication: check inflight map before API calls, store promise, clean up in `finally`.
- `TtlCache<T>` from `src/intelligence/infrastructure/cache.ts` for time-based caching with LRU eviction.
- Content hashing: `Bun.hash(content).toString(36)`.

## Hono API

- Backend: `createApp(deps: AppDeps)` factory in `web/server-app.ts`, exports `AppType`.
- Frontend: `hc<AppType>("")` from `hono/client` for type-safe RPC calls.

## Frontend

- React Compiler enabled -- do not add manual `useMemo`/`useCallback`.
- Path aliases: `@/` -> `web/src/client/`, `@shared/` -> `src/shared/`.
- Query keys: `web/src/client/lib/query-keys.ts`.
- Class merging: `cn()` from `web/src/client/lib/cn.ts`.
