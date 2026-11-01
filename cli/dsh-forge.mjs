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
  runAnalysis, runAnalysisAsync, clearAnalysisCache, buildCheckReport, simulateUpgrade,
  probeEcosystem, mergeDynamicFindings, DEFAULT_PROBE_TIMEOUT_MS,
  buildMarkdownReport, writeReport,
  UI_MODE, decideUiMode, decideAfterPortProbe,
  hasDesktop, COMPLEXITY_LIGHT, COMPLEXITY_HEAVY,
  validatePolicy, resolveDshHome, buildBridge, loadTruthEcosystem, DEFAULT_BRIDGE_PROFILES,
  planSync, applySync, DEFAULT_SYNC_TIMEOUT_MS
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
    profile: process.env.DSH_FORGE_PROFILE || "web",
    to: null,
    dynamic: false,
    dynamicTimeout: DEFAULT_PROBE_TIMEOUT_MS
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json" || a === "-j") out.json = true;
    else if (a === "--no-open") out.open = false;
    else if (a === "--to") { out.to = argv[++i] || out.to; }
    else if (a === "--port") { out.port = Number(argv[++i] || out.port); }
    else if (a === "--host") { out.host = argv[++i] || out.host; }
    else if (a === "--dataset") { out.dataset = argv[++i] || out.dataset; }
    else if (a === "--profile") { out.profile = argv[++i] || out.profile; }
    else if (a === "--profiles") { out.profiles = argv[++i] || out.profiles; }
    else if (a === "--root") { out.root = argv[++i] || out.root; }
    else if (a === "--static") out.static = true;
    else if (a === "--apply") out.apply = true;
    else if (a === "--confirm") { out.confirm = argv[++i] || out.confirm; }
    else if (a === "--reference") { out.reference = argv[++i] || out.reference; }
    else if (a === "--packages") { out.packages = argv[++i] || out.packages; }
    else if (a === "--no-preflight") out.preflight = false;
    else if (a === "--no-probe") out.probe = false;
    else if (a === "--include-runtime") out.includeRuntime = true;
    else if (a === "--force") out.force = true;
    else if (a === "--sync-timeout") { out.syncTimeout = Number(argv[++i] || out.syncTimeout); }
    else if (a === "--policy") { out.policy = argv[++i] || out.policy; }
    else if (a === "--dynamic") out.dynamic = true;
    else if (a === "--dynamic-timeout") { out.dynamicTimeout = Number(argv[++i] || out.dynamicTimeout); }
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
  dsh-forge plan --to X    offline upgrade-path prediction (advisory, never gates)
  dsh-forge bridge         web ↔ desktop connector: compare both compositions
  dsh-forge sync           align web plugins/versions to the desktop baseline
                           (dry-run by default; --apply installs and verifies)

Options:
  --profile <name>         profile to analyze (default: web)
  --profiles <a,b>         bridge/sync: profiles to compare (default: web,desktop)
  --root <dir>             bridge/sync: node_modules root used to resolve bundles
  --static                 bridge: scan composition files only (skip dump-config truth)
  --dataset <path>         offline ecosystem snapshot JSON
  --to <pkg@ver,...>       plan: target versions, comma-separated (offline)
  --apply                  sync: actually install the planned versions
  --confirm <token>        sync: required with --apply (sync-<profile>)
  --reference <name>       sync: baseline side (default: desktop; desktop is read-only)
  --packages <a,b>         sync: limit alignment to these packages
  --no-preflight           sync: skip registry existence checks before installing
  --no-probe               sync: skip post-install dynamic import verification
  --include-runtime        sync: also install desktop @deepseek-ai/* runtime packages into web
  --force                  sync: proceed despite unresolved bundles (unsafe)
  --sync-timeout <ms>      sync: install command timeout (default: ${DEFAULT_SYNC_TIMEOUT_MS})
  --policy <file.json>     gate policy (severity/tier/confidence -> block|warn|allow); opt-in verdict for check; absent = frozen gate
  --dynamic                check: also import every package entry at runtime (catches removed exports like dsh-llm CallId)
  --dynamic-timeout <ms>   runtime probe batch timeout (default: ${DEFAULT_PROBE_TIMEOUT_MS})
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

// Entry loader: prefers dump-config ground truth (dsh --dump-config), falling
// back to the source scan when the dump is unavailable — same preference as the
// tool path, so `check`/`plan`/`web` no longer silently degrade to scan.
async function loadAnalysisAsync(opts) {
  try {
    return await runAnalysisAsync({
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
  if (a.ecosystem.layout === "desktop-asar") lines.push("  layout         : desktop-asar (resources/app.asar; profile not dumpable)");
  return lines.join("\n");
}
function jsonSummary(a, opts) {
  return JSON.stringify(buildCheckReport(a, {
    dataset: opts.dataset || null,
    policy: opts.policyObj,
    reproduce: opts.dataset ? "node cli/dsh-forge.mjs check --json --dataset " + opts.dataset : "node cli/dsh-forge.mjs check --json"
  }), null, 2);
}

// ── plan: offline upgrade-path prediction (advisory, never gates) ──────────
function parseWish(to) {
  if (!to) return null;
  const wish = {};
  for (const spec of String(to).split(",")) {
    const m = /^(.+)@(\S+)$/.exec(spec.trim());
    if (m) wish[m[1].trim()] = m[2];
  }
  return wish;
}
function planSummary(r) {
  const up = r.upgraded.length
    ? r.upgraded.map((u) => u.package + "@" + u.from + " -> " + u.to + (u.safe ? " (safe)" : " (breaks " + u.breaks.length + ")")).join(", ")
    : "(none)";
  const lines = [
    "dsh-forge plan",
    "  upgraded     : " + up,
    "  before       : " + r.before.health + " (avg " + r.before.avgScore + ", conflicts " + r.before.conflicts.total + ")",
    "  after        : " + r.after.health + " (avg " + r.after.avgScore + ", conflicts " + r.after.conflicts.total + ")",
    "  riskDelta    : " + (r.riskDelta > 0 ? "+" : "") + r.riskDelta,
    "  conflicts    : +" + r.newConflicts.length + " / -" + r.resolvedConflicts.length + " (new/resolved)",
    "  verdict      : " + r.verdict,
    "  steps:"
  ];
  r.doSteps.forEach((s) => lines.push("    - " + s));
  return lines.join("\n");
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

// Web ↔ desktop bridge: plain-text view of the same payload /api/bridge serves.
function bridgeSummary(r) {
  const L = ["dsh-forge bridge · " + r.generatedAt,
    "home: " + (r.home || "(unknown)") + " · desktop asar: " + (r.desktop.available ? r.desktop.asar : "not found")];
  for (const p of r.profiles) {
    L.push("  " + String(p.name).padEnd(10) + " rows " + p.rows + " · packages " + p.packageCount +
      " · harness " + (p.harnessVersion || "?") + " · " + (p.truthSource || "scan") +
      (p.error ? " · ERROR " + p.error : ""));
    if (p.missingBundles && p.missingBundles.length) {
      L.push("             missing bundles: " + p.missingBundles.join(", "));
    }
  }
  for (const x of r.pairs) {
    L.push("");
    L.push(x.left + " × " + x.right + ": " + x.verdict + " (similarity " + x.similarity + "%)");
    L.push("  shared " + x.matched + "/" + x.union + " · rows " + x.rows.left + " vs " + x.rows.right +
      " · harness " + (x.harness.left || "?") + " vs " + (x.harness.right || "?") + (x.harness.drift ? " (drift)" : ""));
    if (x.complete === false) {
      const parts = [];
      if (x.missing && x.missing.left && x.missing.left.length) parts.push(x.left + ": " + x.missing.left.join(", "));
      if (x.missing && x.missing.right && x.missing.right.length) parts.push(x.right + ": " + x.missing.right.join(", "));
      L.push("  PARTIAL — unresolved bundles (" + parts.join("; ") +
        "); similarity is limited by reachability — install that profile's harness, or pass --root <node_modules> for a complete comparison");
    }
    if (x.shared.length) L.push("  version drift: " + clampList(x.shared.map((s) => s.package + " " + s.left + "→" + s.right)));
    if (x.onlyLeft.length) L.push("  only " + x.left + ": " + clampList(x.onlyLeft));
    if (x.onlyRight.length) L.push("  only " + x.right + ": " + clampList(x.onlyRight));
  }
  return L.join("\n");
}

// Keep long package lists readable in a terminal; the JSON output stays complete.
function clampList(items, max = 12) {
  if (items.length <= max) return items.join(", ");
  return items.slice(0, max).join(", ") + " … (+" + (items.length - max) + " more)";
}

// Shared payload for `bridge` and `sync`: non-desktop profiles prefer
// dump-config ground truth, desktop is always an asar-enhanced static scan.
async function collectBridgePayload(opts, profiles) {
  const home = resolveDshHome() || process.env.DSH_HOME || undefined;
  const ecosystems = {};
  if (opts.static !== true) {
    for (const name of profiles) {
      if (name === "desktop") continue;
      try {
        const lt = await loadTruthEcosystem({ home, profile: name });
        if (lt && lt.ok && lt.ecosystem) ecosystems[name] = lt.ecosystem;
      } catch { /* fall back to the static scan for this profile */ }
    }
  }
  const bridge = buildBridge({ home, profiles, ecosystems, root: opts.root });
  return { home, bridge };
}

// Plain-text view of the alignment plan (same object POST/GET /api/sync serves).
function syncSummary(plan) {
  const L = ["dsh-forge sync · " + plan.generatedAt,
    "web: " + plan.web + " ← reference: " + plan.reference + " · desktop: " + (plan.desktopAvailable ? plan.desktop : "未检测到")];
  if (plan.status === "no-desktop") L.push("状态: no-desktop — 未检测到桌面端归档，没有可对齐的第二端");
  else L.push("状态: " + plan.status + (plan.ok
    ? (plan.actions.length ? " · 待对齐 " + plan.actions.length + " 个插件" : " · 已对齐")
    : " · 需处理 " + plan.blocked.length + " 个阻塞项"));
  if (plan.harness && plan.harness.drift) {
    const h = plan.harness;
    L.push("harness: web " + (h.web || "?") + " vs desktop " + (h.desktop || "?") +
      (h.action && h.action.blocked ? "（桌面端需更新）" : " → web 对齐到 " + (h.action && h.action.to)));
    if (h.action && h.action.command) L.push("  " + h.action.command);
  }
  const byDirection = { upgrade: [], downgrade: [], align: [], add: [] };
  for (const a of plan.actions) {
    if (a.kind !== "install") continue;
    (byDirection[a.action === "add" ? "add" : a.direction] || byDirection.align).push(
      a.package + " " + (a.from || "—") + " → " + a.to
    );
  }
  for (const key of ["upgrade", "downgrade", "align", "add"]) {
    if (!byDirection[key].length) continue;
    L.push("  " + key + " (" + byDirection[key].length + "): " + clampList(byDirection[key]));
  }
  if (!plan.actions.length && plan.status === "ok") L.push("  无需改动：两端版本一致");
  for (const b of plan.blocked) {
    L.push("  BLOCKED [" + b.scope + "]" + (b.package ? " " + b.package : b.side ? " " + b.side : "") + ": " + b.reason);
  }
  for (const d of plan.desktopMissing) {
    L.push("  桌面端缺口: " + d.package + "@" + (d.version || "?") + " — " + d.reason);
  }
  if (plan.desktopRuntime.length) {
    L.push("  桌面端运行时包（未装入 web）: " + plan.desktopRuntime.length + " 个 — " +
      clampList(plan.desktopRuntime.map((d) => d.package)) + "；需要时加 --include-runtime");
  }
  for (const w of plan.warnings) L.push("  ! " + w);
  if (plan.install) {
    L.push("安装计划: " + plan.install.count + " 个包 / " + plan.install.batches.length + " 批");
    for (const batch of plan.install.batches) L.push("  " + batch.command);
    L.push("执行: dsh-forge sync --apply --confirm sync-" + plan.web);
  }
  return L.join("\n");
}

function syncResultSummary(r) {
  const L = [];
  if (r.applied) L.push(r.ok ? "安装完成并通过验证" : "安装后验证失败，已回滚");
  else if (r.skipped === "nothing-to-install") L.push("无需安装：两端已对齐");
  else if (r.skipped === "no-desktop") L.push("无可对齐的桌面端");
  else L.push("未执行安装" + (r.error ? "：" + r.error : ""));
  for (const s of r.steps || []) {
    L.push((s.ok ? "  OK   " : "  FAIL ") + s.command);
    if (!s.ok && s.stderr) L.push("        " + String(s.stderr).split(/\r?\n/)[0]);
  }
  if (r.preflight && (r.preflight.unavailable.length || r.preflight.unknown.length)) {
    L.push("预检: 不可用 " + r.preflight.unavailable.length + " · 未知 " + r.preflight.unknown.length +
      (r.preflight.unavailable.length ? "（" + clampList(r.preflight.unavailable) + "）" : ""));
  }
  const v = r.verification;
  if (v && !v.skipped) {
    L.push("验证: 版本 " + (v.mismatches.length ? "不匹配 " + v.mismatches.length : "全部匹配") +
      " · 动态导入 " + (v.dynamic ? v.dynamic.ok + "/" + v.dynamic.probed : "未执行"));
    for (const m of v.mismatches || []) L.push("  " + m.package + ": 期望 " + m.expected + " 实际 " + (m.actual || "不可见"));
    for (const f of v.loadFailures || []) L.push("  " + f.package + ": 导入失败（" + f.category + "） " + (f.error || ""));
    for (const w of v.loadWarnings || []) L.push("  " + w.package + ": 导入告警（" + w.category + "） " + (w.error || ""));
  }
  if (r.rollback) {
    L.push("已回滚 " + r.rollback.restored.length + " 个文件" +
      (r.rollback.removed.length ? "，删除 " + r.rollback.removed.length + " 个新文件" : ""));
    L.push("需要恢复依赖请执行: " + r.rollback.command);
  }
  return L.join("\n");
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
  const home = resolveDshHome() || process.env.DSH_HOME;
  const profileDir = home && opts.profile ? path.join(home, "profiles", opts.profile) : undefined;
  const server = await startWebServer({
    host: opts.host,
    port: requested,
    open: opts.open,
    profile: opts.profile,
    profileDir,
    home: home || undefined,
    root: opts.root,
    bridgeProfiles: [opts.profile, "desktop"],
    datasetPath: opts.dataset,
    historyDir: HISTORY_DIR || undefined,
    autoArchive: process.env.DSH_FORGE_AUTO_ARCHIVE !== "0",
    initialAnalysis,
    refresh: () => { clearAnalysisCache(); return runAnalysisAsync({ profile: opts.profile, datasetPath: opts.dataset }); },
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

  // Opt-in gate policy: --policy <file.json>. Read + validate; invalid -> exit 2.
  // Without it the frozen gate semantics apply (no behavior change).
  if (opts.policy) {
    try {
      const raw = JSON.parse(fs.readFileSync(opts.policy, "utf8"));
      opts.policyObj = validatePolicy(raw) || undefined;
      if (!opts.policyObj) {
        console.error("[dsh-forge] --policy produced an empty policy; ignoring (frozen gate applies).");
        delete opts.policy;
      }
    } catch (e) {
      console.error("[dsh-forge] invalid --policy: " + (e && e.message));
      process.exit(2);
    }
  }

  if (opts.version) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
      console.log(pkg.version);
    } catch {
      console.log("unknown"); // package.json unreadable -> fall back to literal 'unknown'
    }
    return;
  }

  // bridge: compare the web profile with the desktop app archive without
  // loading a full analysis first. Non-desktop profiles prefer dump-config
  // ground truth (the same truth source the dashboard uses); desktop is always
  // an asar-enhanced static scan because the app refuses --dump-config.
  if (opts.command === "bridge") {
    const profiles = opts.profiles
      ? String(opts.profiles).split(",").map((s) => s.trim()).filter(Boolean)
      : DEFAULT_BRIDGE_PROFILES.slice();
    const { bridge } = await collectBridgePayload(opts, profiles);
    console.log(opts.json ? JSON.stringify(bridge, null, 2) : bridgeSummary(bridge));
    return;
  }

  // sync: align the web profile to the desktop edition. The plan is always
  // produced first; --apply installs the exact versions, then re-collects the
  // composition and dynamically imports the touched packages. A failed install
  // or verification restores the profile files instead of leaving a half state.
  if (opts.command === "sync") {
    const profiles = opts.profiles
      ? String(opts.profiles).split(",").map((s) => s.trim()).filter(Boolean)
      : [opts.profile, "desktop"].filter(Boolean);
    const { home, bridge } = await collectBridgePayload(opts, profiles);
    const plan = planSync(bridge, {
      web: opts.profile,
      desktop: "desktop",
      reference: opts.reference,
      packages: opts.packages ? String(opts.packages).split(",").map((s) => s.trim()).filter(Boolean) : null,
      root: opts.root,
      force: opts.force === true,
      includeRuntime: opts.includeRuntime === true
    });
    if (!opts.apply) {
      console.log(opts.json ? JSON.stringify(plan, null, 2) : syncSummary(plan));
      return;
    }
    const result = await applySync(plan, {
      apply: true,
      confirm: opts.confirm,
      home,
      root: opts.root,
      preflight: opts.preflight !== false,
      probe: opts.probe !== false,
      timeoutMs: opts.syncTimeout,
      probeTimeoutMs: opts.dynamicTimeout
    });
    if (opts.json) console.log(JSON.stringify({ plan, result }, null, 2));
    else {
      console.log(syncSummary(plan));
      console.log("");
      console.log(syncResultSummary(result));
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }

  let analysis = await loadAnalysisAsync(opts);

  // plan: offline upgrade-path prediction — advisory only, never gate-exit.
  if (opts.command === "plan") {
    const wish = parseWish(opts.to);
    if (!wish || Object.keys(wish).length === 0) {
      console.error("[dsh-forge] plan needs --to <pkg@ver,...>");
      process.exit(2);
    }
    const r = simulateUpgrade(analysis.ecosystem, wish);
    if (opts.json) console.log(JSON.stringify(r, null, 2));
    else console.log(planSummary(r));
    return;
  }

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
    // --dynamic: opt-in runtime import probe. Results are merged as
    // runtime-probe findings before the gate so link-time failures (e.g. a
    // removed dsh-llm export) can block CI, not just static suspicions.
    if (opts.dynamic) {
      const probe = await probeEcosystem(analysis.ecosystem, { timeoutMs: opts.dynamicTimeout });
      analysis = mergeDynamicFindings(analysis, probe);
      const dp = analysis.dynamicProbe || {};
      console.error("[dsh-forge] dynamic probe: " + dp.probed + " packages, " + dp.failed + " failed, " + dp.elapsedMs + "ms" +
        (dp.timedOut ? " (batch timed out; unfinished packages reported as unconfirmed)" : ""));
      for (const r of (probe.results || [])) {
        if (!r.ok) console.error("  [" + r.category + "] " + r.package + ": " + String(r.error || "").slice(0, 160));
      }
    }
    if (opts.json) console.log(jsonSummary(analysis, opts));
    else console.log(plainSummary(analysis));
    const gate = buildCheckReport(analysis, { policy: opts.policyObj }).gate;
    if (!gate.pass) {
      console.error("[dsh-forge] gate BLOCKED: critical " + gate.blocked.critical + ", high " + gate.blocked.high + " · lever " + (gate.lever || "block") + " — exiting 1 for CI");
      if (Array.isArray(gate.blockedBy) && gate.blockedBy.length) {
        const top = gate.blockedBy.slice(0, 8)
          .map((b) => (b.rule || "?") + "#" + (b.finding_id || "?") + " (" + (b.confidence || "?") + (b.capped ? "/capped" : "") + ")")
          .join(" | ");
        console.error("  blocked by: " + top + (gate.blockedBy.length > 8 ? " (+" + (gate.blockedBy.length - 8) + " more)" : ""));
      }
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
