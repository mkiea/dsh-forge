// dsh-forge/core/index.js
// Public analysis API. Dependency-free (node builtins only).
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";

import { parseCompositionText, parseCompositionTextStrict, mergeRows, discoverSources, collectEcosystem, evalJsExpr, packageOf, rangeOk, resolveInstalled, defaultHome } from "./composition.js";
import { buildGraph, assess, baselineVersion, riskScore } from "./analyze.js";
import { checkConflicts, scanToolNames, scanServices } from "./conflicts.js";
import { simulateCombination, applyOps } from "./simulate.js";
import { html, mermaid, asciiTree } from "./visualize.js";
import { dashboard, buildEmbedData } from "./dashboard.js";
import { auditConfiguration } from "./audit.js";
import { diffCombinations } from "./diff.js";
import { archiveSnapshot, listHistory, loadHistory } from "./history.js";
import { comparePresets, readPreset } from "./presets.js";
import { verifyRows } from "./verify.js";
import { suggestPatch } from "./suggest.js";
import { checkUpgrades } from "./upgrade.js";
import { historyStats } from "./stats.js";
import { scanLeaks } from "./leaks.js";
import { attachFindingIds, capConfidence, validateFindings, makeFindingId } from "./evidence.js";
import { fuse } from "./evidence-fusion.js";
import { createRuntimeCalibration, staticRuntimeCalibration } from "./runtime-calibration.js";
import { createCalibration, staticCalibration } from "./calibration.js";
import { buildFeedback, normalizeFeedback, preflight, renderFeedback, SEVERITY_ORDER } from "./errors.js";

import { knownPatterns, scanDeprecations, KNOWN_LIBS, CLIENT_PLANE_SERVICES, runtimeVerified, RUNTIME_VERIFICATION_CHECKS } from "./knowledge.js";
import { satisfies, compareVersions, parseVersion, maxSatisfying } from "./semver.js";
import { UI_MODE, hasDesktop, scenarioHints, decideUiMode, decideAfterPortProbe, COMPLEXITY_LIGHT, COMPLEXITY_HEAVY } from "./mode.js";

export { parseCompositionText, parseCompositionTextStrict, mergeRows, discoverSources, collectEcosystem, evalJsExpr, packageOf, rangeOk, resolveInstalled, defaultHome };
export { buildGraph, assess, baselineVersion, riskScore };
export { checkConflicts, scanToolNames, scanServices };
export { simulateCombination, applyOps };
export { html, mermaid, asciiTree, dashboard, buildEmbedData };
export { auditConfiguration };
export { diffCombinations };
export { archiveSnapshot, listHistory, loadHistory };
export { comparePresets, readPreset };
export { verifyRows };
export { suggestPatch };
export { checkUpgrades };
export { historyStats };
export { scanLeaks, createCalibration, staticCalibration };
export { attachFindingIds, capConfidence, validateFindings, makeFindingId };
export { fuse };
export { createRuntimeCalibration, staticRuntimeCalibration };
export { buildFeedback, normalizeFeedback, preflight, renderFeedback, SEVERITY_ORDER };

export { knownPatterns, scanDeprecations, KNOWN_LIBS, CLIENT_PLANE_SERVICES, runtimeVerified, RUNTIME_VERIFICATION_CHECKS };
export { satisfies, compareVersions, parseVersion, maxSatisfying };
export { UI_MODE, hasDesktop, scenarioHints, decideUiMode, decideAfterPortProbe, COMPLEXITY_LIGHT, COMPLEXITY_HEAVY };

// ── snapshots (offline analysis / reproducible reports) ──────────────────
export function saveSnapshot(eco, file) {
  // persist source-scan results so offline (no-dir) round trips stay faithful
  let toolNames = eco.toolNames, services = eco.services;
  if (!toolNames || !services) {
    try {
      const res = scanToolNames(eco.packages);
      toolNames = Object.fromEntries(Object.entries(res).map(([p, n]) => [p, n]));
      services = scanServices(eco.packages);
    } catch { /* leave undefined; offline scans will be empty */ }
  }
  const snap = {
    format: SNAPSHOT_FORMAT,
    collectedAt: new Date().toISOString(),
    nmRoot: eco.nmRoot || null,
    harnessVersion: eco.harnessVersion || null,
    toolNames,
    services,
    layers: eco.layers.map((l) => ({
      layer: l.layer,
      rows: l.rows || []
    })),
    rows: eco.rows.map((r) => ({ ...r })),
    packages: Object.fromEntries(Object.entries(eco.packages).map(([p, m]) => [
      p,
      { version: m.version, description: m.description || "", dependencies: m.dependencies, peerDependencies: m.peerDependencies, deprecated: m.deprecated || null }
    ])),
    installed: { ...eco.installed },
    nested: eco.nested ? JSON.parse(JSON.stringify(eco.nested)) : undefined
  };
  fs.writeFileSync(file, JSON.stringify(snap, null, 2), "utf8");
  return file;
}

export const SNAPSHOT_FORMAT = "dsh-forge-ecosystem@1";
const SNAPSHOT_MIGRATIONS = new Map();
export function registerSnapshotMigration(from, migrate) {
  if (typeof migrate !== "function") throw new TypeError("snapshot migration must be a function");
  SNAPSHOT_MIGRATIONS.set(from, migrate);
}
// Legacy snapshots saved before the `format` field existed can still be loaded
// when their shape is already the @1 shape.
registerSnapshotMigration("unversioned", (snap) => {
  if (!Array.isArray(snap.rows) || !Array.isArray(snap.layers) || typeof snap.packages !== "object") {
    throw new Error("unversioned snapshot does not look like dsh-forge-ecosystem@1");
  }
  return { ...snap, format: SNAPSHOT_FORMAT };
});

export function loadSnapshot(file) {
  let snap = JSON.parse(fs.readFileSync(file, "utf8"));
  let migratedFrom = null;
  const seen = new Set();
  while ((snap.format || "unversioned") !== SNAPSHOT_FORMAT) {
    const from = snap.format || "unversioned";
      if (seen.has(from)) throw new Error("snapshot migration cycle at format: " + from);
      seen.add(from);
      const migrate = SNAPSHOT_MIGRATIONS.get(from);
      if (!migrate) throw new Error("unsupported snapshot format '" + from + "' in " + file + ". Supported: " + SNAPSHOT_FORMAT + ". Register a migration with registerSnapshotMigration() or regenerate the snapshot.");
      snap = migrate(snap);
      migratedFrom = migratedFrom || from;
  }
  return {
    layers: snap.layers,
    rows: snap.rows.map((r) => ({ ...r, layers: [...(r.layers || [])] })),
    packages: snap.packages,
    installed: snap.installed,
    nested: snap.nested || {},
    toolNames: snap.toolNames || null,
    services: snap.services || null,
    nmRoot: snap.nmRoot,
    harnessVersion: snap.harnessVersion || null,
    snapshot: true,
    collectedAt: snap.collectedAt,
      migratedFrom
  };
}

// One-shot analysis pipeline.
// opts: { home, profile, root, compositionFiles, datasetPath }
// In-memory analysis cache. Repeated calls with identical inputs reuse the
// previous result instead of re-scanning the composition. The signature
// includes file mtimes for explicit compositionFiles/datasets AND the
// auto-discovered live sources (profile cordis.yml/patch + bundle patches),
// so edits invalidate it; call clearAnalysisCache() to force a fresh scan
// (TUI R-refresh, tests, after config edits). Cached results are READ-ONLY:
// callers must not mutate the returned object/graph/ecosystem.
const analysisCache = new Map();
const ANALYSIS_CACHE_MAX = 16;

function fileStamp(p) {
  try { const st = fs.statSync(p); return st.mtimeMs + ":" + st.size; }
  catch { return "missing"; }
}

function liveSourceStamps(opts) {
  if (opts.datasetPath) return [];
  try {
    const layers = discoverSources({ home: opts.home, profile: opts.profile, root: opts.root });
    const files = [];
    const home = opts.home || defaultHome();
    if (opts.profile) files.push(path.join(home, "profiles", opts.profile, "package.json"));
    for (const l of layers) {
      if (l.path) files.push(l.path);
    }
    return files.map((f) => f + "@" + fileStamp(f));
  } catch {
    return ["live-sources-unavailable"]; // discovery failed; collectEcosystem will report the real error
  }
}

function analysisKey(opts) {
  const files = (opts.compositionFiles || []).slice().sort().map((f) => f + "@" + fileStamp(f));
  const base = {
    profile: opts.profile || null,
    root: opts.root || null,
    home: opts.home || null,
    compositionFiles: files,
    liveSources: liveSourceStamps(opts)
  };
  if (opts.datasetPath) base.dataset = opts.datasetPath + "@" + fileStamp(opts.datasetPath);
  return JSON.stringify(base);
}

// Drop all cached analyses (TUI refresh, tests, after config edits).
export function clearAnalysisCache() { analysisCache.clear(); }

export function runAnalysis(opts = {}) {
  const key = analysisKey(opts);
  const hit = analysisCache.get(key);
  if (hit) return hit;
  const eco = opts.datasetPath ? loadSnapshot(opts.datasetPath) : collectEcosystem(opts);
  const graph = buildGraph(eco);
  const conflicts = checkConflicts(eco, { graph });
  const assessment = assess(eco, conflicts);
  const patterns = knownPatterns(eco);
  const deprecations = scanDeprecations(eco.packages);
  const verified = runtimeVerified(eco);
  const leaks = scanLeaks(eco.packages);
  // A-2 / INV-6: every finding carries a stable finding_id + confidence/evidence.
  attachFindingIds(conflicts.conflicts);
  attachFindingIds(leaks.findings);
  // INV-4 truth-source confidence cap: scan-derived results never exceed medium
  // (dump-config may reach high; dataset/snapshot loads keep their recorded level).
  const effectiveTruthSource = eco.truthSource || (opts.datasetPath ? "snapshot" : "scan");
  const capSource = effectiveTruthSource === "scan";
  if (capSource) { conflicts.conflicts = capConfidence(conflicts.conflicts, "medium"); leaks.findings = capConfidence(leaks.findings, "medium"); }
  const feedback = buildFeedback({ conflicts, leaks, assessment, patterns, verified });
  const findingsValid = validateFindings([...conflicts.conflicts, ...leaks.findings]);
  const result = { ecosystem: eco, graph, conflicts, assessment, patterns, deprecations, verified, leaks, feedback, truthSource: effectiveTruthSource, confidenceCap: capSource ? "medium" : (effectiveTruthSource === "dump-config" ? "high" : null), findingsValid };
  if (analysisCache.size >= ANALYSIS_CACHE_MAX) analysisCache.delete(analysisCache.keys().next().value);
  analysisCache.set(key, result);
  return result;
}

// Default node_modules root discovery for live runs.
// The deployment root is where the harness's own plugin packages
// (@deepseek-ai/dsh-base etc.) are installed; the profile dir usually has
// only the user's link: packages, so we probe several bases.
export function resolveNmRoot(profile) {
  const candidates = [];
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  const profileName = profile || "web";
  const profileDir = path.join(home, "profiles", profileName);
  if (process.env.DSH_FORGE_ROOT) candidates.push(process.env.DSH_FORGE_ROOT);
  if (home) {
    candidates.push(path.join(profileDir, "node_modules"));
    candidates.push(path.join(home, "node_modules"));
  }
  // walk up from cwd
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const probe = path.join(dir, "node_modules");
    if (fs.existsSync(path.join(probe, "@deepseek-ai", "dsh-base", "package.json"))) candidates.push(probe);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // resolve through this module's own install if it is inside a deployment
  try {
    const req = createRequire(import.meta.url);
    const p = req.resolve("@deepseek-ai/dsh-base/package.json");
    const idx = p.indexOf("node_modules");
    if (idx >= 0) candidates.push(p.slice(0, idx + "node_modules".length));
  } catch { /* not installed inside a deployment */ }
  // resolve from the profile directory: in this deployment the harness's
  // install root is reachable from there (observed stable), which covers the
  // symlinked ui-plugin/dsh-forge install layout.
  if (profileDir) {
    try {
      const req = createRequire(path.join(profileDir, "resolve-probe.js"));
      const p = req.resolve("@deepseek-ai/dsh-base/package.json");
      const idx = p.indexOf("node_modules");
      if (idx >= 0) candidates.push(p.slice(0, idx + "node_modules".length));
    } catch { /* profile dir cannot reach the deployment root */ }
  }
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, "@deepseek-ai", "dsh-base", "package.json"))) return c;
  }
  return candidates[0] || null;
}