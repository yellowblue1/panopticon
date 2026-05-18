# Security Policy

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Report privately via [GitHub Security Advisories](https://github.com/yellowblue1/panopticon/security/advisories/new).

We aim to acknowledge reports within 7 days.

## Scope

This policy covers the `panopticon` repository. Panopticon runs entirely on a user's local machine and exposes the following surfaces:

- An HTTP + Server-Sent Events dashboard bound to `127.0.0.1:3847` by default (overridable via `HOST` / `PORT`).
- An embedded MCP endpoint that accepts `push_file` and `push_url` payloads from local Claude Code sessions.
- Outbound calls to Google's Gemini API carrying tmux pane content for AI summaries and action detection.
- Read access to the local filesystem for project discovery, Claude Code JSONL session history, and plan files.

In scope: anything that allows network egress beyond Gemini, lateral movement to other localhost services, code execution from MCP or HTTP request boundaries, exfiltration of secrets visible in tmux panes, or unauthorized reads of files outside the directories panopticon legitimately needs.

Out of scope:

- Issues that require an already-compromised local machine.
- Social-engineering attacks against panopticon users.
- Vulnerabilities in upstream dependencies — please report those upstream; we will pick up the fix through Dependabot.

## Supported Versions

Only the latest commit on `main` is supported. Panopticon has no release tags yet; fixes ship as soon as they merge.

## Supply-Chain Protections

The repository applies the following baseline protections:

- `minimumReleaseAge = 259200` (3 days) in `bunfig.toml` blocks installation of dependency versions published in the last 3 days, reducing exposure to fresh malicious releases.
- All third-party GitHub Actions are pinned to commit SHAs with version markers in `.github/workflows/ci.yml`.
- CI workflows declare least-privilege `permissions: { contents: read }` at the workflow level.
- Dependabot raises weekly PRs for both the `bun` and `github-actions` ecosystems (see `.github/dependabot.yml`).
- A lockfile-drift CI job catches `package.json` / `bun.lock` metadata mismatches before they reach `main` (introduced in #166).
