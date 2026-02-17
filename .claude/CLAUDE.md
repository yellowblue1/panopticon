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
  launcher/             # Bounded context: project discovery & session launching
  plan/                 # Bounded context: plan file discovery & viewing
  session/              # Bounded context: session lifecycle management
  terminal/             # Bounded context: tmux & process discovery (domain + infrastructure only)
  shared/               # Shared kernel: types, utilities
web/
  server.ts             # Composition root (all DI wiring)
  server-app.ts         # Hono app factory (createApp)
  src/client/           # React 19 SPA
```

Each bounded context follows `application/` / `domain/` / `infrastructure/` layout (except `terminal/`, which has no `application/` layer).

## DDD Architecture Rules (enforced by dependency-cruiser)

- `domain/` must not import from `infrastructure/` or `application/`
- Bounded contexts must not import from each other (exception: `session` may use `terminal/domain/types`)
- `shared/` must not depend on any bounded context
- `web/src/client/` must not import from bounded contexts (`src/(terminal|session|intelligence|plan|launcher)/`); importing `src/shared/` via `@shared/` is allowed

## Quality Standards

Pre-commit hooks (via [pre-commit](https://pre-commit.com/)): Biome check, TypeScript check, dependency-cruiser, `bun run knip` (dead code), `bun run type-coverage` (>= 99%), security audit, branch protection, trailing-whitespace, end-of-file, YAML/JSON checks, and actionlint.
