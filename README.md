# Panopticon

A monitoring dashboard for Claude Code sessions running in tmux.

Automatically detects Claude Code processes, tracks their activity in real time, and generates AI-powered summaries when sessions go idle — all accessible through a web-based dashboard.

## Features

- **Auto-discovery** — finds Claude Code processes across tmux panes via process table scanning
- **Real-time activity detection** — FIFO-based pipe-pane monitoring with polling fallback
- **AI summaries** — generates concise session summaries using Gemini 2.5 Flash when a session is idle
- **Action detection** — identifies what type of input Claude expects (yes/no, choices, free-text, or none)
- **Live dashboard** — Server-Sent Events push updates to the React UI in real time
- **Terminal viewer** — xterm.js renders full ANSI output; send keystrokes directly from the browser

## Prerequisites

- [Bun](https://bun.sh/) v1.x
- tmux
- A GCP project with the Vertex AI API enabled (for Gemini)
- `gcloud auth login --update-adc`

## Quick Start

```bash
git clone git@github.com:yellowblue1/panopticon.git
cd panopticon
bun install
bun run web/server.ts
```

Open http://localhost:3847 in your browser.

### Alternative: run via bunx

If you prefer not to clone the repo, you can run directly via GitHub Packages.

One-time setup — add to `~/.npmrc`:

```bash
echo "//npm.pkg.github.com/:_authToken=ghp_YOUR_TOKEN" >> ~/.npmrc  # GitHub PAT with read:packages
echo "@yellowblue1:registry=https://npm.pkg.github.com" >> ~/.npmrc
```

Then:

```bash
bunx @yellowblue1/panopticon
```

## Configuration

### GCP (Gemini API)

Each setting is resolved in this order — first match wins:

| Setting | Env var | Settings file key | Fallback |
|---------|---------|-------------------|----------|
| Project | `GEMINI_GCP_PROJECT` | `gcp_project` | `gcloud config get-value project` |
| Location | `GEMINI_GCP_LOCATION` | `gcp_location` | `asia-northeast1` |

Settings file path: `~/.claude/panopticon.local.md`

```
gcp_project: my-project-id
gcp_location: us-central1
```

### Server

| Env var | Default | Description |
|---------|---------|-------------|
| `PORT` | `3847` | HTTP server port |
| `HOST` | `127.0.0.1` | Bind address |

## Development

```bash
bun install
bun run dev          # Start dev server (frontend + backend)
bun test             # Run all tests
bun run lint         # Lint & format check (Biome)
bun run typecheck    # TypeScript strict mode
bun run knip         # Dead code detection
bun run depcruise    # Dependency architecture check
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Backend | Hono |
| Frontend | React 19, TanStack Router & Query, xterm.js |
| AI | Gemini 2.5 Flash via Vertex AI |
| Styling | Tailwind CSS |
| Quality | Biome, TypeScript strict, dependency-cruiser, knip |

## Project Structure

```
src/
  terminal/       # tmux operations, process discovery
  session/        # session lifecycle & state machine
  intelligence/   # AI summarization, action detection
  shared/         # shared type definitions
web/
  server.ts       # Hono server (composition root)
  server-app.ts   # Route definitions & API handlers
  src/client/     # React SPA
bin/
  cli.ts          # CLI entrypoint for bunx
```
