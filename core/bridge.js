// dsh-forge/core/bridge.js
// Web ↔ desktop connector: one forge engine exposes both surfaces. The web
// profile is what `dsh web` (and the CLI) mounts; the desktop profile is the
// Electron app's resources/app.asar. This module discovers the profiles that
// exist on this machine, collects each composition with the same engine, and
// reports cross-profile drift (only-web / only-desktop packages, version
// mismatches, harness skew) so the dashboard can act as the single bridge.
//
// Zero dependencies; every filesystem probe is best-effort. A profile that
// cannot be collected is reported with an `error` instead of failing the whole
// bridge, because a half-installed profile is exactly when the bridge matters.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { defaultHome, collectEcosystem } from "./composition.js";
import { findDesktopAsar, isDesktopProfile } from "./asar.js";

export const DEFAULT_BRIDGE_PROFILES = ["web", "desktop"];

// Profiles installed under <home>/profiles. Desktop is always advertised when
// the app archive is present, because it has no profile directory of its own.
export function discoverProfiles(opts = {}) {
  const home = opts.home || defaultHome();
  const found = [];
  const dir = home ? path.join(home, "profiles") : null;
  if (dir) {
    try {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        let isDir = false;
        try { isDir = fs.statSync(p).isDirectory(); } catch { isDir = false; }
        if (!isDir) continue;
        found.push({
          name,
          dir: p,
          composition: fs.existsSync(path.join(p, "cordis.yml")),
          desktop: isDesktopProfile(name)
        });
      }
    } catch { /* no profiles directory: still report desktop below */ }
  }
  const asar = opts.asar || findDesktopAsar();
  if (asar && !found.some((p) => p.desktop)) {
    found.push({ name: "desktop", dir: null, composition: true, desktop: true, asar });
  }
  found.sort((a, b) => (a.desktop === b.desktop ? a.name.localeCompare(b.name) : a.desktop ? 1 : -1));
  return found;
}

// One profile -> compact comparable summary. Never throws.
export function profileSummary(name, eco) {
  const packages = {};
  for (const [pkg, m] of Object.entries((eco && eco.packages) || {})) {
    if (m && m.version) packages[pkg] = m.version;
  }
  return {
    name,
    packages,
    declared: (eco && eco.declared) || {},
    rows: Array.isArray(eco && eco.rows) ? eco.rows.length : 0,
    packageCount: Object.keys(packages).length,
    harnessVersion: (eco && eco.harnessVersion) || null,
    layout: (eco && eco.layout) || "node_modules",
    truthSource: (eco && eco.truthSource) || "scan",
    collectedAt: (eco && eco.collectedAt) || null,
    snapshot: !!(eco && eco.snapshot),
    missingBundles: Array.isArray(eco && eco.missingBundles) ? eco.missingBundles : [],
    asar: (eco && eco.asar) || null
  };
}

// Collect selected profiles, tolerating failures per profile. `ecosystems`
// lets the caller supply an already-collected ecosystem (the running analysis
// uses dump-config ground truth for the web profile) instead of a fresh static
// scan, so both sides of the bridge report the same caliber.
export function collectUniverse(opts = {}) {
  const home = opts.home || defaultHome();
  const wanted = [...new Set(
    Array.isArray(opts.profiles) && opts.profiles.length ? opts.profiles : DEFAULT_BRIDGE_PROFILES
  )];
  const discovered = discoverProfiles({ home, asar: opts.asar });
  const supplied = opts.ecosystems || {};
  const out = [];
  for (const name of wanted) {
    const meta = discovered.find((p) => p.name === name) || { name, desktop: isDesktopProfile(name) };
    try {
      const eco = supplied[name] || collectEcosystem({ home, profile: name, root: opts.root, asar: opts.asar });
      const s = profileSummary(name, eco);
      s.desktop = !!meta.desktop;
      out.push(s);
    } catch (e) {
      out.push({
        name,
        desktop: !!meta.desktop,
        packages: {},
        rows: 0,
        packageCount: 0,
        harnessVersion: null,
        layout: meta.desktop ? "desktop-asar" : "node_modules",
        truthSource: "scan",
        collectedAt: null,
        missingBundles: [],
        error: String((e && e.message) || e)
      });
    }
  }
  return out;
}

// Pairwise comparison (pure). `left`/`right` are profileSummary objects.
export function compareProfiles(left, right) {
  const lp = (left && left.packages) || {};
  const rp = (right && right.packages) || {};
  const shared = [];
  const onlyLeft = [];
  const onlyRight = [];
  let matched = 0;
  for (const pkg of Object.keys(lp)) {
    if (!(pkg in rp)) { onlyLeft.push(pkg); continue; }
    matched++;
    if (lp[pkg] !== rp[pkg]) shared.push({ package: pkg, left: lp[pkg], right: rp[pkg] });
  }
  for (const pkg of Object.keys(rp)) if (!(pkg in lp)) onlyRight.push(pkg);
  const union = Object.keys(lp).length + onlyRight.length;
  const harnessDrift = !!(left && right && left.harnessVersion && right.harnessVersion
    && left.harnessVersion !== right.harnessVersion);
  const rows = {
    left: (left && left.rows) || 0,
    right: (right && right.rows) || 0,
    delta: ((left && left.rows) || 0) - ((right && right.rows) || 0)
  };
  const verdict = !onlyLeft.length && !onlyRight.length && !shared.length && !harnessDrift
    ? "identical"
    : (onlyLeft.length || onlyRight.length) ? "divergent" : "drift";
  // A profile whose declared bundles could not be resolved (harness installed
  // elsewhere) has a partial row set; a low similarity is then an artifact of
  // reachability, not of the editions themselves. Say so instead of letting the
  // verdict imply the surfaces really differ that much.
  const missing = {
    left: (left && left.missingBundles) || [],
    right: (right && right.missingBundles) || []
  };
  return {
    left: left ? left.name : null,
    right: right ? right.name : null,
    shared: shared.sort((a, b) => a.package.localeCompare(b.package)),
    onlyLeft: onlyLeft.sort(),
    onlyRight: onlyRight.sort(),
    matched,
    union,
    similarity: union ? Math.round((matched / union) * 100) : 100,
    complete: !missing.left.length && !missing.right.length,
    missing,
    rows,
    harness: {
      left: (left && left.harnessVersion) || null,
      right: (right && right.harnessVersion) || null,
      drift: harnessDrift
    },
    verdict
  };
}

// Full bridge payload: profiles + every pairwise comparison.
export function buildBridge(opts = {}) {
  const home = opts.home || defaultHome();
  const profiles = collectUniverse({ home, profiles: opts.profiles, asar: opts.asar, root: opts.root, ecosystems: opts.ecosystems });
  const pairs = [];
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      pairs.push(compareProfiles(profiles[i], profiles[j]));
    }
  }
  let asar = opts.asar || null;
  if (!asar) {
    try { asar = findDesktopAsar(); } catch { asar = null; }
  }
  return {
    generatedAt: new Date().toISOString(),
    home: home || null,
    desktop: { available: !!asar, asar: asar || null },
    profiles,
    pairs
  };
}
