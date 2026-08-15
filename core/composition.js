// dsh-forge/core/composition.js
// Minimal parser for the cordis.yml patch format used by this harness, plus
// ecosystem collection (composition layers + package manifests + installed
// versions). Zero external dependencies: the harness patch files use a small
// YAML subset ("- id: / name: / config: / disabled:" rows with !!js tags).
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";
import { satisfies } from "./semver.js";

// Harness home resolution: $DSH_HOME overrides the default ~/.dsh the
// harness itself falls back to (dsh-app-boot: "Harness home (~/.dsh)").
export function defaultHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

// Evaluate a !!js expression the way the loader would, but sandboxed to
// process (platform/env/cwd), a dshHomePath helper, and nothing else.
export function evalJsExpr(expr, { home, root } = {}) {
  try {
    const proc = {
      platform: process.platform,
      env: process.env,
      cwd: () => root || process.cwd()
    };
    const fn = new Function("process", "dshHomePath", '"use strict"; return (' + expr + ");");
    return fn(proc, (p) => path.join(home || defaultHome(), p));
  } catch {
    return undefined;
  }
}

// Parse the rows of one cordis patch document.
// Row keys handled: id, name, disabled (bool or !!js expr), config (presence
// and raw text). Unknown keys are preserved in raw for reporting.
export function parseCompositionText(text, layer) {
  const rows = [];
  const lines = String(text).split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = /^\s*-\s*id:\s*(\S+)\s*$/.exec(line);
    if (!m) { i++; continue; }
    const row = { id: m[1], layer, name: null, disabled: null, configPresent: false, configText: null, raw: [] };
    rows.push(row);
    const indent = line.length - line.trimStart().length;
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*$/.test(l)) { row.raw.push(l); i++; continue; }
      if (/^\s*-\s*id:/.test(l)) break; // next row
      const li = l.length - l.trimStart().length;
      if (li <= indent) break; // dedent -> outside row
      const km = /^\s*(\w[\w-]*):\s*(.*)$/.exec(l);
      if (!km) { row.raw.push(l); i++; continue; }
      const key = km[1], rest = km[2].trim();
      if (key === "name") {
        row.name = rest.replace(/^['"]|['"]$/g, "");
      } else if (key === "disabled") {
        if (rest === "true") row.disabled = true;
        else if (rest === "false") row.disabled = false;
        else if (rest.startsWith("!!js")) {
          row.disabled = evalJsExpr(rest.slice(4).trim());
        } else row.disabled = rest;
      } else if (key === "config") {
        row.configPresent = true;
        const cfgLines = [rest];
        i++;
        while (i < lines.length) {
          const cl = lines[i];
          if (/^\s*$/.test(cl)) { cfgLines.push(cl); i++; continue; }
          if (/^\s*-\s*id:/.test(cl)) break;
          const cli = cl.length - cl.trimStart().length;
          if (cli <= indent) break;
          cfgLines.push(cl);
          i++;
        }
        row.configText = cfgLines.join("\n");
        continue;
      }
      row.raw.push(l);
      i++;
    }
  }
  return rows;
}

function packageOf(name) {
  if (!name) return null;
  const parts = name.split("/");
  return parts.length >= 2 && parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Locate a package directory under a node_modules root.
function resolvePkgDir(root, name) {
  const p = packageOf(name);
  if (!p) return null;
  return path.join(root, ...p.split("/"));
}

// Discover composition sources the way the profile loader does:
// profile root cordis.yml -> bundle patches (in package.json dsh.profile.bundles
// order) -> profile cordis.patch.yml. Returns layer descriptors.
export function discoverSources({ home, profile, root } = {}) {
  const layers = [];
  const homeDir = home || defaultHome();
  const profileDir = profile ? path.join(homeDir, "profiles", profile) : null;
  const nmRoot = root || (profileDir ? path.join(profileDir, "node_modules") : null);
  let rootText = "[]";
  let bundles = [];
  let patchText = null;

  if (profileDir && fs.existsSync(path.join(profileDir, "cordis.yml"))) {
    rootText = fs.readFileSync(path.join(profileDir, "cordis.yml"), "utf8");
    const pkg = readJson(path.join(profileDir, "package.json"));
    if (pkg && pkg.dsh && pkg.dsh.profile && Array.isArray(pkg.dsh.profile.bundles)) {
      bundles = pkg.dsh.profile.bundles;
    }
    if (fs.existsSync(path.join(profileDir, "cordis.patch.yml"))) {
      patchText = fs.readFileSync(path.join(profileDir, "cordis.patch.yml"), "utf8");
    }
  }
  layers.push({ layer: "profile-root", text: rootText, kind: "root" });
  for (const b of bundles) {
    let dir = null;
    if (nmRoot) {
      const probe = path.join(nmRoot, ...b.split("/"), "package.json");
      if (fs.existsSync(probe)) dir = resolvePkgDir(nmRoot, b);
    }
    if (!dir) {
      // fallback: resolve the bundle from the profile directory. In this
      // deployment the harness install root (where dsh-base lives) is
      // reachable from there, which covers the symlinked user-plugin layout.
      try {
        const req = createRequire(path.join(profileDir, "resolve-probe.js"));
        const resolved = req.resolve(b + "/package.json");
        dir = path.dirname(resolved);
      } catch { /* bundle not resolvable from profile dir */ }
    }
    if (!dir) continue;
    const p = path.join(dir, "cordis.patch.yml");
    if (fs.existsSync(p)) {
      layers.push({ layer: b, text: fs.readFileSync(p, "utf8"), kind: "bundle", dir });
    }
  }
  if (patchText !== null) layers.push({ layer: "profile-patch", text: patchText, kind: "patch" });
  return layers;
}

// Collect package manifests for a row set. Resolution roots: explicit root,
// else the deployment root inferred from any resolved bundle dir, else the
// profile's own node_modules; the profile node_modules is always a secondary
// root so user link: packages are included.
export function collectManifests(rows, opts = {}) {
  const { home, profile, root, layers } = opts;
  const packages = {};
  const order = [];
  let nmRoot = root || null;
  if (!nmRoot && layers) {
    const bd = layers.find((l) => l.kind === "bundle" && l.dir);
    if (bd && bd.dir) {
      const idx = bd.dir.indexOf("node_modules");
      if (idx >= 0) nmRoot = bd.dir.slice(0, idx + "node_modules".length);
    }
  }
  if (!nmRoot) nmRoot = home ? path.join(home, "profiles", profile || "web", "node_modules") : null;
  const profileNm = home ? path.join(home, "profiles", profile || "web", "node_modules") : null;
  const roots = [];
  if (nmRoot) roots.push(nmRoot);
  if (profileNm && profileNm !== nmRoot && fs.existsSync(profileNm)) roots.push(profileNm);
  for (const row of rows) {
    const p = packageOf(row.name);
    if (!p || packages[p]) continue;
    let dir = null;
    for (const r of roots) {
      const probe = path.join(r, ...p.split("/"), "package.json");
      if (fs.existsSync(probe)) { dir = resolvePkgDir(r, p); break; }
    }
    const manifest = dir ? readJson(path.join(dir, "package.json")) : null;
    if (manifest) {
      packages[p] = {
        version: manifest.version,
        description: manifest.description || "",
        dependencies: manifest.dependencies || {},
        peerDependencies: manifest.peerDependencies || {},
        deprecated: manifest.deprecated || null,
        dir
      };
      order.push(p);
    }
  }
  return { packages, order, nmRoot };
}

// Merge rows across layers: later layers win per row id (last write wins).
export function mergeRows(layers) {
  const byId = new Map();
  for (const layer of layers) {
    for (const row of parseCompositionText(layer.text, layer.layer)) {
      const prev = byId.get(row.id);
      byId.set(row.id, {
        id: row.id,
        name: row.name || (prev && prev.name),
        disabled: row.disabled !== null ? row.disabled : (prev && prev.disabled),
        configPresent: row.configPresent || (prev && prev.configPresent),
        configText: row.configText || (prev && prev.configText),
        layers: [...(prev ? prev.layers : []), layer.layer]
      });
    }
  }
  return [...byId.values()];
}

// Collect the full ecosystem: layers, merged rows, package manifests and
// installed versions for every referenced dependency.
export function collectEcosystem(opts = {}) {
  const { home, profile, root, compositionFiles } = opts;
  const homeDir = home || defaultHome();
  let layers;
  if (Array.isArray(compositionFiles) && compositionFiles.length) {
    layers = compositionFiles.map((f, i) => ({
      layer: "file:" + f,
      text: fs.readFileSync(f, "utf8"),
      kind: "file"
    }));
  } else {
    layers = discoverSources({ home: homeDir, profile, root });
  }
  const rows = mergeRows(layers);
  const { packages, order, nmRoot } = collectManifests(rows, { home: homeDir, profile, root, layers });  // installed versions: top-level + per-consumer nested resolution.
  // Node semantics: a consumer's own node_modules wins, then walk up.
  const installed = {};
  const nested = {}; // dep -> { consumerPkg -> version }
  const wanted = new Set();
  for (const p of order) {
    const m = packages[p];
    for (const d of Object.keys(m.dependencies)) wanted.add(d);
    for (const d of Object.keys(m.peerDependencies)) wanted.add(d);
  }
  function versionIn(dir, d) {
    const probe = path.join(dir, "node_modules", ...d.split("/"), "package.json");
    if (fs.existsSync(probe)) {
      const m = readJson(probe);
      return m && m.version ? m.version : null;
    }
    return null;
  }
  for (const d of wanted) {
    if (packages[d]) { installed[d] = packages[d].version; continue; }
    if (nmRoot) {
      const dir = resolvePkgDir(nmRoot, d);
      if (dir) {
        const m = readJson(path.join(dir, "package.json"));
        if (m) installed[d] = m.version;
      }
    }
    const versions = new Map();
    for (const p of order) {
      const dir = packages[p].dir;
      if (!dir) continue;
      const v = versionIn(dir, d);
      if (v) versions.set(p, v);
    }
    if (versions.size) nested[d] = Object.fromEntries(versions);
  }

  // harness version: dsh package version from any resolved root (drift detection)
  let harnessVersion = null;
  for (const r of [nmRoot, homeDir ? path.join(homeDir, "profiles", profile || "web", "node_modules") : null]) {
    if (!r) continue;
    try {
      const m = readJson(path.join(r, "@deepseek-ai", "dsh", "package.json"));
      if (m && m.version) { harnessVersion = m.version; break; }
    } catch { /* skip */ }
  }
  return { layers, rows, packages, installed, nested, nmRoot, harnessVersion };
}

// Verify a range against the installed version; null when unknown.
export function rangeOk(installedVersion, range) {
  if (!installedVersion) return null;
  return satisfies(installedVersion, range);
}

// Resolve the version a given consumer package sees for a dependency
// (nested node_modules first, then top-level, then packages map).
export function resolveInstalled(eco, consumerPkg, dep) {
  const m = eco.packages && eco.packages[consumerPkg];
  if (m && m.dir) {
    const probe = path.join(m.dir, "node_modules", ...dep.split("/"), "package.json");
    if (fs.existsSync(probe)) {
      const mm = readJson(probe);
      if (mm && mm.version) return mm.version;
    }
  }
  if (eco.nested && eco.nested[dep] && eco.nested[dep][consumerPkg]) return eco.nested[dep][consumerPkg];
  if (eco.packages && eco.packages[dep]) return eco.packages[dep].version;
  if (eco.installed && eco.installed[dep]) return eco.installed[dep];
  return null;
}

export { packageOf };