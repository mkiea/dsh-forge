// dsh-forge/core/analyze.js
// Dependency-graph construction and risk scoring for a composed ecosystem.
"use strict";
import { satisfies } from "./semver.js";
import { resolveInstalled, packageOf } from "./composition.js";
import { KNOWN_LIBS, runtimeVerified } from "./knowledge.js";

const SCOPE = "@deepseek-ai/";

export function buildGraph(eco) {
  const { rows, packages, installed } = eco;
  const rowsByName = new Map();
  for (const [p] of Object.entries(packages)) rowsByName.set(p, rows.filter((r) => packageOf(r.name) === p));

  const plugins = [];
  for (const row of rows) {
    const p = packageOf(row.name);
    const manifest = packages[p];
    if (!manifest) continue;
    plugins.push({
      id: row.id,
      package: p,
      name: row.name,
      version: manifest.version,
      disabled: row.disabled,
      configPresent: row.configPresent,
      layers: row.layers,
      description: manifest.description,
      deprecated: manifest.deprecated
    });
  }
  const byId = new Map(plugins.map((pl) => [pl.id, pl]));

  // Edges: plugin package -> dependency package (plugin-to-plugin when the
  // dependency is itself a composed package, external otherwise).
  const edges = [];
  for (const pl of plugins) {
    const m = packages[pl.package];
    if (!m) continue;
    const all = { ...m.dependencies, ...m.peerDependencies };
    for (const [dep, range] of Object.entries(all)) {
      const targetManifest = packages[dep];
      const installedVersion = resolveInstalled(eco, pl.package, dep);
      const ok = installedVersion ? satisfies(installedVersion, range) : null;
      edges.push({
        from: pl.id,
        fromPackage: pl.package,
        to: dep,
        toPackage: targetManifest ? dep : null,
        range,
        kind: targetManifest ? "plugin" : "external",
        peer: dep in m.peerDependencies,
        installed: installedVersion || null,
        satisfied: ok // true / false / null(unknown)
      });
    }
  }

  // Dependency trees: plugin -> transitive plugin deps (BFS, cycle-safe).
  const adj = new Map();
  for (const e of edges) {
    if (e.kind !== "plugin") continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.toPackage);
  }
  const trees = {};
  for (const pl of plugins) {
    const seen = new Set();
    const queue = adj.get(pl.id) ? [...adj.get(pl.id)] : [];
    while (queue.length) {
      const d = queue.shift();
      if (seen.has(d)) continue;
      seen.add(d);
      const depRows = rowsByName.get(d) || [];
      for (const dr of depRows) {
        const kids = adj.get(dr.id);
        if (kids) queue.push(...kids);
      }
    }
    trees[pl.id] = [...seen];
  }

  // Shared external dependencies (referenced by >= 2 plugins).
  const shared = [];
  const byDep = new Map();
  for (const e of edges) {
    if (e.kind !== "external") continue;
    if (!byDep.has(e.to)) byDep.set(e.to, []);
    byDep.get(e.to).push(e);
  }
  for (const [dep, es] of byDep) {
    if (es.length < 2) continue;
    const ranges = new Map();
    for (const e of es) {
      const key = e.range;
      const r = ranges.get(key) || { range: key, count: 0, satisfied: e.satisfied, from: [] };
      r.count++;
      r.from.push(e.from);
      ranges.set(key, r);
    }
    shared.push({ dep, installed: installed[dep] || null, ranges: [...ranges.values()] });
  }
  shared.sort((a, b) => {
    const ca = a.ranges.reduce((s, r) => s + r.count, 0);
    const cb = b.ranges.reduce((s, r) => s + r.count, 0);
    return cb - ca;
  });

  return { plugins, edges, trees, shared, rows, packages, installed };
}

function nameParts(s) {
  let n = String(s).replace(/^@[^/]+\//, "").replace(/^dsh-/, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return n.split("-").filter(Boolean).map((w) => (/s$/.test(w) && w.length > 3 ? w.slice(0, -1) : w));
}
function tokensOf(pkgName) {
  return String(pkgName).replace(/^@[^/]+\//, "").replace(/^dsh-/, "").split("-").filter(Boolean);
}
// peer shares >= 2 domain tokens with the consumer -> alternate implementation
// of the same slot family (e.g. host-directory-picker-auto vs ...-browse)
function isVariantPeer(consumerPkg, peerPkg) {
  const a = tokensOf(consumerPkg);
  const b = tokensOf(peerPkg);
  const common = a.filter((x) => b.includes(x)).length;
  return common >= 2;
}

function inferProvider(packages, depName) {
  const GENERIC = new Set(["store", "service", "manager", "provider", "registry", "domain", "policy", "local", "file", "base", "core"]);
  const parts = nameParts(depName).filter((p) => !GENERIC.has(p));
  if (!parts.length) return null;
  for (const p of Object.keys(packages)) {
    const short = p.split("/").pop().toLowerCase().replace(/^dsh-/, "");
    const pkgParts = short.split("-").map((w) => (/s$/.test(w) && w.length > 3 ? w.slice(0, -1) : w));
    if (parts.every((part) => pkgParts.includes(part))) return p;
  }
  return null;
}

// Baseline version: modal version among @deepseek-ai/dsh-* composed packages.
export function baselineVersion(packages) {
  const counts = new Map();
  for (const [p, m] of Object.entries(packages)) {
    if (!p.startsWith(SCOPE) || p === "@deepseek-ai/dsh") continue;
    counts.set(m.version, (counts.get(m.version) || 0) + 1);
  }
  let best = null, n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return best;
}

// Risk scoring per plugin. Signals -> weights (cap 100).
export function riskScore(pl, ctx) {
  const { edges, packages, installed, conflicts, baseline } = ctx;
  let score = 0;
  const signals = [];
  const mine = edges.filter((e) => e.from === pl.id);

  for (const e of mine) {
    if (e.satisfied === false) {
      const w = e.kind === "plugin" ? 40 : 35;
      score += w;
      signals.push({
        kind: "unsatisfied-range",
        weight: w,
        detail: e.to + " " + e.range + " vs installed " + (e.installed || "?") + (e.kind === "plugin" ? " (composed plugin)" : "")
      });
    }
  }
  // unmounted service-bearing peer (name-inferred provider counts as mounted)
  for (const e of mine) {
    if (!e.peer) continue;
    if (e.toPackage) continue; // composed
    if (!e.to.startsWith(SCOPE)) continue;
    if (KNOWN_LIBS.has(e.to)) continue;
    if (inferProvider(packages, e.to)) continue; // shared base class provides it
    if (isVariantPeer(pl.package, e.to)) {
      score += 10;
      signals.push({ kind: "alternate-variant-peer", weight: 10, detail: e.to + " is an alternate implementation of the same domain; not composed here" });
      continue;
    }
    score += 25;
    signals.push({ kind: "unmounted-peer-service", weight: 25, detail: e.to + " required but never composed" });
  }
  // tool name / service collisions
  if (conflicts && Array.isArray(conflicts.conflicts)) {
    for (const c of conflicts.conflicts) {
      if (c.type === "tool-collision" && c.packages.includes(pl.package)) {
        score += 20;
        signals.push({ kind: "tool-collision", weight: 20, detail: c.detail });
      }
      if (c.type === "service-collision" && c.packages.includes(pl.package)) {
        score += 20;
        signals.push({ kind: "service-collision", weight: 20, detail: c.detail });
      }
    }
  }
  // version skew vs baseline (only for @deepseek-ai/dsh-* family)
  if (baseline && pl.package.startsWith("@deepseek-ai/dsh-") && pl.version !== baseline) {
    score += 10;
    signals.push({ kind: "version-skew", weight: 10, detail: pl.version + " vs baseline " + baseline });
  }
  if (pl.deprecated) {
    score += 5;
    signals.push({ kind: "deprecated-package", weight: 5, detail: pl.deprecated });
  }
  const capped = Math.min(100, score);
  return {
    score: capped,
    severity: capped >= 60 ? "blocking" : capped >= 40 ? "high" : capped >= 20 ? "medium" : "low",
    signals
  };
}

export function assess(eco, conflicts) {
  const graph = buildGraph(eco);
  const baseline = baselineVersion(eco.packages);
  const conflictList = conflicts ? conflicts.conflicts : [];
  const risk = {};
  for (const pl of graph.plugins) {
    if (pl.disabled === true) {
      risk[pl.id] = { score: 0, severity: "disabled", signals: [], disabled: true };
      continue;
    }
    risk[pl.id] = riskScore(pl, { edges: graph.edges, packages: eco.packages, installed: eco.installed, conflicts: { conflicts: conflictList }, baseline });
  }
  // apply runtime-verified corrections (source-level evidence)
  const verified = runtimeVerified(eco);
  for (const v of verified) {
    const r = risk[v.id];
    if (!r || r.disabled) continue;
    r.score = Math.max(0, r.score + (v.scoreDelta || 0));
    r.verifiedNotes = r.verifiedNotes || [];
    r.verifiedNotes.push({ note: v.note, confidence: v.confidence, scoreDelta: v.scoreDelta || 0 });
    r.severity = r.score >= 60 ? "blocking" : r.score >= 40 ? "high" : r.score >= 20 ? "medium" : "low";
  }
  const scored = Object.values(risk).filter((r) => !r.disabled);
  const avg = scored.length ? scored.reduce((s, r) => s + r.score, 0) / scored.length : 0;
  const max = scored.length ? Math.max(...scored.map((r) => r.score)) : 0;
  const bySeverity = { blocking: 0, high: 0, medium: 0, low: 0 };
  for (const r of scored) bySeverity[r.severity]++;
  let health;
  if (bySeverity.blocking > 0 || max >= 60) health = "D";
  else if (bySeverity.high > 0 || max >= 40) health = "C";
  else if (avg >= 15 || bySeverity.medium > 3) health = "B";
  else health = "A";
  // most fragile path: highest-scored plugin + its transitive plugin chain
  let fragile = null;
  for (const pl of graph.plugins) {
    if (pl.disabled === true) continue;
    if (!fragile || risk[pl.id].score > risk[fragile.id].score) fragile = pl;
  }
  const fragilePath = fragile ? { id: fragile.id, package: fragile.package, score: risk[fragile.id].score, chain: graph.trees[fragile.id] } : null;
  return {
    health,
    avgScore: Math.round(avg * 10) / 10,
    maxScore: max,
    bySeverity,
    risk,
    fragilePath,
    pluginCount: graph.plugins.length,
    activeCount: graph.plugins.filter((p) => p.disabled !== true).length,
    disabledCount: graph.plugins.filter((p) => p.disabled === true).length,
    edgeCount: graph.edges.length
  };
}