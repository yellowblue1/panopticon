# Panopticon

Monitoring dashboard for Claude Code and Codex sessions running in tmux. Auto-discovers AI coding sessions, tracks activity in real time, generates AI summaries with Gemini 2.5 Flash, and serves a live dashboard on localhost:3847.

## Features

- **Auto-discovery** — finds Claude Code and Codex processes across tmux panes via process table scanning
- **Real-time activity detection** — FIFO-based pipe-pane monitoring with polling fallback
- **AI summaries** — generates concise session summaries using Gemini 2.5 Flash when a session is idle
- **Action detection** — identifies what type of input the agent expects (yes/no, choices, free-text, or none)
- **Live dashboard** — Server-Sent Events push updates to the React UI in real time
- **Terminal viewer** — xterm.js renders full ANSI output; send keystrokes directly from the browser
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
| AI | [Gemini 2.5 Flash](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash) via [`@google/genai`](https://github.com/googleapis/js-genai) SDK |
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

## Remote Access via [Tailscale](https://tailscale.com/)

Expose the dashboard to your Tailscale network so you can monitor sessions from your phone:

```bash
tailscale serve --bg 3847
```

The dashboard will be available at `https://<your-machine>.ts.net`.
