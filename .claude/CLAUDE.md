# Panopticon

Monitoring dashboard for Claude Code and Codex sessions running in tmux. Auto-discovers AI coding sessions, tracks activity via FIFO + polling, generates AI summaries with Gemini 2.5 Flash, and serves a live SSE dashboard on localhost:3847.

## Language Policy

IMPORTANT: All code, comments, commit messages, and documentation MUST be written in English.

## Project Structure

Bun workspace monorepo: root package (backend) + `web/` (frontend).

```
bin/cli.ts              # CLI entrypoint
src/
  intelligence/         # Bounded context: AI summaries & action detection
  terminal/             # Bounded context: tmux & process discovery
  session/              # Bounded context: session lifecycle management
  shared/               # Shared kernel: API response types
web/
  server.ts             # Composition root (all DI wiring)
  server-app.ts         # Hono app factory (createApp)
  src/client/           # React 19 SPA
```

Each bounded context follows `application/` / `domain/` / `infrastructure/` layout.

## DDD Architecture Rules (enforced by dependency-cruiser)

- `domain/` must not import from `infrastructure/` or `application/`
- Bounded contexts must not import from each other (exception: `session` may use `terminal/domain/types`)
- `shared/` must not depend on any bounded context
- `web/src/client/` must not import from `src/`

## Quality Standards

Pre-commit hooks: Biome check, TypeScript check, dependency-cruiser. Additional: `bun run knip` (dead code), `bun run type-coverage` (>= 99%).
