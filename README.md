# Panopticon

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Monitoring dashboard for Claude Code and Codex sessions running in tmux. Auto-discovers AI coding sessions, tracks activity in real time, generates AI summaries with Gemini 2.5 Flash, and serves a live dashboard on localhost:3847.

## Features

- **Auto-discovery** — finds Claude Code and Codex processes across tmux panes via process table scanning
- **Real-time activity detection** — FIFO-based pipe-pane monitoring with polling fallback
- **AI summaries** — generates concise session summaries using Gemini 2.5 Flash when a session is idle
- **Action detection** — identifies what type of input the agent expects (yes/no, choices, free-text, or none)
- **Live dashboard** — Server-Sent Events push updates to the React UI in real time
- **Terminal viewer** — renders full ANSI output with clickable URLs (including OSC 8 escape sequences); send keystrokes directly from the browser
- **Session launcher** — discover projects and launch AI sessions from the dashboard
- **Plan viewer** — browse and manage Claude Code plan files
- **Command palette** — slash command discovery from installed plugins and built-in commands
- **Session grouping** — visual grouping of orchestrator and worktree child sessions with unseen progress indicators
- **MCP file push** — Claude Code can push generated files (images, PDFs, etc.) directly to the browser via an embedded MCP endpoint
- **Push history** — a Pushes tab on each session keeps a chronological log of every `push_file` / `push_url` event so downloads remain reachable after the toast dismisses
- **Remote access** — reach the dashboard from any device via Tailscale

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.x
- tmux
- A [Google AI API key](https://aistudio.google.com/apikey) **or** a GCP project with the Vertex AI API enabled

### Install and run

```bash
git clone git@github.com:yellowblue1/panopticon.git
cd panopticon
bun install
GOOGLE_API_KEY="your-api-key" bun run web/server.ts
```

Open http://localhost:3847 in your browser.

### Using Vertex AI instead

If you prefer Vertex AI over an API key:

```bash
gcloud auth login --update-adc
bun run web/server.ts
```

Panopticon auto-detects your GCP project from `gcloud config`. To target a specific project, set the environment explicitly (the same variables work with `bunx`):

```bash
GOOGLE_GENAI_USE_VERTEXAI=true GOOGLE_CLOUD_PROJECT="your-project-id" bun run web/server.ts
```

### Run via bunx (no clone)

If you prefer not to clone the repo, you can run directly via GitHub Packages.

One-time setup — add to `~/.npmrc`:

```bash
echo "//npm.pkg.github.com/:_authToken=ghp_YOUR_TOKEN" >> ~/.npmrc  # GitHub PAT with read:packages
echo "@yellowblue1:registry=https://npm.pkg.github.com" >> ~/.npmrc
```

Then:

```bash
GOOGLE_API_KEY="your-api-key" bunx @yellowblue1/panopticon
```

> Panopticon uses the [`@google/genai`](https://github.com/googleapis/js-genai) SDK, which reads all Gemini configuration from environment variables. See the [SDK README](https://github.com/googleapis/js-genai#readme) for the full list of supported variables.

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `PORT` | `3847` | HTTP server port |
| `HOST` | `127.0.0.1` | Bind address |
| `DEV_PORT` | `3847` | Vite dev server port (backend auto-assigns `DEV_PORT + 1`) |
| `PANOPTICON_MCP` | *(enabled)* | Set to `false` to disable the MCP endpoint and auto-registration |

## Development

```bash
bun install
bun run --cwd web dev          # Start dev server (frontend: 3847, backend: 3848)
DEV_PORT=4000 bun run --cwd web dev  # Custom ports (frontend: 4000, backend: 4001)
bun test             # Run all tests
bun run lint         # Lint & format check (Biome)
bun run typecheck    # TypeScript strict mode
bun run knip         # Dead code detection
bun run depcruise    # Dependency architecture check
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh/) |
| Backend | [Hono](https://hono.dev/) |
| Frontend | [React](https://react.dev/) 19, [TanStack Router & Query](https://tanstack.com/), [fancy-ansi](https://github.com/nicolo-ribaudo/fancy-ansi) |
| AI | [Gemini 2.5 Flash](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash) via [`@google/genai`](https://github.com/googleapis/js-genai) SDK |
| Styling | [Tailwind CSS](https://tailwindcss.com/) |
| Quality | [Biome](https://biomejs.dev/), TypeScript strict, [dependency-cruiser](https://github.com/sverweij/dependency-cruiser), [knip](https://knip.dev/) |

## Project Structure

```
src/
  intelligence/   # AI summarization, action detection
  launcher/       # project discovery & session launching
  mcp/            # MCP server integration (push_file, push_url)
  plan/           # plan file discovery & viewing
  session/        # session lifecycle & state machine
  terminal/       # tmux operations, process discovery
  shared/         # shared types & utilities
web/
  server.ts       # Hono server (composition root)
  server-app.ts   # Route definitions & API handlers
  src/client/     # React SPA
bin/
  cli.ts          # CLI entrypoint for bunx
```

## Remote Access via [Tailscale](https://tailscale.com/)

Expose the dashboard to your Tailscale network so you can monitor sessions from your phone:

```bash
tailscale serve --bg 3847
```

The dashboard will be available at `https://<your-machine>.ts.net`.

## MCP File Push

Panopticon embeds an [MCP](https://modelcontextprotocol.io/) endpoint that lets Claude Code push generated files (images, charts, PDFs, etc.) directly to the browser dashboard.

### Zero-config setup

On startup, Panopticon automatically registers itself in `~/.claude.json`. Claude Code picks this up on its next launch — no manual configuration needed.

To disable MCP entirely (endpoint + auto-registration):

```bash
PANOPTICON_MCP=false bun run web/server.ts
```

### Usage

From Claude Code, call the `push_file` tool:

```
push_file({ file_path: "/path/to/chart.png" })
```

The file appears as a toast notification in the browser with a download button.

To push a URL (useful for long URLs that break when wrapped in terminal output):

```
push_url({ url: "https://example.com/long-path?token=abc", label: "Approve access" })
```

The URL appears as a toast notification with an "Open" button that opens it in a new browser tab.

### Manual configuration

If you need to customize the MCP endpoint (e.g. non-default port), add an `mcpServers` entry to `~/.claude.json`:

```json
{
  "mcpServers": {
    "panopticon": {
      "type": "http",
      "url": "http://localhost:3847/mcp"
    }
  }
}
```

> **Note:** `~/.claude.json` contains other Claude Code settings. Only add or modify the `mcpServers.panopticon` entry.

Panopticon will not overwrite an existing `panopticon` entry.

## Contributing

Issues and pull requests are welcome. For bugs and feature requests, please open a [GitHub issue](https://github.com/yellowblue1/panopticon/issues). For larger changes, opening an issue first to discuss the approach is appreciated.

Run `bun run lint` and `bun test` before sending a PR — the pre-commit hook (`husky` + `lint-staged`) will run Biome on staged files automatically.

## Security

Please report security vulnerabilities **privately** rather than via a public issue.

<!-- TODO(maintainer): replace this paragraph with a real reporting contact (private email or GitHub Security Advisory) before public launch. -->

## License

[MIT](./LICENSE) © 2026 Akira Sosa
