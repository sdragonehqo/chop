/* chop — frontend polling + state -> visuals.
 *
 * The page hits /api/status every second, derives an exhaustion stage
 * (t0..t4), grows the log pile based on prompt count, and rotates a
 * funny speech-bubble line. Animation tempo is owned by CSS and is
 * deliberately NOT touched here — exhaustion is purely cosmetic.
 */

const POLL_MS = 1000;

// ----- exhaustion lines: rotated through randomly per stage -----
const LINES = {
  t0: ["timber!", "let's go.", "fresh.", "morning, log."],
  t1: ["nice grain.", "easy work.", "warming up.", "light stretch."],
  t2: ["okay, focused.", "sweat equity.", "deep breath.", "this is fine."],
  t3: ["who scheduled this.", "my back.", "is it noon yet?", "send water."],
  t4: ["...send help.", "i'm a tree now.", "...zzz.", "the axe is heavy.", "i was a hand model."],
};

const els = {
  body: document.body,
  bar: document.getElementById("bar-fill"),
  tokens: document.getElementById("m-tokens"),
  time: document.getElementById("m-time"),
  mood: document.getElementById("m-mood"),
  bubbleText: document.getElementById("bubble-text"),
  logs: Array.from(document.querySelectorAll("#log-pile .log")),
};

let lastStage = -1;
let lastLogCount = -1;

// Test-mode override: when a stage button is clicked, freeze the visual
// stage so the live poller can't yank it back. "auto" returns control.
let stageOverride = null;

async function tick() {
  let status;
  try {
    const r = await fetch("/api/status", { cache: "no-store" });
    status = await r.json();
  } catch (_) {
    return;
  }
  applyStatus(status);
}

function applyStatus(s) {
  const ex = clamp01(s.exhaustion || 0);
  const stage = stageFor(ex);
  const moodName = ["fresh", "warming up", "working", "exhausted", "wrecked"][stage];

  // swap exhaustion class only when it changes (so the line shuffle and
  // body sag don't get re-triggered every second). When a test-mode
  // override is active, the poller leaves the className alone.
  if (stageOverride === null && stage !== lastStage) {
    els.body.className = "t" + stage;
    els.bubbleText.textContent = pickLine(stage);
    lastStage = stage;
  }

  // log pile reveal — number of logs scales with prompt count
  const promptCount = s.prompt_count || 0;
  const logsToShow = Math.min(els.logs.length, computeLogCount(promptCount));
  if (logsToShow !== lastLogCount) {
    els.logs.forEach((g) => {
      const i = parseInt(g.dataset.i, 10);
      g.classList.toggle("show", i <= logsToShow);
    });
    lastLogCount = logsToShow;
  }

  // HUD
  els.bar.style.width = (ex * 100).toFixed(1) + "%";
  els.tokens.textContent = formatTokens(s.tokens || 0);
  els.time.textContent = formatTime(s.elapsed_ms || 0);
  els.mood.textContent = moodName;
}

// 5 stages, mapped by exhaustion (0..1).
function stageFor(ex) {
  if (ex < 0.2) return 0;
  if (ex < 0.4) return 1;
  if (ex < 0.6) return 2;
  if (ex < 0.8) return 3;
  return 4;
}

// Funny mapping: a few prompts = a few logs; lots of prompts = full pile.
// Uses log scale so the early prompts feel rewarding without instantly
// maxing the pile in long sessions.
function computeLogCount(prompts) {
  if (prompts <= 0) return 0;
  // 1 prompt -> 1 log, 3 -> 2, 6 -> 3, 12 -> 4, 24 -> 5, 48 -> 6, 96 -> 7, 192+ -> 8
  return Math.min(8, 1 + Math.floor(Math.log2(Math.max(1, prompts))));
}

function pickLine(stage) {
  const pool = LINES["t" + stage] || LINES.t0;
  return pool[Math.floor(Math.random() * pool.length)];
}

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

function formatTokens(n) {
  if (n < 1000) return String(n);
  if (n < 1000 * 1000) return (n / 1000).toFixed(1) + "k";
  return (n / 1_000_000).toFixed(2) + "M";
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  if (m < 60) return `${m}:${ss}`;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  return `${h}:${mm}:${ss}`;
}

// ----- test-mode buttons: force a stage, or hand control back to the poller -----
document.querySelectorAll("#test-controls button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#test-controls button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const stage = btn.dataset.stage;
    if (stage === "auto") {
      stageOverride = null;
      lastStage = -1; // force the next poll to re-apply whatever the live state is
      return;
    }
    stageOverride = stage;
    const idx = parseInt(stage.slice(1), 10);
    els.body.className = stage;
    els.bubbleText.textContent = pickLine(idx);
    els.mood.textContent = ["fresh", "warming up", "working", "exhausted", "wrecked"][idx];
    lastStage = idx;
  });
});

// kick off
tick();
setInterval(tick, POLL_MS);
