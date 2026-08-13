// dsh-forge/core/index.js
// Public analysis API. Dependency-free (node builtins only).
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

import { parseCompositionText, mergeRows, discoverSources, collectEcosystem, evalJsExpr, packageOf, rangeOk, resolveInstalled } from "./composition.js";
import { buildGraph, assess, baselineVersion, riskScore } from "./analyze.js";
import { checkConflicts, scanToolNames, scanServices } from "./conflicts.js";
import { simulateCombination, applyOps } from "./simulate.js";
import { html, mermaid, asciiTree } from "./visualize.js";
import { dashboard, buildEmbedData } from "./dashboard.js";
import { knownPatterns, scanDeprecations, KNOWN_LIBS, CLIENT_PLANE_SERVICES, runtimeVerified } from "./knowledge.js";
import { satisfies, compareVersions, parseVersion, maxSatisfying } from "./semver.js";

export { parseCompositionText, mergeRows, discoverSources, collectEcosystem, evalJsExpr, packageOf, rangeOk, resolveInstalled };
export { buildGraph, assess, baselineVersion, riskScore };
export { checkConflicts, scanToolNames, scanServices };
export { simulateCombination, applyOps };
export { html, mermaid, asciiTree, dashboard, buildEmbedData };
export { knownPatterns, scanDeprecations, KNOWN_LIBS, CLIENT_PLANE_SERVICES, runtimeVerified };
export { satisfies, compareVersions, parseVersion, maxSatisfying };

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
    format: "dsh-forge-ecosystem@1",
    collectedAt: new Date().toISOString(),
    nmRoot: eco.nmRoot || null,
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

export function loadSnapshot(file) {
  const snap = JSON.parse(fs.readFileSync(file, "utf8"));
  if (snap.format !== "dsh-forge-ecosystem@1") {
    throw new Error("unsupported snapshot format: " + snap.format);
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
    snapshot: true,
    collectedAt: snap.collectedAt
  };
}

// One-shot analysis pipeline.
// opts: { home, profile, root, compositionFiles, datasetPath }
export function runAnalysis(opts = {}) {
  const eco = opts.datasetPath ? loadSnapshot(opts.datasetPath) : collectEcosystem(opts);
  const graph = buildGraph(eco);
  const conflicts = checkConflicts(eco, { graph });
  const assessment = assess(eco, conflicts);
  const patterns = knownPatterns(eco);
  const deprecations = scanDeprecations(eco.packages);
  const verified = runtimeVerified(eco);
  return { ecosystem: eco, graph, conflicts, assessment, patterns, deprecations, verified };
}

// Default node_modules root discovery for live runs.
// The deployment root is where the harness's own plugin packages
// (@deepseek-ai/dsh-base etc.) are installed; the profile dir usually has
// only the user's link: packages, so we probe several bases.
export function resolveNmRoot(profile) {
  const candidates = [];
  const home = process.env.DSH_HOME || "";
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