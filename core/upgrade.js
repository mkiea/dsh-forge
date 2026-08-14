// dsh-forge/core/upgrade.js
// Check the npm registry for newer versions of composed @deepseek-ai
// packages and predict the impact of upgrading (range satisfaction).
"use strict";
import { satisfies, parseVersion, compareVersions } from "./semver.js";

const REGISTRY = "https://registry.npmjs.org/";
const TIMEOUT_MS = 6000;

async function latestVersion(pkg, registry) {
  const url = registry + encodeURIComponent(pkg).replace(/%2F/g, "/") + "/latest";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const j = await res.json();
    return j.version || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Compare installed version vs registry latest; predict what breaks among
// consumers whose declared ranges would reject the newer version.
export async function checkUpgrades(eco, opts = {}) {
  const registry = opts.registry || REGISTRY;
  const candidates = [];
  const targets = opts.packages || Object.keys(eco.packages);
  const todo = targets.filter((p) => p.startsWith("@deepseek-ai/")).slice(0, opts.limit || 40);
  for (const p of todo) {
    const manifest = eco.packages[p];
    if (!manifest) continue;
    const latest = await latestVersion(p, registry);
    if (!latest) continue;
    if (latest === manifest.version) continue;
    const lv = parseVersion(latest);
    const iv = parseVersion(manifest.version);
    if (!lv || !iv || compareVersions(lv, iv) <= 0) continue; // registry latest not actually newer
    // predict consumers: which rows' ranges would reject the latest
    const blockers = [];
    for (const row of eco.rows) {
      const m = eco.packages[row.name];
      if (!m) continue;
      const range = m.dependencies[p] || m.peerDependencies[p];
      if (range && satisfies(latest, range) === false) {
        blockers.push({ row: row.id, range });
      }
    }
    candidates.push({ package: p, installed: manifest.version, latest, blockers });
  }
  return {
    registry,
    checked: todo.length,
    candidates,
    summary: {
      upgradable: candidates.length,
      blockingUpgrades: candidates.filter((c) => c.blockers.length > 0).length
    }
  };
}
