// dsh-forge/core/simulate.js
// Hypothetical combination simulation: apply add/remove/override ops to a
// composition, re-run analysis, and diff against the baseline.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { packageOf } from "./composition.js";
import { readAsarManifest } from "./asar.js";
import { buildGraph, assess } from "./analyze.js";
import { checkConflicts } from "./conflicts.js";

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null; // manifest missing/corrupt -> treated as absent
  }
}

// Merge ops into a cloned ecosystem.
export function applyOps(eco, ops) {
  const rows = eco.rows.map((r) => ({ ...r, layers: [...(r.layers || [])] }));
  const packages = { ...eco.packages };
  const installed = { ...eco.installed };
  const added = [];
  const removed = [];
  const removedScopes = {};
  let removedRows = 0;
  const overridden = [];
  const unknownDeps = [];
  // Row ids are unique per scope, not globally: a real dump repeats ids such as
  // `tool-bash` across isolated agent presets. An op that addresses an id must
  // therefore touch EVERY row carrying it; matching only the first produced
  // silently partial simulations (remove deleted 1 of 4 rows).
  const scopeLabel = (r) => (Array.isArray(r.scope) && r.scope.length ? r.scope.join(" > ") : "");
  const newRow = (id, p, cfgText, cfgPresent) => ({
    id,
    name: p,
    disabled: false,
    configPresent: cfgPresent,
    configText: cfgText,
    layers: ["simulate"]
  });
  // 0.1.7 vendored layout: installed packages may live in a supplementary root
  // (<nm>/@deepseek-ai/dsh/node_modules), not directly under eco.nmRoot.
  const roots = eco.roots && eco.roots.length ? eco.roots : (eco.nmRoot ? [eco.nmRoot] : []);
  const resolveDir = (pkg) => {
    for (const r of roots) {
      const dir = path.join(r, ...pkg.split("/"));
      if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    }
    return null;
  };

  const addList = ops.add || [];
  for (const a of addList) {
    const p = a.package || (a.name ? packageOf(a.name) : null);
    if (!p) { unknownDeps.push("add op without package: " + JSON.stringify(a)); continue; }
    const id = a.id || p.split("/").pop();
    const existing = rows.filter((r) => r.id === id);
    if (existing.some((r) => r.name === p)) {
      overridden.push({ id, note: "already composed as " + p, matched: existing.filter((r) => r.name === p).length });
      continue;
    }
    if (!packages[p]) {
      // try to resolve from any deployment node_modules root (incl. vendored)
      const dir = resolveDir(p);
      const manifest = dir ? readManifest(dir) : null;
      const asarManifest = !manifest && eco.asar ? readAsarManifest(eco.asar, p) : null;
      if (manifest) {
        packages[p] = {
          version: manifest.version,
          description: manifest.description || "",
          dependencies: manifest.dependencies || {},
          peerDependencies: manifest.peerDependencies || {},
          deprecated: manifest.deprecated || null,
          dir
        };
        installed[p] = manifest.version;
      } else if (asarManifest) {
        packages[p] = {
          version: asarManifest.manifest.version,
          description: asarManifest.manifest.description || "",
          dependencies: asarManifest.manifest.dependencies || {},
          peerDependencies: asarManifest.manifest.peerDependencies || {},
          deprecated: asarManifest.manifest.deprecated || null,
          dir: null,
          asar: { path: eco.asar, entry: asarManifest.entry, package: p }
        };
        installed[p] = packages[p].version;
      } else if (a.version || a.dependencies || a.peerDependencies) {
        packages[p] = {
          version: a.version || "0.0.0-hypothetical",
          description: a.description || "hypothetical plugin",
          dependencies: a.dependencies || {},
          peerDependencies: a.peerDependencies || {},
          deprecated: null,
          dir: null,
          synthetic: true
        };
        installed[p] = packages[p].version;
        unknownDeps.push(p + ": synthetic manifest; dependency satisfaction unverified");
      } else {
        packages[p] = {
          version: "0.0.0-hypothetical",
          description: "hypothetical plugin (not installed)",
          dependencies: {},
          peerDependencies: {},
          deprecated: null,
          dir: null,
          synthetic: true
        };
        installed[p] = packages[p].version;
        unknownDeps.push(p + ": not installed anywhere; dependencies unknown");
      }
      // record new package dependencies in installed (best effort)
      for (const d of Object.keys(packages[p].dependencies)) {
        if (!installed[d]) {
          const depDir = resolveDir(d);
          const m = depDir ? readManifest(depDir) : null;
          if (m) installed[d] = m.version;
          else if (eco.asar) {
            const am = readAsarManifest(eco.asar, d);
            if (am && am.manifest.version) installed[d] = am.manifest.version;
          }
        }
      }
    }
    const prev = rows.filter((r) => r.id === id);
    if (!prev.length) {
      rows.push(newRow(id, p, a.configText || null, !!(a.configText || a.configNote)));
    } else if (prev.every((r) => r.name === prev[0].name)) {
      // The id names one uniform slot mounted in several scopes: reuse it
      // everywhere so the simulated composition stays consistent per scope.
      for (const r of prev) {
        r.name = p;
        r.layers = [...r.layers, "simulate"];
      }
      overridden.push({ id, note: "row id reused: " + prev[0].name + " -> " + p + " (" + prev.length + " rows)", matched: prev.length });
    } else {
      // One id already maps to different packages in different scopes; an
      // id-only add cannot address them unambiguously, so append instead of
      // arbitrarily rewriting a single scoped row.
      rows.push(newRow(id, p, a.configText || null, !!(a.configText || a.configNote)));
      unknownDeps.push(id + ": row id is shared by multiple scopes; an extra row was appended instead of rewriting them");
    }
    added.push({ id, package: p, version: packages[p].version, synthetic: !!packages[p].synthetic });
  }

  for (const id of ops.remove || []) {
    if (removed.includes(id)) continue; // duplicate request: already handled
    const hit = rows.filter((r) => r.id === id);
    if (!hit.length) continue;
    removed.push(id);
    removedRows += hit.length;
    removedScopes[id] = hit.map(scopeLabel);
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].id === id) rows.splice(i, 1);
  }

  for (const o of ops.override || []) {
    const hit = rows.filter((r) => r.id === o.id);
    if (!hit.length) continue;
    for (const row of hit) {
      if (o.package) row.name = o.package;
      if (o.configText !== undefined) {
        row.configText = o.configText;
        row.configPresent = o.configText.trim().length > 0;
      }
      row.layers = [...row.layers, "simulate"];
    }
    overridden.push({ id: o.id, note: "config overridden in simulation", matched: hit.length });
  }

  return { rows, packages, installed, nested: eco.nested, nmRoot: eco.nmRoot, roots: eco.roots, asar: eco.asar, layout: eco.layout, layers: eco.layers, added, removed, removedRows, removedScopes, overridden, unknownDeps };
}

// Full simulation: baseline vs merged assessment.
export function simulateCombination(eco, ops) {
  const merged = applyOps(eco, ops || {});
  const graph = buildGraph(merged);
  const conflicts = checkConflicts(merged, { graph });
  const assessment = assess(merged, conflicts);

  const baselineGraph = buildGraph(eco);
  const baselineConflicts = checkConflicts(eco, { graph: baselineGraph });
  const baselineAssessment = assess(eco, baselineConflicts);

  const newConflicts = conflicts.conflicts.filter((c) =>
    !baselineConflicts.conflicts.some((b) => sameConflict(b, c))
  );
  const resolvedConflicts = baselineConflicts.conflicts.filter((b) =>
    !conflicts.conflicts.some((c) => sameConflict(b, c))
  );

  // Counterfactual impact: what the removed rows structurally take with them.
  // This is a static projection of an unexecuted composition, not an actual
  // runtime result — callers must keep the hypothetical label.
  const removedIds = new Set(merged.removed || []);
  const removedPlugins = baselineGraph.plugins.filter((pl) => removedIds.has(pl.id));
  const removedPkgs = [...new Set(removedPlugins.map((pl) => pl.package))];
  const kept = graph.plugins.filter((pl) => pl.disabled !== true);
  const remainingPkgs = new Set(kept.map((pl) => pl.package));
  const dependents = [];
  if (removedPkgs.length) {
    for (const pl of kept) {
      const via = (baselineGraph.trees[pl.id] || []).filter((d) => removedPkgs.includes(d));
      if (via.length) dependents.push({ id: pl.id, package: pl.package, via });
    }
  }
  const baselineProv = (baselineConflicts.services && baselineConflicts.services.provides) || {};
  const baselineCons = (baselineConflicts.services && baselineConflicts.services.consumes) || {};
  const mergedProv = (conflicts.services && conflicts.services.provides) || {};
  const stillProvided = new Set(Object.values(mergedProv).flat());
  const lostProviders = [];
  for (const pkg of removedPkgs) {
    for (const s of baselineProv[pkg] || []) if (!stillProvided.has(s)) lostProviders.push({ service: s, provider: pkg });
  }
  const brokenServices = [];
  for (const lost of lostProviders) {
    const consumers = [];
    for (const [p, list] of Object.entries(baselineCons)) {
      if (remainingPkgs.has(p) && (list || []).includes(lost.service)) consumers.push(p);
    }
    if (consumers.length) brokenServices.push({ service: lost.service, provider: lost.provider, consumers });
  }
  const disappearedSignals = removedPlugins.map((pl) => {
    const r = baselineAssessment.risk[pl.id] || { score: 0, signals: [] };
    return { id: pl.id, package: pl.package, score: r.score, signals: (r.signals || []).map((s) => s.kind) };
  });
  const impact = {
    mode: "hypothetical",
    evidenceNote: "基于静态分析的假设推演，未执行；不代表运行期结果。",
    removedPackages: removedPkgs,
    dependents,
    lostProviders,
    brokenServices,
    disappearedSignals
  };
  const riskDelta = Math.round((assessment.avgScore - baselineAssessment.avgScore) * 10) / 10;
  const RANK = { A: 4, B: 3, C: 2, D: 1 };
  const before = RANK[baselineAssessment.health] || 0;
  const after = RANK[assessment.health] || 0;
  let verdict;
  if (after < before) {
    verdict = "RISK: the simulated combination degrades overall health from " + baselineAssessment.health + " to " + assessment.health + " (avg risk " + (riskDelta > 0 ? "+" : "") + riskDelta + ").";
  } else if (after > before) {
    verdict = "OK: the simulated combination improves overall health from " + baselineAssessment.health + " to " + assessment.health + ".";
  } else {
    verdict = "NEUTRAL: overall health stays " + assessment.health + " (avg risk " + (riskDelta > 0 ? "+" : "") + riskDelta + "). Review the conflict diff below.";
  }

  return {
    mode: "hypothetical",
    impact,
    ops: {
      add: merged.added,
      remove: merged.removed,
      removeRows: merged.removedRows,
      removeScopes: merged.removedScopes,
      override: merged.overridden
    },
    unknownDeps: merged.unknownDeps,
    baseline: {
      health: baselineAssessment.health,
      avgScore: baselineAssessment.avgScore,
      conflicts: baselineConflicts.summary
    },
    merged: {
      health: assessment.health,
      avgScore: assessment.avgScore,
      conflicts: conflicts.summary,
      pluginCount: assessment.pluginCount
    },
    newConflicts: newConflicts.map((c) => ({
      type: c.type, severity: c.severity, message: c.message, impact: c.impact, advice: c.advice, confidence: c.confidence
    })),
    resolvedConflicts: resolvedConflicts.map((c) => ({
      type: c.type, severity: c.severity, message: c.message
    })),
    riskDelta,
    verdict
  };
}

function sameConflict(a, b) {
  return a.type === b.type && a.message === b.message;
}