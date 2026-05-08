#!/usr/bin/env node
/* chop status server — zero dependencies.
 *
 * Serves the static web/ folder and a /api/status endpoint that returns
 * { tokens, context_tokens, output_tokens, elapsed_ms, exhaustion } based on
 * the most recent SessionStart payload written to <runtime>/session.json.
 *
 * The server is intentionally minimal so that it can be replaced (or wrapped)
 * by an Electron main process later without touching the web/ folder.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const args = parseArgs(process.argv.slice(2));
const PORT = parseInt(args.port || "47823", 10);
const RUNTIME_DIR = args.runtime || path.join(process.env.HOME || ".", ".claude/chop");
const WEB_DIR = path.join(__dirname, "..", "web");

// Approximate full context window of current Claude models. Used as the
// denominator for the "context fullness" exhaustion signal.
const CONTEXT_WINDOW = 200000;
// Time component: a session approaches "max tired" by this many minutes
// regardless of token count, so even short-token chats eventually droop.
const MAX_MINUTES = 90;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === "/api/status") return handleStatus(res);
    return handleStatic(url.pathname, res);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("server error: " + err.message);
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    // Another chop server is already running on this port — that's fine.
    process.exit(0);
  }
  console.error("chop server error:", err);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`chop server listening on http://127.0.0.1:${PORT}`);
});

function handleStatic(pathname, res) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  // prevent path traversal
  rel = rel.replace(/\.\.+/g, "");
  const filePath = path.join(WEB_DIR, rel);
  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403); return res.end("forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
  });
}

function handleStatus(res) {
  const status = computeStatus();
  res.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "no-cache",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(status));
}

function computeStatus() {
  const sessionPath = path.join(RUNTIME_DIR, "session.json");
  const startedAtPath = path.join(RUNTIME_DIR, "started_at");

  let transcriptPath = null;
  let sessionId = null;
  try {
    const raw = fs.readFileSync(sessionPath, "utf8");
    const payload = JSON.parse(raw);
    transcriptPath = payload.transcript_path || null;
    sessionId = payload.session_id || null;
  } catch (_) {
    // no session yet — return idle
  }

  let startedAt = Date.now();
  try {
    const s = parseInt(fs.readFileSync(startedAtPath, "utf8").trim(), 10);
    if (!isNaN(s)) startedAt = s * 1000;
  } catch (_) {}

  const elapsedMs = Math.max(0, Date.now() - startedAt);

  // Token totals from the transcript JSONL.
  let contextTokens = 0;   // most recent prompt size (input + cache)
  let outputTokens = 0;    // cumulative output across the whole session
  let promptCount = 0;     // how many user prompts have been submitted
  let lastUsage = null;

  if (transcriptPath && fs.existsSync(transcriptPath)) {
    try {
      const raw = fs.readFileSync(transcriptPath, "utf8");
      const lines = raw.split("\n");
      for (const line of lines) {
        if (!line) continue;
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        if (isUserPrompt(obj)) promptCount++;
        const usage = extractUsage(obj);
        if (!usage) continue;
        lastUsage = usage;
        outputTokens += usage.output_tokens || 0;
      }
      if (lastUsage) {
        contextTokens =
          (lastUsage.input_tokens || 0) +
          (lastUsage.cache_read_input_tokens || 0) +
          (lastUsage.cache_creation_input_tokens || 0);
      }
    } catch (_) {}
  }

  const tokensTotal = contextTokens + outputTokens;

  // Two independent exhaustion signals; whichever is higher wins.
  const ctxFraction = Math.min(1, contextTokens / CONTEXT_WINDOW);
  const timeFraction = Math.min(1, elapsedMs / (MAX_MINUTES * 60 * 1000));
  const exhaustion = Math.max(ctxFraction, timeFraction);

  return {
    session_id: sessionId,
    tokens: tokensTotal,
    context_tokens: contextTokens,
    output_tokens: outputTokens,
    context_window: CONTEXT_WINDOW,
    prompt_count: promptCount,
    elapsed_ms: elapsedMs,
    exhaustion,
  };
}

// Detect "user submitted a prompt" lines in the transcript. Different harness
// versions write slightly different shapes, so accept the common variants.
function isUserPrompt(obj) {
  if (!obj || typeof obj !== "object") return false;
  // Top-level role field.
  if (obj.role === "user" && typeof obj.content === "string") return true;
  // Nested message form.
  if (obj.message && obj.message.role === "user") {
    const c = obj.message.content;
    // Skip tool-result-only user turns — those aren't real prompts.
    if (typeof c === "string") return c.trim().length > 0;
    if (Array.isArray(c)) {
      return c.some((part) => part && part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0);
    }
  }
  // Some transcripts use type=user_prompt or type=user.
  if (obj.type === "user_prompt") return true;
  return false;
}

// Transcript lines vary slightly in shape; usage may sit at the top level or
// nested under `message`. Try both.
function extractUsage(obj) {
  if (obj && obj.usage && typeof obj.usage === "object") return obj.usage;
  if (obj && obj.message && obj.message.usage && typeof obj.message.usage === "object") {
    return obj.message.usage;
  }
  return null;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}
