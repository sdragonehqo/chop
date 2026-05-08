# chop

<img width="741" height="747" alt="Screenshot 2026-05-07 at 9 07 13 PM" src="https://github.com/user-attachments/assets/503331eb-a67d-4b2a-b92f-d1ec8c4bd9f7" />



A cartoon lumberjack window for [Claude Code](https://claude.com/claude-code).
Chops wood at a steady pace while your session runs. Looks visibly more wrecked
the longer you go and the more tokens you burn — but **never slows down**. Logs
pile up next to him as you send more prompts.

The lumberjack is rendered in a Rayman-inspired style: floating fists grip a
T-mounted axe, and floating boots plant on the ground — no arms or legs in
between. Five exhaustion stages swap visuals (sweat, drooping eyes, hunched
posture, tongue out, floating Z's) without ever changing the 1-second chop
tempo.

## What it does

On `SessionStart`, the plugin:

1. Records the session info (`transcript_path`, start time) to `~/.claude/chop/`
2. Spawns a tiny zero-dependency Node server on `http://localhost:47823`
3. Opens the lumberjack window in your default browser

The page polls `/api/status` once per second. The server reads the session
transcript on each request and computes:

- **context tokens** — most recent prompt size (input + cache reads)
- **output tokens** — cumulative across the whole session
- **prompt count** — number of user prompts so far (drives the log pile)
- **elapsed time** — since the session started
- **exhaustion** — `max(context_tokens / 200k, elapsed / 90min)` clamped to `[0,1]`

The frontend maps exhaustion to one of five visual stages (`t0` … `t4`). Each
stage swaps cosmetic details only — the chop tempo is locked at 1s in CSS and
never changes.

| Stage | Threshold | Look |
| :---- | :-------- | :--- |
| t0 fresh        | < 0.2 | upright, smiling, no sweat |
| t1 warming up   | < 0.4 | first sweat drop, slight brow furrow |
| t2 working      | < 0.6 | more sweat, eye bags, mouth open, slight desaturation |
| t3 exhausted    | < 0.8 | drooping eyelids, panting, sagging posture |
| t4 wrecked      | ≥ 0.8 | tongue out, Z's, sweat puddle, beanie pom slipping, color fades |

A speech bubble rotates a stage-appropriate one-liner ("nice grain." → "send
water." → "i was a hand model.").

In the bottom-left HUD there's a row of test buttons (`auto · fresh · warm ·
work · tired · wrecked`) — click any stage to force the lumberjack into it
without waiting for tokens or time to add up. Click `auto` to hand control back
to the live poller.

## Requirements

- [Claude Code](https://docs.claude.com/en/docs/claude-code/quickstart)
  installed and authenticated
- **Node.js** on your `PATH` — the status server is plain `node` with no npm
  dependencies, so any recent version works
- A browser
- macOS uses the `open` command; Linux falls back to `xdg-open`. (Windows is
  untested — `start` could be added to `hooks/session-start.sh` if needed.)

## Install

### Option A: as a local plugin directory

Clone the repo somewhere convenient, then start Claude Code with
`--plugin-dir` pointed at it:

```bash
git clone https://github.com/<your-fork>/chop.git ~/plugins/chop
claude --plugin-dir ~/plugins/chop
```

This is the fastest way to try it. Each new Claude Code session opens (or
re-uses) the lumberjack window automatically.

### Option B: install from a marketplace

If you've published `chop` to a Claude Code plugin marketplace, install the
normal way:

```
/plugin install chop
```

See the [official plugins docs](https://code.claude.com/docs/en/plugins) for
how to publish to a marketplace.

## Usage

Once installed, just start Claude Code as usual. The lumberjack window opens
on its own. The window stays open across sessions — the SessionStart hook is
idempotent, so it won't spawn duplicate browser tabs or duplicate servers.

To stop the server manually:

```bash
kill "$(cat ~/.claude/chop/server.pid)"
```

…or end the Claude Code session — the `SessionEnd` hook kills it for you.

## Files

```
chop/
├── .claude-plugin/plugin.json    # plugin manifest
├── hooks/
│   ├── hooks.json                # SessionStart + SessionEnd registration
│   ├── session-start.sh          # spawns server, opens browser
│   └── session-end.sh            # kills server
├── server/server.js              # zero-dep Node status server
├── web/
│   ├── index.html                # inline SVG lumberjack scene + HUD + buttons
│   ├── style.css                 # chop animation + exhaustion stages
│   └── app.js                    # polls /api/status, applies stage classes
└── README.md
```

Runtime state lives at `~/.claude/chop/`:

- `session.json` — latest SessionStart hook payload
- `started_at` — unix seconds when the current session started
- `server.pid` — pid of the running status server
- `server.log` — server stdout/stderr

## How the rig works (for hackers)

The lumberjack is one big inline SVG. The chop is two compounded animations
running at the same `var(--chop-duration)` (default `1s`):

- `#bend` rotates the upper body around the hip pivot with a small squash &
  stretch on impact (sells the weight).
- `#swing` rotates the haft + both fists + the axe head around the chest
  pivot, from `-110deg` (windup) → `0deg` (impact) → `-110deg`.

The figure deliberately has **no arms and no legs** — Rayman style. Two
floating fists grip a horizontal haft. The axe head is mounted T-perpendicular
to the haft (with a small T-knob of haft visible past the head) so the
silhouette reads as a chunky felling axe.

Exhaustion stages are pure CSS class swaps on `<body>` (`t0` … `t4`). They
toggle visibility of sweat drops, eye lids, mouth shape, tongue, Z's, beanie
pom offset, and a posture wrapper that adds a static forward hunch. The chop
tempo (`--chop-duration`) is **never** part of any stage rule.

## Switching to Electron later

The `web/` folder is a self-contained static app. To wrap it in an Electron
window without touching the visuals:

1. `npm init -y && npm i electron`
2. Add a `main.js`:

   ```js
   const { app, BrowserWindow } = require("electron");
   app.whenReady().then(() => {
     const win = new BrowserWindow({
       width: 480,
       height: 540,
       alwaysOnTop: true,
       resizable: true,
       title: "chop",
     });
     // Either point at the local status server (still spawned by SessionStart)…
     win.loadURL("http://localhost:47823");
     // …or load the file directly and have main.js read the transcript via IPC.
     // win.loadFile("web/index.html");
   });
   ```

3. Have `session-start.sh` launch Electron instead of (or in addition to) the
   browser. The SVG, CSS, and `app.js` don't change.

## Notes / gotchas

- One window per machine. If two Claude Code sessions overlap, the second
  `SessionStart` updates `session.json` so the lumberjack reflects the most
  recent session — the existing server keeps running.
- Exhaustion is whichever-is-greater of context fullness and elapsed time, so
  even a short-context session eventually droops if you stay in it long enough.
- `prompt_count` is derived from the transcript JSONL, counting non-empty user
  messages (tool-result-only user turns are ignored).
- The default port `47823` is hard-coded in both the hook and the server. If
  it collides with something else, change `PORT` in `hooks/session-start.sh`
  and the `--port` flag in the `node` command.

## License

MIT.
