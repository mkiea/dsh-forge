#!/usr/bin/env node
// dsh-forge/cli/dsh-forge.mjs
// Standalone launch entry implementing the dual-shell strategy:
//   dsh-forge            -> evidence-based auto decision (default TUI)
//   dsh-forge tui        -> force terminal UI
//   dsh-forge web|serve  -> force web server (auto-opens browser)
//   dsh-forge check|ci   -> plain log / --json machine output, no UI
//
// Decision layers are implemented in core/mode.js:
//   1. explicit command   2. runtime environment (TTY/TERM/CI/desktop)
//   3. user scenario      4. data complexity (plugin count thresholds)
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { isLoopbackHost, openBrowser, startWebServer } from "../core/web-server.js";
import {
  runAnalysis, clearAnalysisCache, buildCheckReport,
  buildMarkdownReport, writeReport,
  UI_MODE, decideUiMode, decideAfterPortProbe,
  hasDesktop, COMPLEXITY_LIGHT, COMPLEXITY_HEAVY
} from "../core/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEB_PORT = Number(process.env.DSH_FORGE_PORT || 3060);
const DEFAULT_HOST = process.env.DSH_FORGE_HOST || "127.0.0.1";
const REPORTS_DIR = process.env.DSH_FORGE_REPORTS_DIR || null;
const HISTORY_DIR = process.env.DSH_FORGE_HISTORY_DIR || null;

function reportOpts() {
  const o = { reproduce: "node cli/dsh-forge.mjs check --json" };
  if (REPORTS_DIR) o.reportsDir = REPORTS_DIR;
  if (HISTORY_DIR) o.historyDir = HISTORY_DIR;
  return o;
}

// ── argument parsing ────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {
    command: null,
    json: false,
    open: true,
    port: DEFAULT_WEB_PORT,
    host: DEFAULT_HOST,
    dataset: process.env.DSH_FORGE_DATASET || null,
    profile: process.env.DSH_FORGE_PROFILE || "web"
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json" || a === "-j") out.json = true;
    else if (a === "--no-open") out.open = false;
    else if (a === "--port") { out.port = Number(argv[++i] || out.port); }
    else if (a === "--host") { out.host = argv[++i] || out.host; }
    else if (a === "--dataset") { out.dataset = argv[++i] || out.dataset; }
    else if (a === "--profile") { out.profile = argv[++i] || out.profile; }
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--version" || a === "-V") out.version = true;
    else if (!a.startsWith("-")) positional.push(a);
  }
  out.command = positional[0] || null;
  return out;
}

const HELP = `dsh-forge — DeepSeek Harness plugin composition analysis (TUI / Web / check)

Usage:
  dsh-forge                auto: evidence-based mode decision (default TUI in a terminal)
  dsh-forge tui            force terminal UI
  dsh-forge web|serve      start web server and open browser
  dsh-forge check|ci       plain CLI output, no UI (CI/CD scripts)

Options:
  --profile <name>         profile to analyze (default: web)
  --dataset <path>         offline ecosystem snapshot JSON
  --port <n>               web port (default: 3060, env DSH_FORGE_PORT)
  --host <addr>            web bind address (default: 127.0.0.1)
  --json, -j               machine-readable check output
  --no-open                do not auto-open the browser in web mode
  --help, -h               show this help

Mode decision evidence:
  1. explicit command
  2. TTY / TERM / CI / desktop session (DISPLAY, WAYLAND_DISPLAY, SESSIONNAME)
  3. scenario (SSH_TTY, CI, desktop)
  4. plugin count: < ${COMPLEXITY_LIGHT} -> TUI; > ${COMPLEXITY_HEAVY} -> suggest web topology
  Web port occupied -> degrade TUI (interactive) or check (non-interactive).
`;

// COMPLEXITY_LIGHT / COMPLEXITY_HEAVY are already imported at the top.

// ── analysis loader ─────────────────────────────────────────────────────────
function loadAnalysis(opts) {
  try {
    return runAnalysis({
      profile: opts.profile,
      datasetPath: opts.dataset
    });
  } catch (e) {
    console.error("[dsh-forge] analysis failed: " + String(e.message || e).split("\n")[0]);
    process.exit(1);
  }
}

function plainSummary(a) {
  const s = a.assessment;
  const c = a.conflicts.summary;
  const lines = [
    "dsh-forge check",
    "  profile        : " + a.ecosystem.layers.map((l) => l.layer).join(" -> "),
    "  rows           : " + s.pluginCount + " (active " + s.activeCount + ", disabled " + s.disabledCount + ")",
    "  edges          : " + s.edgeCount,
    "  health         : " + s.health,
    "  risk           : avg " + s.avgScore + ", max " + s.maxScore,
    "  conflicts      : " + c.total + " " + JSON.stringify(c.bySeverity || {}),
    "  truthSource    : " + (a.ecosystem.truthSource || "scan"),
    "  harnessVersion : " + (a.ecosystem.harnessVersion || "unknown")
  ];
  return lines.join("\n");
}
function jsonSummary(a, opts) {
  return JSON.stringify(buildCheckReport(a, {
    dataset: opts.dataset || null,
    reproduce: opts.dataset ? "node cli/dsh-forge.mjs check --json --dataset " + opts.dataset : "node cli/dsh-forge.mjs check --json"
  }), null, 2);
}

// ── TUI shell (zero-dependency ANSI renderer) ──────────────────────────────
const C = (code, text) => process.stdout.isTTY ? "\x1b[" + code + "m" + text + "\x1b[0m" : text;
const SEV_COLOR = { blocking: "31", high: "33", medium: "36", low: "32", disabled: "90" };
function sevBadge(sev) { return C(SEV_COLOR[sev] || "0", sev.toUpperCase()); }

function fit(text, width) {
  const s = String(text);
  return s.length <= width ? s : s.slice(0, Math.max(0, width - 1)) + "…";
}

function renderTui(a, err, dev) {
  const width = process.stdout.columns || 100;
  const g = a.graph;
  const s = a.assessment;
  const c = a.conflicts;
  const lines = [];
  lines.push(C("1;36", "dsh-forge TUI") + " — DeepSeek Harness plugin composition");
  lines.push("");
  lines.push("health " + C("1;" + (s.health === "A" ? "32" : s.health === "D" ? "31" : "33"), " " + s.health + " ") +
    "  rows " + s.pluginCount + " (active " + s.activeCount + "/disabled " + s.disabledCount + ")" +
    "  edges " + s.edgeCount +
    "  avgRisk " + s.avgScore + "  maxRisk " + s.maxScore);
  lines.push("layers " + (g.rows[0] && g.rows[0].layers ? a.ecosystem.layers.map((l) => l.layer).join(" -> ") : ""));
  const ts = String(a.truthSource || "scan").toUpperCase();
  const cc = a.confidenceCap || "—";
  const leakN = (a.leaks && a.leaks.summary && a.leaks.summary.total) || 0;
  const fv = Array.isArray(a.findingsValid) ? (a.findingsValid.length === 0 ? "ok" : a.findingsValid.length + " violation(s)") : "—";
  lines.push(C("1", "verify") + "  truthSource " + C("1;33", ts) + "  confCap " + cc + "  leaks " + leakN + "  findingsValid " + fv);
  lines.push("");
  if (s.pluginCount <= COMPLEXITY_LIGHT) {
    lines.push(C("1", "Composed rows (lightweight composition)"));
    for (const p of g.plugins) {
      lines.push("  " + fit(p.id, 34).padEnd(34) + " " + p.package + "@" + p.version + (p.disabled ? "  [disabled]" : ""));
    }
    lines.push("");
  }
  const real = c.conflicts.filter((x) => (x.finalSeverity || x.severity) !== "info");
  lines.push(C("1", "Conflicts") + "  total " + c.summary.total + " · " + (Object.entries(c.summary.bySeverity).map(([k, v]) => k + "=" + v).join(" ") || "none"));
  for (const x of real.slice(0, 12)) {
    const meta = [x.evidenceTag, (x.runtimeState && x.runtimeState !== "not-executed") ? x.runtimeState : null].filter(Boolean).join(" | ");
    const fid = x.finding_id ? "#" + x.finding_id : "";
    lines.push("  [" + sevBadge(x.finalSeverity || x.severity) + "] " + fit(x.message, width - 20));
    if (meta || fid) lines.push("      tag/runtime : " + fit((meta + "  " + fid).trim(), width - 24));
    lines.push("      impact : " + fit(x.impact || "", width - 20));
    lines.push("      advice : " + fit(x.advice || "", width - 20));
  }
  if (!real.length) lines.push("  no blocking/high/medium conflicts");
  lines.push("");
  lines.push(C("1", "Risk top 10"));
  const riskRows = Object.entries(s.risk || {}).sort((a, b) => b[1].score - a[1].score).slice(0, 10);
  for (const [id, r] of riskRows) {
    lines.push("  " + fit(id, 38).padEnd(38) + " score " + String(r.score).padStart(3) + "  " + sevBadge(r.severity));
  }
  lines.push("");
  lines.push(C("1", "Dependency tree (most fragile path)"));
  if (s.fragilePath) {
    const chain = [s.fragilePath.id, ...(s.fragilePath.chain || [])];
    lines.push("  " + chain.map((x, i) => (i ? "→ " : "") + x).join(" "));
  } else {
    lines.push("  none");
  }
  lines.push("");
  if (dev) {
    lines.push(C("1", "Developer panel"));
    lines.push("  rowCount " + s.pluginCount + "  pkgCount " + (a.ecosystem.packages ? Object.keys(a.ecosystem.packages).length : "—") +
      "  edges " + s.edgeCount + "  layers " + (a.ecosystem.layers ? a.ecosystem.layers.length : "—"));
    lines.push("  truthSource " + ts + "  confCap " + cc + "  harness " + (a.ecosystem.harnessVersion || "—"));
    lines.push("  collectedAt " + (a.ecosystem.collectedAt || "—").replace("T", " ").slice(0, 19));
    lines.push("  conflicts " + c.summary.total + "  leaks " + leakN + "  avgScore " + s.avgScore + "  maxScore " + s.maxScore);
    lines.push("  findingsValid " + fv);
    lines.push("");
  }
  if (err) lines.push(C("31", "  refresh failed: " + err));
  lines.push(C("90", "  [W] web  [R] refresh  [G] 生成报告(长文本浏览)  [D] 开发者面板  [V] 查看报告  [Q] quit"));
  return lines.join("\n");
}

function runInteractiveTui(getAnalysis, opts, initialAnalysis) {
  let analysis = initialAnalysis || loadAnalysis(opts);
  let lastError = null;
  let devPanel = false;
  let view = null; // null = main frame; "report" = scrollable markdown report
  let viewOffset = 0;
  let reportPath = null;

  const mdLines = () => buildMarkdownReport(analysis, { reproduce: "node cli/dsh-forge.mjs check --json" }).split("\n");

  const draw = () => {
    console.clear();
    if (view === "report") {
      const lines = mdLines();
      const h = Math.max(10, (process.stdout.rows || 30) - 1);
      const total = lines.length;
      if (viewOffset > Math.max(0, total - h)) viewOffset = Math.max(0, total - h);
      if (viewOffset < 0) viewOffset = 0;
      const win = lines.slice(viewOffset, viewOffset + h);
      const fp = reportPath ? path.basename(reportPath) : "";
      process.stdout.write(win.join("\n") + "\n" +
        C("90", " ⠿ report " + (viewOffset + 1) + "-" + Math.min(total, viewOffset + h) + "/" + total + (fp ? " · " + fp : "") +
          "  [↑][↓][PgUp][PgDn]/[space][b] scroll  [R] 重新生成  [Q]/[Esc] 返回  ") + "\n");
      return;
    }
    process.stdout.write(renderTui(analysis, lastError, devPanel) + "\n");
  };

  const clearLast = () => { lastError = null; };

  const generateReport = () => {
    try {
      clearAnalysisCache();
      analysis = runAnalysis({ profile: opts.profile, datasetPath: opts.dataset });
      const rep = writeReport(analysis, reportOpts());
      reportPath = rep.reportPath;
      lastError = null;
      view = "report";
      viewOffset = 0;
    } catch (e) {
      lastError = String((e && e.message) || e).split("\n")[0];
      view = null;
    }
  };

  draw();
  if (!process.stdin.isTTY) return; // explicit `tui` in a pipe: render once, then exit
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  const onData = async (key) => {
    const k = (key || "").toLowerCase();
    if (view === "report") {
      // ── scrollable report pager ──
      if (k === "q" || key === "\u0003" || key === "\u001b") { view = null; draw(); return; }
      if (key === "\u001b[A") { viewOffset = Math.max(0, viewOffset - 1); draw(); return; }  // ↑
      if (key === "\u001b[B") { viewOffset += 1; draw(); return; }                            // ↓
      if (key === " " || key === "\u001b[6~") { viewOffset = Math.max(0, viewOffset - 1) + 10; draw(); return; } // PgDn
      if (k === "b" || key === "\u001b[5~") { viewOffset = Math.max(0, viewOffset - 10); draw(); return; }        // PgUp
      if (key === "\u0001") { viewOffset = 0; draw(); return; }                               // Home
      if (k === "r") { generateReport(); draw(); return; }
      return;
    }
    // ── main TUI frame ──
    if (k === "q" || key === "\u0003") {
      cleanup();
      process.exit(0);
    } else if (k === "w") {
      cleanup();
      await startWeb(analysis, opts);
    } else if (k === "r") {
      clearAnalysisCache(); // R = explicit refresh: skip the analysis cache
      try {
        analysis = runAnalysis({ profile: opts.profile, datasetPath: opts.dataset });
        clearLast();
      } catch (e) {
        lastError = String((e && e.message) || e).split("\n")[0];
      }
      draw();
    } else if (k === "g" || k === "v") {
      generateReport();
      draw();
    } else if (k === "d") {
      devPanel = !devPanel;
      draw();
    }
  };
  const cleanup = () => {
    process.stdin.removeListener("data", onData);
    process.stdin.setRawMode(false);
    process.stdin.pause();
  };
  process.stdin.on("data", onData);
}

async function startWeb(initialAnalysis, opts) {
  const requested = opts.port;
  const degrade = (analysis) => {
    if (process.stdout.isTTY && decideAfterPortProbe(UI_MODE.WEB, false, { tty: true }).mode === UI_MODE.TUI) {
      runInteractiveTui(() => loadAnalysis(opts), opts);
    } else {
      console.log(opts.json ? jsonSummary(analysis, opts) : plainSummary(analysis));
    }
  };
  const server = await startWebServer({
    host: opts.host,
    port: requested,
    open: opts.open,
    initialAnalysis,
    refresh: () => { clearAnalysisCache(); return runAnalysis({ profile: opts.profile, datasetPath: opts.dataset }); },
    reportOpts,
    onOccupied: () => {
      console.error("[dsh-forge] port " + requested + " is occupied \u2192 degrade");
      degrade(initialAnalysis);
    },
    onError: (e) => {
      console.error("[dsh-forge] web server failed: " + String(e.message || e));
      degrade(initialAnalysis);
    },
    onListen: (url, actualPort) => {
      if (!isLoopbackHost(opts.host)) console.log("[dsh-forge] WARNING: bound to non-loopback host; /api/report (write) is REFUSED here.");
      console.log("[dsh-forge] web panel listening at " + url);
      if (opts.open && openBrowser(url)) console.log("[dsh-forge] browser opened: " + url);
      console.log("[dsh-forge] press Ctrl+C to stop");
    }
  });
  if (!server) return;
  process.once("SIGINT", () => { server.close(() => process.exit(0)); });
}

// ── main: four-layer evidence decision ──────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  if (opts.help) { console.log(HELP); return; }
  if (opts.version) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
      console.log(pkg.version);
    } catch {
      console.log("unknown"); // package.json unreadable -> fall back to literal 'unknown'
    }
    return;
  }

  const analysis = loadAnalysis(opts);
  const decision = decideUiMode({
    command: opts.command,
    json: opts.json,
    tty: process.stdout.isTTY,
    term: process.env.TERM || "xterm",
    ci: Boolean(process.env.CI),
    desktop: hasDesktop(process.env),
    pluginCount: analysis.assessment.pluginCount
  });
  console.error("[dsh-forge] mode decision: " + decision.mode + " — " + decision.reasons.join("; "));

  if (decision.mode === UI_MODE.CHECK) {
    if (opts.json) console.log(jsonSummary(analysis, opts));
    else console.log(plainSummary(analysis));
    const gate = buildCheckReport(analysis).gate;
    if (!gate.pass) {
      console.error("[dsh-forge] gate BLOCKED: critical " + gate.blocked.critical + ", high " + gate.blocked.high + " — exiting 1 for CI");
      process.exit(1);
    }
    return;
  }
  if (decision.mode === UI_MODE.WEB) {
    await startWeb(analysis, opts);
    return;
  }

  // TUI path. Complexity-based recommendation is shown without forcing Web.
  if (decision.recommendWeb && process.stdout.isTTY) {
    console.log("[dsh-forge] " + decision.complexityNote + ". Press W in the TUI or run `dsh-forge web`.");
  }
  runInteractiveTui(() => loadAnalysis(opts), opts, analysis);
}

main().catch((e) => {
  console.error("[dsh-forge] fatal: " + String(e.message || e).split("\n")[0]);
  process.exit(1);
});
