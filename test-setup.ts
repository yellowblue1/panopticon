/**
 * Global test setup: MSW unhandled request guard.
 *
 * Intercepts all outgoing network requests during tests. Any request that
 * is not explicitly handled by a test-level MSW handler will cause the
 * test to fail, preventing accidental network access in unit tests.
 */

import { afterAll, afterEach, beforeAll } from "bun:test";
import { setupServer } from "msw/node";

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
