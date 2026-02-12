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
- **Mobile access** — access the dashboard from your phone over Tailscale VPN

## Prerequisites

- [Bun](https://bun.sh/) v1.x
- tmux
- A GCP project with the Vertex AI API enabled (for Gemini)

## Quick Start

```bash
gcloud auth login                    # Authenticate with GCP (for Gemini API)
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

## Remote Access via [Tailscale](https://tailscale.com/)

Expose the dashboard to your Tailscale network so you can monitor sessions from your phone:

```bash
tailscale serve --bg 3847
```

The dashboard will be available at `https://<your-machine>.ts.net`.

## Configuration

### GCP (Gemini API)

By default, the GCP project and location are read from your `gcloud` configuration. You can override them with environment variables:

| Setting | Env var | Default |
|---------|---------|---------|
| Project | `GEMINI_GCP_PROJECT` | `gcloud config get-value project` |
| Location | `GEMINI_GCP_LOCATION` | `asia-northeast1` |

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
| Runtime | [Bun](https://bun.sh/) |
| Backend | [Hono](https://hono.dev/) |
| Frontend | [React](https://react.dev/) 19, [TanStack Router & Query](https://tanstack.com/), [xterm.js](https://xtermjs.org/) |
| AI | [Gemini 2.5 Flash](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash) via Vertex AI |
| Styling | [Tailwind CSS](https://tailwindcss.com/) |
| Quality | [Biome](https://biomejs.dev/), TypeScript strict, [dependency-cruiser](https://github.com/sverweij/dependency-cruiser), [knip](https://knip.dev/) |

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
