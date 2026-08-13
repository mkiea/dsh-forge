// dsh-forge/core/simulate.js
// Hypothetical combination simulation: apply add/remove/override ops to a
// composition, re-run analysis, and diff against the baseline.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { packageOf } from "./composition.js";
import { buildGraph, assess } from "./analyze.js";
import { checkConflicts } from "./conflicts.js";

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

// Merge ops into a cloned ecosystem.
export function applyOps(eco, ops) {
  const rows = eco.rows.map((r) => ({ ...r, layers: [...r.layers] }));
  const packages = { ...eco.packages };
  const installed = { ...eco.installed };
  const added = [];
  const removed = [];
  const overridden = [];
  const unknownDeps = [];

  const addList = ops.add || [];
  for (const a of addList) {
    const p = a.package || (a.name ? packageOf(a.name) : null);
    if (!p) { unknownDeps.push("add op without package: " + JSON.stringify(a)); continue; }
    const id = a.id || p.split("/").pop();
    const existing = rows.find((r) => r.id === id);
    if (existing && existing.name === p) {
      overridden.push({ id, note: "already composed as " + p });
      continue;
    }
    if (!packages[p]) {
      // try to resolve from the deployment node_modules
      let manifest = null;
      if (eco.nmRoot) {
        const dir = path.join(eco.nmRoot, ...p.split("/"));
        if (fs.existsSync(path.join(dir, "package.json"))) manifest = readManifest(dir);
      }
      if (manifest) {
        packages[p] = {
          version: manifest.version,
          description: manifest.description || "",
          dependencies: manifest.dependencies || {},
          peerDependencies: manifest.peerDependencies || {},
          deprecated: manifest.deprecated || null,
          dir: eco.nmRoot ? path.join(eco.nmRoot, ...p.split("/")) : null
        };
        installed[p] = manifest.version;
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
        if (!installed[d] && eco.nmRoot) {
          const dir = path.join(eco.nmRoot, ...d.split("/"));
          const m = readManifest(path.join(dir, "package.json"));
          if (m) installed[d] = m.version;
        }
      }
    }
    const prev = rows.find((r) => r.id === id);
    if (prev) {
      overridden.push({ id, note: "row id reused: " + prev.name + " -> " + p });
      prev.name = p;
      prev.layers = [...prev.layers, "simulate"];
    } else {
      rows.push({
        id,
        name: p,
        disabled: false,
        configPresent: !!(a.configText || a.configNote),
        configText: a.configText || null,
        layers: ["simulate"]
      });
    }
    added.push({ id, package: p, version: packages[p].version, synthetic: !!packages[p].synthetic });
  }

  for (const id of ops.remove || []) {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx >= 0) {
      rows.splice(idx, 1);
      removed.push(id);
    }
  }

  for (const o of ops.override || []) {
    const row = rows.find((r) => r.id === o.id);
    if (row) {
      if (o.package) row.name = o.package;
      if (o.configText !== undefined) {
        row.configText = o.configText;
        row.configPresent = o.configText.trim().length > 0;
      }
      row.layers = [...row.layers, "simulate"];
      overridden.push({ id: o.id, note: "config overridden in simulation" });
    }
  }

  return { rows, packages, installed, nested: eco.nested, nmRoot: eco.nmRoot, layers: eco.layers, added, removed, overridden, unknownDeps };
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
    ops: { add: merged.added, remove: merged.removed, override: merged.overridden },
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