# TypeScript Rules

## Runtime & Tooling

- Runtime: Bun. Use `Bun.hash()`, `Bun.spawn()`, `Bun.spawnSync()` where appropriate.
- Formatter/linter: Biome. Run `bun run lint:fix` to auto-fix.
- Formatting: double quotes, semicolons, 2-space indent, 100-char line width.
- Do not use Prettier or ESLint.

## Imports

- Use named imports. No default imports except where required by libraries (e.g., React).
- Use type-only imports for types: `import type { Foo } from "./bar";`
- Biome enforces `useImportType` and `organizeImports` automatically.
- Import from `node:` prefix for Node.js built-ins (e.g., `import { EventEmitter } from "node:events";`).

## Type Patterns

- Use `interface` for object shapes and dependency contracts.
- Use discriminated union types for variants (e.g., `type PaneAction = { type: "choices"; ... } | ...`).
- Use custom type guard functions instead of Zod for validation (e.g., `isValidPaneAction`).
- `noNonNullAssertion: "error"` -- no `!` operator. Use null checks instead.
- `noExplicitAny: "error"` -- no `any`. Use `unknown` and narrow with type guards.
- Target >= 99% type coverage.

## Error Handling

- Application layer: wrap external calls in try-catch and return `null` or a safe default on failure. Do not throw.
- Infrastructure layer: may throw but should prefer returning null where the caller expects it.
- Graceful degradation over crashing.

## Async Patterns

- All async functions return `Promise<T>`.
- Use in-flight deduplication to prevent duplicate concurrent API calls for the same input. Pattern: check inflight map before starting a request, store the promise, clean up in `finally`.
- Use `TtlCache<T>` from `src/intelligence/infrastructure/cache.ts` for time-based caching with LRU eviction.
- Content keys use `Bun.hash(content).toString(36)` for fast hashing.

## Dependency Injection

- Define dependencies as interfaces in `domain/ports.ts` (e.g., `SummaryDeps`, `SessionManagerDeps`).
- Application-layer functions accept a `deps` parameter with all external operations.
- Infrastructure creates concrete implementations (e.g., `createGenerateContentFn` returns `GenerateContentFn`).
- Composition happens at the entry point (`web/server.ts`). No service locator or DI container.

## DDD Architecture

- Each bounded context has `application/`, `domain/`, `infrastructure/` directories.
- `domain/` contains ports (interfaces), types, and pure logic (type guards, validators).
- `application/` contains use cases that depend on domain ports.
- `infrastructure/` contains implementations of domain ports.
- Within a context: application may import from infrastructure and domain. Domain must not import from application or infrastructure.
- Cross-context: contexts must not import from each other (enforced by dependency-cruiser). Exception: `session` may import `terminal/domain/types`.
- `shared/` contains only types used across client and server boundaries.

## Hono API

- Backend uses Hono with factory pattern (`createApp(deps: AppDeps)`).
- Export `AppType` from `web/server-app.ts` for Hono RPC client usage on the frontend.
- Frontend uses `hc<AppType>("")` from `hono/client` for type-safe API calls.

## Frontend (web/)

- React 19 with React Compiler enabled (automatic memoization). Do not add manual `useMemo`/`useCallback` unless profiling shows need.
- TanStack Router for file-based routing (`web/src/client/routes/`).
- TanStack Query for server state. Define query keys in `lib/query-keys.ts`.
- Path aliases: `@/` maps to `web/src/client/`, `@shared/` maps to `src/shared/`.
- Tailwind CSS 4 for styling. Use `cn()` from `lib/cn.ts` for class merging.
