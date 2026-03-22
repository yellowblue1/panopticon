# ghostty-web Investigation: Terminal Emulation for Panopticon

## Executive Summary

This document evaluates **ghostty-web** — a WebAssembly-compiled terminal emulator derived from the Ghostty native terminal — for potential integration into the Panopticon monitoring dashboard. Panopticon currently renders terminal output using ANSI-to-HTML conversion (FancyAnsi). Adopting a proper terminal emulator component would improve rendering fidelity, support interactive use cases, and provide a foundation for future features.

**Key findings:**
- ghostty-web (v0.4.0) is a promising but early-stage library (~400KB WASM, zero deps, MIT license, xterm.js API-compatible)
- xterm.js remains the safer choice for production use due to maturity and ecosystem
- Integration requires WebSocket support for interactive terminals; SSE suffices for read-only viewing
- A phased approach — starting with read-only xterm.js, optionally migrating to ghostty-web later — minimizes risk

---

## Table of Contents

1. [ghostty-web Library Analysis](#1-ghostty-web-library-analysis)
2. [libghostty / libghostty-vt](#2-libghostty--libghostty-vt)
3. [Integration Feasibility with Panopticon](#3-integration-feasibility-with-panopticon)
4. [Technical Considerations](#4-technical-considerations)
5. [Alternative Approaches](#5-alternative-approaches)
6. [Proof of Concept Design](#6-proof-of-concept-design)
7. [Recommendation](#7-recommendation)

---

## 1. ghostty-web Library Analysis

### 1.1 What is ghostty-web?

ghostty-web is a web-based terminal emulator that brings Ghostty's proven VT100 parser to the browser via WebAssembly. Unlike alternatives that reimplement terminal logic in JavaScript, ghostty-web compiles the exact same Zig-based terminal emulation code used by the native Ghostty application to WASM.

- **Repository:** [github.com/coder/ghostty-web](https://github.com/coder/ghostty-web)
- **npm:** [npmjs.com/package/ghostty-web](https://www.npmjs.com/package/ghostty-web)
- **Created by:** Coder team (originally for [Mux](https://github.com/coder/mux), a desktop app for parallel agentic development)
- **License:** MIT (same as Ghostty)

### 1.2 npm Package Details

| Property | Value |
|----------|-------|
| Package name | `ghostty-web` |
| Latest version | 0.4.0 |
| Bundle size | ~400KB (WASM) |
| Runtime dependencies | Zero |
| Security vulnerabilities | None (no transitive deps) |
| Demo | `npx @ghostty-web/demo@next` (localhost:8080) |

### 1.3 API Surface

ghostty-web is designed as an **xterm.js API-compatible drop-in replacement**. Migration from xterm.js requires only changing the import:

```javascript
// Before
import { Terminal } from '@xterm/xterm';

// After
import { init, Terminal } from 'ghostty-web';
await init(); // one-time WASM initialization
```

**Supported events:** `onData`, `onResize`, `onBell`, `onSelectionChange`, `onKey`, `onTitleChange`, `onScroll`, `onRender`, `onCursorMove`

### 1.4 Comparison with xterm.js

| Aspect | ghostty-web | xterm.js |
|--------|-------------|----------|
| Architecture | Native Zig code compiled to WASM | JavaScript implementation |
| Terminal emulation | Same code as native Ghostty app | Hand-coded escape sequence handling |
| Bundle size | ~400KB (WASM, zero deps) | ~265KB (+ optional addons) |
| API stability | Not yet stable (v0.4.0, pre-1.0) | Stable public API, monthly releases |
| Adoption | Growing (Mux, JupyterLab, Obsidian) | Ubiquitous (VS Code, Hyper, Tabby, countless projects) |
| GPU rendering | Not documented | Optional WebGL/canvas renderer addons |
| Addon ecosystem | None | Rich (Fit, WebGL, Search, WebLinks, etc.) |
| Unicode/CJK | Excellent (inherits Ghostty) | Good |
| RTL support | Yes (inherits Ghostty) | Limited |
| Mouse support | Full | Full |
| License | MIT | MIT |

**Verdict:** ghostty-web offers superior terminal emulation fidelity because it uses battle-tested native code rather than a JavaScript reimplementation. However, xterm.js is significantly more mature, has a richer addon ecosystem, and is production-proven at massive scale (VS Code alone).

### 1.5 Current Status

- **MVP complete**, actively developed
- **API not yet stable** — no official stable releases tagged
- **Growing adoption:** 21+ npm dependents including JupyterLab, Obsidian, and VS Code extensions
- **Ghostty native terminal:** Reached stable 1.0, latest 1.2.3
- **Community:** Active GitHub repository, Hacker News discussion, curated list at [awesome-libghostty](https://github.com/Uzaaft/awesome-libghostty)

### 1.6 Browser Compatibility

Requires WebAssembly support, available in all modern browsers:
- Chrome 57+ (March 2017)
- Firefox 52+ (March 2017)
- Safari 11+ (September 2017)
- Edge 16+ (October 2017)

---

## 2. libghostty / libghostty-vt

### 2.1 Architecture Hierarchy

```
Ghostty (native terminal app)
  └─ libghostty (full terminal library - rendering, input, config)
       └─ libghostty-vt (VT100 parser + state machine only)
            └─ ghostty-web (libghostty-vt compiled to WASM + JS bindings)
```

### 2.2 libghostty-vt

libghostty-vt is a **zero-dependency C library** (doesn't even require libc) that implements a modern terminal emulator's core logic:
- VT100/VT220/VT320/VT420 sequence parsing
- Terminal state management (cursor, styles, scrollback)
- Key encoding (including Kitty Keyboard Protocol)
- SIMD-optimized parsing
- Robust testing (fuzzing, Valgrind)

**Targets:** macOS, Linux, Windows, WebAssembly (x86_64 and aarch64)

### 2.3 Terminal Capabilities

| Capability | Support |
|------------|---------|
| 256-color palette | Yes |
| True color (24-bit RGB) | Yes |
| Unicode / CJK | Excellent (no vertical gutters between CJK characters) |
| RTL languages | Yes |
| Complex scripts | Yes |
| Mouse events | Full |
| Kitty keyboard protocol | Yes |
| TERM variable | `xterm-ghostty` (fallback: `xterm-256color`) |
| Font codepoint forcing | Yes |

### 2.4 WASM Compilation

- Compiles as standalone WASM module (no Emscripten required)
- Built from Zig source using Zig's native WASM target
- ghostty-web currently bundles its own WASM build; plans to use official Ghostty WASM distribution once available

---

## 3. Integration Feasibility with Panopticon

### 3.1 Current Panopticon Architecture

Panopticon's terminal display pipeline:

```
tmux capture-pane -p -e -S -500
  → SSE stream (PaneContentFull + PaneContentDiff)
    → FancyAnsi (ANSI → HTML)
      → linkifyHtml (URL detection)
        → <pre dangerouslySetInnerHTML>
```

**Key characteristics:**
- **Read-only terminal viewing** — users see output but don't type into the terminal emulator
- **SSE-based streaming** — two streams: session list + per-pane content
- **Line-based diffing** — bandwidth optimization (~70% reduction)
- **75ms debounce** — batches rapid changes
- **500-line scrollback** captured with ANSI escape codes preserved
- **No WebSocket support** — pure SSE with polling fallback

**Relevant source files:**
- `web/src/client/components/sessions/terminal-viewer.tsx` — Current ANSI→HTML renderer
- `web/src/client/hooks/use-pane-content.ts` — SSE consumer with diff application
- `web/server-app.ts` — SSE streaming endpoints
- `src/terminal/infrastructure/tmux-commands.ts` — tmux capture-pane commands

### 3.2 Integration Options

#### Option A: Read-Only Terminal Emulator (Recommended for PoC)

Replace FancyAnsi with ghostty-web/xterm.js as a **read-only renderer**:

**Backend changes:** Minimal
- Continue using `tmux capture-pane -p -e -S -500` for content capture
- Continue using SSE for streaming (no WebSocket needed)
- May need to adjust diff format (character-level vs line-level diffs for terminal emulators)

**Frontend changes:** Moderate
- Replace `terminal-viewer.tsx` with a terminal emulator component
- Feed captured pane content into the terminal via `term.write()`
- Handle terminal sizing (cols × rows) to match tmux pane dimensions
- Remove FancyAnsi and linkifyHtml dependencies (terminal emulator handles rendering)

**Data flow:**
```
tmux capture-pane -p -e -S -500
  → SSE stream (same as now)
    → term.reset() + term.write(fullContent)  // on full sync
    → term.write(diffContent)                  // on diff (needs rethinking)
```

**Challenge:** The current line-diff approach doesn't map cleanly to terminal emulator input. Terminal emulators expect a sequential byte stream, not line-level patches. Options:
1. Always send full content (simpler, more bandwidth)
2. Send raw terminal output stream instead of capture-pane snapshots (requires architectural change)
3. Use `term.reset()` + `term.write()` on each update (may cause flicker)

#### Option B: Interactive Terminal (Full Integration)

Add bidirectional terminal access via WebSocket:

**Backend changes:** Significant
- Add WebSocket endpoint (e.g., `/api/sessions/:paneId/terminal`)
- Stream raw tmux pane output via `tmux pipe-pane` or PTY forwarding
- Accept input from WebSocket and forward via `tmux send-keys`
- Handle terminal resize events

**Frontend changes:** Significant
- Full terminal emulator component with input handling
- WebSocket connection management
- Resize handling (fit addon or equivalent)
- Graceful fallback when WebSocket unavailable

**Data flow:**
```
Browser ↔ WebSocket ↔ Server ↔ tmux pipe-pane (output)
                              ↔ tmux send-keys (input)
```

### 3.3 tmux Output Streaming Methods

| Method | Type | ANSI | Use Case |
|--------|------|------|----------|
| `tmux capture-pane -p` | Snapshot (plain) | No | Status detection, idle check |
| `tmux capture-pane -p -e` | Snapshot (escaped) | Yes | Current SSE streaming |
| `tmux pipe-pane -o` | Real-time stream | Yes | Activity detection (currently used for timestamps only) |
| PTY forwarding | Real-time stream | Yes | Full interactive terminal |

For a proper terminal emulator integration, **raw output streaming** (pipe-pane or PTY) would be ideal since terminal emulators expect sequential byte streams, not periodic snapshots.

### 3.4 Required Changes Summary

| Component | Option A (Read-Only) | Option B (Interactive) |
|-----------|----------------------|------------------------|
| Backend SSE | Keep as-is | Keep for session list |
| Backend WebSocket | Not needed | New endpoint required |
| tmux capture | Keep as-is | Replace with pipe-pane stream |
| terminal-viewer.tsx | Replace with term emulator | Replace with term emulator |
| use-pane-content.ts | Adapt for term.write() | Replace with WebSocket hook |
| Input handling | Not needed | New (WebSocket + send-keys) |
| Resize handling | Read terminal dimensions | Bidirectional resize sync |

---

## 4. Technical Considerations

### 4.1 Performance

**Streaming to multiple sessions:**
- Each open session detail view creates an SSE connection (current behavior)
- Terminal emulator rendering is more CPU-intensive than HTML `<pre>` rendering
- WebGL renderer addon (xterm.js) can offload rendering to GPU
- ghostty-web WASM performance should be competitive with native

**High-throughput output (e.g., `cat large_file`):**
- Terminal emulators handle this natively (scrollback buffer, viewport rendering)
- Better than current approach: FancyAnsi processes entire content on each update
- Backpressure needed if streaming raw output to prevent buffer overflow

**Memory:**
- ghostty-web: ~400KB WASM module + terminal state per instance
- xterm.js: ~265KB JS + addons + terminal state per instance
- Multiple terminal instances (one per open session) multiply memory usage

### 4.2 Security

**Risks:**
- Terminal output may contain sensitive data (API keys, passwords in command history)
- Panopticon already exposes this via the current HTML renderer — no new risk from terminal emulator
- Interactive mode (Option B) adds input injection risk — mitigated by existing `send-keys` endpoint authentication

**Mitigations already in place:**
- Panopticon runs on localhost:3847 (secure context)
- No authentication currently needed (localhost only)
- If exposed over network: add authentication layer (reverse proxy or built-in)

**Terminal-specific risks:**
- Title injection attacks — low risk (read-only viewing, no shell running in browser)
- Clipboard manipulation via escape sequences — terminal emulators should sanitize
- Bell/alert abuse — can be disabled in terminal config

### 4.3 Terminal Resize Handling

**Current state:** Panopticon captures whatever dimensions the tmux pane has. The `<pre>` renderer doesn't enforce columns/rows.

**With terminal emulator:**
- Need to know tmux pane dimensions (cols × rows) to configure the terminal emulator
- Can query via `tmux display-message -p '#{pane_width} #{pane_height}'`
- Terminal emulator viewport should match tmux pane dimensions for correct rendering
- If pane resizes, need to re-sync dimensions and potentially re-capture content

### 4.4 ANSI Escape Sequence Quality

**Current (FancyAnsi):** Handles common sequences (colors, bold, underline, inverse). May miss edge cases with complex sequences.

**ghostty-web:** Inherits Ghostty's comprehensive VT100/VT220/VT320/VT420 support. Handles virtually all sequences correctly, including:
- 256-color and true color
- All SGR attributes
- Cursor positioning
- Alternate screen buffer
- Scrolling regions
- Mouse reporting

**xterm.js:** Mature handling of most sequences. Some edge cases with complex Unicode rendering.

---

## 5. Alternative Approaches

### 5.1 xterm.js (Established Alternative)

**When to prefer xterm.js over ghostty-web:**
- Production stability is critical (stable API, monthly releases)
- Need addon ecosystem (WebGL renderer, search, fit, web links)
- Team familiarity with xterm.js
- Need GPU-accelerated rendering for many simultaneous terminals

**When to prefer ghostty-web:**
- Terminal emulation accuracy is paramount
- Want cutting-edge terminal features (Kitty keyboard protocol, better Unicode)
- Lighter dependency footprint (zero deps)
- Willing to accept pre-1.0 API instability

### 5.2 Keep Current Approach (Enhanced FancyAnsi)

**Pros:**
- No new dependencies
- Simpler architecture (no WASM, no terminal emulator lifecycle)
- Good enough for monitoring use case (read-only viewing)

**Cons:**
- Incomplete ANSI support (edge cases)
- No proper terminal state machine (cursor positioning, alternate screen)
- Cannot support interactive use cases
- Full content re-rendering on each update (less efficient)

### 5.3 Rendered HTML without Terminal Emulator

Use a library like `ansi-to-html` or improve FancyAnsi:
- Simpler than full terminal emulator
- Adequate for read-only monitoring
- Cannot handle cursor positioning, alternate screen, or interactive features
- Similar to current approach with incremental improvements

### 5.4 Other Browser Terminal Solutions

| Solution | Approach | Notes |
|----------|----------|-------|
| ttyd | Binary + xterm.js | Full terminal server, overkill for monitoring |
| code-server | VS Code in browser | Way too heavy for this use case |
| wetty | Node.js + xterm.js | SSH-focused, not tmux-focused |
| gotty | Go binary + xterm.js | Read-only sharing, similar concept but separate binary |

---

## 6. Proof of Concept Design

### 6.1 Recommended PoC: Read-Only xterm.js

Start with xterm.js for maturity, with architecture that allows swapping to ghostty-web later.

#### Architecture

```
┌─────────────────────────────────────────────────────┐
│ Browser                                             │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ TerminalEmulator component                  │    │
│  │                                             │    │
│  │  ┌─────────────────────────────────┐        │    │
│  │  │ xterm.js / ghostty-web Terminal │        │    │
│  │  │ (read-only, no user input)      │        │    │
│  │  └─────────────────────────────────┘        │    │
│  │                                             │    │
│  │  SSE: /api/sessions/:id/terminal/stream     │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
└─────────────────────────────────────────────────────┘
                        │
                        │ SSE (raw terminal output)
                        │
┌─────────────────────────────────────────────────────┐
│ Server (Hono)                                       │
│                                                     │
│  New endpoint: /api/sessions/:id/terminal/stream    │
│  - Streams raw tmux pipe-pane output via SSE        │
│  - Sends initial content (capture-pane -e -S -500)  │
│  - Then streams incremental output                  │
│                                                     │
│  Existing: tmux pipe-pane infrastructure             │
│  (already used for activity detection)              │
└─────────────────────────────────────────────────────┘
```

#### Key Components

1. **New SSE endpoint** (`/api/sessions/:paneId/terminal/stream`):
   - On connect: send initial content via `tmux capture-pane -p -e -S -500`
   - Then stream raw output from pipe-pane FIFO
   - Include pane dimensions in initial message

2. **Terminal emulator React component**:
   - Initialize xterm.js (or ghostty-web) Terminal instance
   - Configure as read-only (disable input)
   - Set dimensions to match tmux pane
   - Feed SSE data via `term.write()`

3. **Feature toggle**:
   - Allow switching between current FancyAnsi viewer and new terminal emulator
   - Enables gradual rollout and A/B comparison

#### Key Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Terminal library | xterm.js first, ghostty-web later | Maturity and stability for PoC |
| Transport | SSE (not WebSocket) | Read-only doesn't need bidirectional; keeps architecture simple |
| Data format | Raw terminal output stream | Terminal emulators expect sequential bytes |
| Interactive input | Defer to Phase 2 | Current send-keys input works well enough |
| Scrollback | 500 lines (match current) | Configurable via xterm.js options |

#### Complexity Estimate

| Component | Effort | Notes |
|-----------|--------|-------|
| New SSE endpoint for raw output | Low | Extend existing pipe-pane infrastructure |
| Terminal emulator React component | Medium | New component, lifecycle management, sizing |
| Feature toggle (old vs new viewer) | Low | Route-level or settings-based toggle |
| Dimension sync | Low | Query tmux pane dimensions |
| Testing | Medium | Visual testing, edge cases, mobile |
| **Total** | **Medium** | ~2-3 days for experienced developer |

### 6.2 Phase 2: Interactive Terminal (Future)

If the read-only PoC proves valuable:
1. Add WebSocket endpoint for bidirectional communication
2. Enable terminal input → `tmux send-keys`
3. Handle resize events bidirectionally
4. Replace existing `send-keys-input.tsx` with in-terminal input

---

## 7. Recommendation

### Short-term: xterm.js Read-Only PoC

1. **Use xterm.js** for the initial integration — it's battle-tested, well-documented, and has the addon ecosystem (Fit, WebGL) needed for production quality
2. **Keep SSE transport** — no WebSocket needed for read-only viewing
3. **Stream raw terminal output** instead of capture-pane snapshots for proper terminal emulator rendering
4. **Add feature toggle** to allow comparison with current FancyAnsi approach

### Medium-term: Evaluate ghostty-web

Once ghostty-web reaches API stability (1.0):
1. Swap xterm.js for ghostty-web (API-compatible, should be straightforward)
2. Evaluate rendering quality and performance differences
3. Benefit from superior terminal emulation fidelity

### Long-term: Interactive Terminal

If user demand warrants it:
1. Add WebSocket support for bidirectional terminal access
2. Enable full interactive terminal sessions through the dashboard
3. Consider security implications of remote terminal access

### Decision Matrix

| Factor | ghostty-web | xterm.js | Current (FancyAnsi) |
|--------|-------------|----------|----------------------|
| Rendering fidelity | Excellent | Very Good | Good |
| Stability | Pre-1.0 | Stable | Stable |
| Bundle size | ~400KB | ~265KB + addons | ~30KB |
| Interactive support | Yes | Yes | No |
| Migration effort | Medium | Medium | None |
| Future-proofing | High | High | Low |
| Risk | Medium (early stage) | Low | Low |

**Bottom line:** Start with xterm.js for a production-quality read-only terminal viewer. The architecture should abstract the terminal library so that swapping to ghostty-web later is a single-file change. This approach delivers immediate value with minimal risk.

---

## Sources

- [ghostty-web GitHub](https://github.com/coder/ghostty-web)
- [ghostty-web npm](https://www.npmjs.com/package/ghostty-web)
- [Ghostty terminal](https://ghostty.org/)
- [libghostty announcement (Mitchell Hashimoto)](https://mitchellh.com/writing/libghostty-is-coming)
- [awesome-libghostty](https://github.com/Uzaaft/awesome-libghostty)
- [xterm.js GitHub](https://github.com/xtermjs/xterm.js)
- [xterm.js npm](https://www.npmjs.com/package/xterm)
- [Coder/Mux](https://github.com/coder/mux)
- [DeepWiki - ghostty-web](https://deepwiki.com/coder/ghostty-web)
- [ttyd](https://github.com/tsl0922/ttyd)
- [tmux pipe-pane documentation](https://tmuxai.dev/tmux-pipe-pane/)
