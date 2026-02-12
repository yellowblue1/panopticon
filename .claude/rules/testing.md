# Testing Rules

## Mocking Strategy

- DI-based mocking via `deps` parameter. Do not use `vi.mock()` or module mocking.
- Pre-built mock factories in `src/__tests__/helpers/fetch-mock.ts`:
  - `mockGenerateContent(text)`, `mockGenerateContentEmpty()`, `mockGenerateContentError()`
  - Import via: `import { mockGenerateContent } from "../../__tests__";`

## Network Mocking

- MSW 2 globally configured in `test-setup.ts` (preloaded via `bunfig.toml`).
- `onUnhandledRequest: "error"` -- unmocked network calls fail the test.

## Unit vs Integration Tests

- Unit tests (default): `bun test` or `bun run test:unit`.
- Integration tests: gated by `INTEGRATION=true`. Run with `bun run test:integration`.
- Name integration tests with "Integration" in the test name for filtering.

## Hono API Tests

- Use `app.request("/path")` directly -- no HTTP server needed.
