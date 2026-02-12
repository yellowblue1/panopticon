# Panopticon

Monitoring dashboard for Claude Code and Codex sessions running in tmux. Auto-discovers AI coding sessions, tracks activity in real time via FIFO + polling, generates AI summaries with Gemini 2.5 Flash, and serves a live SSE dashboard (React + xterm.js) on localhost:3847.

## Language Policy

IMPORTANT: All code, comments, commit messages, and documentation MUST be written in English.

## Project Structure

Bun workspace monorepo: root package (backend) + `web/` (frontend).

```
bin/cli.ts              # CLI entrypoint (bunx @yellowblue1/panopticon)
src/
  intelligence/         # Bounded context: AI summaries & action detection
    application/        # Use cases (summarize, detect-actions)
    domain/             # Ports, type guards, prompts
    infrastructure/     # Gemini client, TTL cache, GCP config
  terminal/             # Bounded context: tmux & process discovery
    domain/             # Types (TmuxPane, MonitoredProcess, SessionState)
    infrastructure/     # tmux commands, process matching, ANSI sanitization
  session/              # Bounded context: session lifecycle management
    application/        # SessionManager (orchestrates polling, FIFO, summaries)
    domain/             # Ports (SessionManagerDeps, SessionManagerOptions)
    infrastructure/     # FIFO reader
  shared/               # Shared kernel: API response types, PaneAction union
web/
  server.ts             # Bun HTTP server startup (composition root)
  server-app.ts         # Hono app factory with DI (createApp)
  src/client/           # React 19 SPA (TanStack Router/Query, xterm.js)
```

### DDD Architecture Rules (enforced by dependency-cruiser)

- **Layer rules**: `domain/` must not import from `infrastructure/` or `application/`
- **Context isolation**: bounded contexts must not import from each other (exception: `session` may use `terminal/domain/types`)
- **Shared kernel**: `shared/` must not depend on any bounded context
- **Client isolation**: `web/src/client/` must not import from `src/`

## Quality Standards

Pre-commit hooks run automatically. All must pass before committing.

1. Block direct commits to `main` or `develop`
2. Trailing whitespace, end-of-file, YAML, JSON, LF line endings
3. `biome check --write .` -- lint and format
4. `tsc --noEmit` -- type checking
5. `depcruise src` -- architecture validation

Additional quality scripts (run manually):

- `bun run knip` -- dead code detection
- `bun run type-coverage` -- type coverage >= 99%

## Contributing

1. Create feature branch from `main`
2. Follow existing patterns in similar code
3. Run `bun run lint:fix` before committing
4. All tests must pass (`bun test`) before pushing
5. Submit a PR for review -- direct commits to `main` are blocked
