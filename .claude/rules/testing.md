# Testing Rules

## Test Runner

- Use Bun test runner. Import from `bun:test`, not `vitest` or `jest`.
- Imports: `import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";`

## File Organization

- Co-locate test files next to source: `foo.ts` -> `foo.test.ts`.
- Use `describe/it/expect` structure. Nest `describe` blocks for logical grouping.
- Test helper utilities go in `src/__tests__/helpers/` and are re-exported via `src/__tests__/index.ts`.

## Mocking Strategy

- **DI-based mocking** is the primary approach. Do not use `vi.mock()`, `bun mock.module()`, or monkey-patching.
- Create a `mockDeps()` helper that returns the deps interface with mock implementations:
  ```typescript
  const mockDeps = (generateContent: GenerateContentFn): SummaryDeps => ({
    generateContent,
  });
  ```
- For complex deps, use `createMockDeps(overrides: Partial<Deps>)` with sensible defaults:
  ```typescript
  function createMockDeps(overrides: Partial<AppDeps> = {}): AppDeps {
    return { getSessions: () => [], sendKeys: () => true, ...overrides };
  }
  ```

## Mock Helpers

Pre-built mock factories in `src/__tests__/helpers/fetch-mock.ts`:

- `mockGenerateContent(text)` -- returns the given text
- `mockGenerateContentEmpty()` -- returns null
- `mockGenerateContentError(message?)` -- throws an Error

Import via: `import { mockGenerateContent } from "../../__tests__";`

## Network Mocking

- MSW 2 is configured globally in `test-setup.ts` (preloaded via `bunfig.toml`).
- Global MSW server runs with `onUnhandledRequest: "error"` -- any unmocked network call fails the test.
- For endpoint-specific handlers, use `server.use()` in individual test files.

## Environment Variables

Save and restore env vars manually in `beforeEach`/`afterEach`:

```typescript
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  originalEnv.MY_VAR = process.env.MY_VAR;
});

afterEach(() => {
  if (originalEnv.MY_VAR === undefined) {
    delete process.env.MY_VAR;
  } else {
    process.env.MY_VAR = originalEnv.MY_VAR;
  }
});
```

## Cache & State Isolation

- Call `clearXxxCache()` in `beforeEach` to reset caches between tests.
- Verify in-flight map cleanup after async tests.

## Async Testing Patterns

- For in-flight deduplication: create a delayed mock with manual resolve, fire concurrent calls via `Promise.all`, then assert call count.
- For timing-sensitive tests: use `await new Promise(resolve => setTimeout(resolve, ms))`.
- Hono API tests: use `app.request("/path")` directly -- no HTTP server needed.

## Unit vs Integration Tests

- **Unit tests** (default): `bun test` or `bun run test:unit`. Must not make real network calls.
- **Integration tests**: gated by `INTEGRATION=true` environment variable. Run with `bun run test:integration`.
- Name integration tests with "Integration" in the test name for filtering.
