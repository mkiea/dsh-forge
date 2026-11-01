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
import * as vm from "node:vm";
import { satisfies } from "./semver.js";
import { findDesktopAsar, isDesktopProfile, readAsarManifest, readAsarJson, readAsarText } from "./asar.js";

// Harness home resolution: $DSH_HOME overrides the default ~/.dsh the
// harness itself falls back to (dsh-app-boot: "Harness home (~/.dsh)").
export function defaultHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

// Evaluate a !!js expression the way the loader would, but sandboxed to
// process (platform/env/cwd), a dshHomePath helper, and nothing else.
export function evalJsExpr(expr, { home, root, strict = false, timeoutMs = 1000 } = {}) {
  try {
    // A-7 vm hardening (approximate, honest): null-prototype global (prototype
    // isolation), frozen process projection, frozen helper surface, and a
    // configurable run timeout (native). Memory limiting is NOT a node:vm
    // native capability and is only approximated at shell boundaries; this
    // hardening targets trusted-config scenarios, never untrusted input.
    const sandbox = Object.assign(Object.create(null), {
      process: Object.freeze({
        platform: process.platform,
        env: Object.freeze({ ...process.env }),
        cwd: () => root || process.cwd()
      }),
      dshHomePath: (p) => path.join(home || defaultHome(), p)
    });
    const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    return vm.runInNewContext("(" + String(expr) + ")", context, { timeout: timeoutMs, displayErrors: false });
  } catch {
    if (strict) throw new Error("!!js expression failed: " + String(expr).trim());
      return undefined; // non-strict legacy behavior: treat as unset instead of surfacing user JS errors
  }
}

// A `!!js` value may be a YAML block scalar (`>-` / `|-`): the expression
// lives on the following indented lines. Folded scalars join with spaces.
function readJsBlockScalar(lines, start, keyIndent, fold) {
  let i = start;
  let contentIndent = null;
  const parts = [];
  while (i < lines.length) {
    const raw = lines[i];
    if (/^\s*$/.test(raw)) { parts.push(""); i++; continue; }
    const ind = raw.length - raw.trimStart().length;
    if (contentIndent === null) {
      if (ind <= keyIndent) break;
      contentIndent = ind;
    }
    if (ind < contentIndent) break;
    parts.push(raw.slice(contentIndent));
    i++;
  }
  return { expr: parts.join(fold ? " " : "\n").trim(), next: i };
}

function isBlockScalarToken(s) {
  return /^[>|][+-]?$/.test(s);
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
          let expr = rest.slice(4).trim();
          let consumed = null;
          if (isBlockScalarToken(expr)) {
            const block = readJsBlockScalar(lines, i + 1, (l.length - l.trimStart().length), expr.startsWith(">"));
            expr = block.expr;
            consumed = block.next;
          }
          row.disabledExpr = expr;
          // Expressions may depend on loader/entry context, so a static scan
          // records the expression and only applies an evaluable boolean.
          const v = evalJsExpr(expr);
          row.disabled = typeof v === "boolean" ? v : null;
          if (consumed !== null) { i = consumed; continue; }
        } else row.disabled = rest;
      } else if (key === "config") {
        row.configPresent = true;
        const cfgLines = [rest];
        i++;
        while (i < lines.length) {
          const cl = lines[i];
          const clTrim = cl.trim();
          // Blank lines and comments do not end a YAML block: hand-written
          // configs interleave zero-indent comments between keys. Only a real
          // dedented key or the next row starts a new entry.
          if (!clTrim || clTrim.startsWith("#")) { cfgLines.push(cl); i++; continue; }
          // Config may legitimately contain lists of `- id: ...` maps (local
          // model / preset definitions), which must stay inside the config
          // text instead of being parsed as composition rows.
          const cli = cl.length - cl.trimStart().length;
          if (cli <= li) break;
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

// Strip a trailing inline comment ('#' outside quotes) from a scalar value.
// A '#' starts a comment only at the value start or after whitespace; '#' inside
// single/double quotes is kept verbatim.
function stripInlineComment(s) {
  let inSingle = false, inDouble = false, out = "";
  for (let n = 0; n < s.length; n++) {
    const c = s[n];
    if (c === "'" && !inSingle) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble && (n === 0 || /\s/.test(s[n - 1]))) {
      return out.trimEnd();
    }
    out += c;
  }
  return s;
}

// Strict parser: the same supported subset as parseCompositionText, but any
// construct outside that subset fails loudly with a layer + line number
// instead of being silently ignored (P0 fail-loud requirement).
export function parseCompositionTextStrict(text, layer, opts = {}) {
  const lines = String(text).split(/\r?\n/);
  const rows = [];
  const fail = (lineNo, msg) => {
    const err = new Error("unsupported YAML syntax in " + layer + " line " + lineNo + ": " + msg);
    err.code = "FORGE-YAML-STRICT";
    throw err;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed === "---" || trimmed === "...") { i++; continue; }
    if (/^\[\s*\]\s*$/.test(trimmed)) { i++; continue; } // empty composition root
    const rowStart = /^\s*-\s*id:\s*(\S+)\s*$/.exec(line);
    if (!rowStart) {
      if (!/^\s*-\s*insert:\s*$/.test(trimmed)) fail(i + 1, "unsupported top-level entry: " + trimmed);
      i++;
      continue;
    }
    const row = { id: rowStart[1], layer, name: null, disabled: null, configPresent: false, configText: null, raw: [] };
    rows.push(row);
    const indent = line.length - line.trimStart().length;
    i++;
    while (i < lines.length) {
      const l = lines[i];
      const t = l.trim();
      if (!t || t.startsWith("#")) { row.raw.push(l); i++; continue; }
      if (/^\s*-\s*id:/.test(l)) break; // next row
      const li = l.length - l.trimStart().length;
      if (li <= indent) break; // dedent -> outside row
      const km = /^\s*(\w[\w-]*):\s*(.*)$/.exec(l);
      if (!km) fail(i + 1, "unsupported indented line: " + t);
      const key = km[1], rawRest = km[2].trim();
      // Scalars may carry an inline comment ('#' outside quotes); strip it before
      // validating. Config blocks keep rawRest verbatim below.
      const rest = stripInlineComment(rawRest);
      if (key === "name") {
        if (!rest) fail(i + 1, "name must not be empty");
        if (/^[|>]/.test(rest) || /(?:^|\s)[&*][A-Za-z_]/.test(rest)) fail(i + 1, "unsupported YAML construct in name: " + t);
        row.name = rest.replace(/^['"]|['"]$/g, "");
      } else if (key === "disabled") {
        if (rest === "true") row.disabled = true;
        else if (rest === "false") row.disabled = false;
        else if (rest.startsWith("!!js")) {
          let expr = rest.slice(4).trim();
          let consumed = null;
          if (isBlockScalarToken(expr)) {
            const block = readJsBlockScalar(lines, i + 1, li, expr.startsWith(">"));
            expr = block.expr;
            consumed = block.next;
          }
          row.disabledExpr = expr;
          // Loader-context expressions are valid YAML but not statically
          // evaluable; record them instead of failing the whole scan.
          const v = evalJsExpr(expr, { home: opts.home, root: opts.root });
          row.disabled = typeof v === "boolean" ? v : null;
          if (consumed !== null) { i = consumed; continue; }
        } else {
          fail(i + 1, "unsupported disabled value: " + t);
        }
      } else if (key === "config") {
        // config blocks are preserved verbatim (including block scalars and !!js values)
        row.configPresent = true;
        const cfgLines = [rawRest];
        i++;
        while (i < lines.length) {
          const cl = lines[i];
          const clTrim = cl.trim();
          // Blank lines and comments do not end a YAML block: hand-written
          // configs interleave zero-indent comments between keys. Only a real
          // dedented key or the next row starts a new entry.
          if (!clTrim || clTrim.startsWith("#")) { cfgLines.push(cl); i++; continue; }
          // Config may legitimately contain lists of `- id: ...` maps (local
          // model / preset definitions), which must stay inside the config
          // text instead of being parsed as composition rows.
          const cli = cl.length - cl.trimStart().length;
          if (cli <= li) break;
          cfgLines.push(cl);
          i++;
        }
        row.configText = cfgLines.join("\n");
        continue;
      } else if (key === "inject") {
        // cordis bundle structural key: declares injected sub-plugins. The
        // nested '- id:' entries sit at a deeper indent and parse as their
        // own rows via the row-boundary break above.
        row.inject = true;
      } else if (key === "group") {
        // cordis:group structural flag (desktop harness >= 0.2.1 presets).
        if (rest === "true") row.group = true;
        else if (rest === "false") row.group = false;
        else fail(i + 1, "unsupported group value: " + t);
      } else if (key === "isolate") {
        // group isolation flags (planMode:, compaction:, workflowEngine: ...).
        // The nested mapping is structural, not a row key: skip it so its
        // children are not mistaken for composition keys.
        row.isolate = true;
        if (!rest) {
          const keyIndent = li;
          i++;
          while (i < lines.length) {
            const il = lines[i];
            if (/^\s*$/.test(il)) { row.raw.push(il); i++; continue; }
            if (/^\s*-\s*id:/.test(il)) break;
            const ili = il.length - il.trimStart().length;
            if (ili <= keyIndent) break; // sibling key of the same row (config:, ...)
            row.raw.push(il);
            i++;
          }
        }
        continue;
      } else {
        fail(i + 1, "unsupported row key: " + key);
      }
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

// Patch files a bundle declares (dsh.bundle.patch: string | string[]), with the
// conventional ./cordis.patch.yml fallback.
function bundlePatchPaths(manifest) {
  const patch = manifest && manifest.dsh && manifest.dsh.bundle && manifest.dsh.bundle.patch;
  const list = Array.isArray(patch) ? patch : (patch ? [patch] : ["./cordis.patch.yml"]);
  return list.map((p) => String(p).replace(/^\.\//, ""));
}

// Discover composition sources the way the profile loader does:
// profile root cordis.yml -> bundle patches (in package.json dsh.profile.bundles
// order) -> profile cordis.patch.yml. Returns layer descriptors.
export function discoverSources({ home, profile, root, asar } = {}) {
  const layers = [];
  const missingBundles = [];
  const homeDir = home || defaultHome();
  const profileDir = profile ? path.join(homeDir, "profiles", profile) : null;
  const nmRoot = root || (profileDir ? path.join(profileDir, "node_modules") : null);
  // Desktop app: bundle patches live inside resources/app.asar, not on disk.
  const desktopAsar = asar || (isDesktopProfile(profile) ? findDesktopAsar() : null);
  let rootText = "[]";
  let bundles = [];
  let patchText = null;
  let declared = {};

  if (profileDir && fs.existsSync(path.join(profileDir, "cordis.yml"))) {
    rootText = fs.readFileSync(path.join(profileDir, "cordis.yml"), "utf8");
    const pkg = readJson(path.join(profileDir, "package.json"));
    if (pkg && pkg.dsh && pkg.dsh.profile && Array.isArray(pkg.dsh.profile.bundles)) {
      bundles = pkg.dsh.profile.bundles;
    }
    if (pkg && pkg.dependencies && typeof pkg.dependencies === "object") declared = { ...pkg.dependencies };
    if (fs.existsSync(path.join(profileDir, "cordis.patch.yml"))) {
      patchText = fs.readFileSync(path.join(profileDir, "cordis.patch.yml"), "utf8");
    }
  }
  layers.push({ layer: "profile-root", text: rootText, kind: "root", path: profileDir ? path.join(profileDir, "cordis.yml") : null });
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
      } catch (e) { /* bundle not resolvable from profile dir */ }
    }
    if (!dir) {
      // Desktop bundle: read its patch files from the app archive.
      if (desktopAsar) {
        const am = readAsarManifest(desktopAsar, b);
        if (am) {
          const rels = bundlePatchPaths(am.manifest);
          for (const rel of rels) {
            const text = readAsarText(desktopAsar, am.entry + "/" + rel);
            if (text == null) continue;
            layers.push({
              layer: rels.length > 1 ? b + ":" + path.basename(rel) : b,
              text,
              kind: "bundle",
              dir: null,
              asar: { path: desktopAsar, entry: am.entry, package: b },
              path: desktopAsar
            });
          }
          continue;
        }
      }
      // The profile declares this bundle but its deployment is not reachable
      // from here (harness installed elsewhere, or not installed at all). The
      // row set is then partial; report it instead of pretending the profile
      // only has its own patch rows.
      missingBundles.push(b);
      continue;
    }
    const p = path.join(dir, "cordis.patch.yml");
    if (fs.existsSync(p)) {
      layers.push({ layer: b, text: fs.readFileSync(p, "utf8"), kind: "bundle", dir, path: p });
    }
  }
  if (patchText !== null) layers.push({ layer: "profile-patch", text: patchText, kind: "patch", path: profileDir ? path.join(profileDir, "cordis.patch.yml") : null });
  layers.missingBundles = missingBundles;
  layers.declared = declared;
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
  // Desktop app: harness packages live inside resources/app.asar, which the
  // CLI cannot dump. Read manifests straight from the archive as a fallback
  // when no on-disk copy exists.
  const asar = opts.asar || (isDesktopProfile(profile) ? findDesktopAsar() : null);
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
  // harness 0.1.7+ installs its plugin packages INSIDE the dsh package
  // (<nm>/@deepseek-ai/dsh/node_modules/@deepseek-ai/*). Probe that vendored
  // root too, otherwise only the profile's own link: packages are collected
  // and every harness row resolves as "missing manifest".
  for (const r of roots.slice()) {
    const vendored = path.join(r, "@deepseek-ai", "dsh", "node_modules");
    if (vendored !== r && fs.existsSync(path.join(vendored, "@deepseek-ai", "dsh-base", "package.json")) && !roots.includes(vendored)) {
      roots.push(vendored);
    }
  }
  for (const row of rows) {
    const p = packageOf(row.name);
    if (!p || packages[p]) continue;
    // Desktop: the app archive is the authoritative deployment for harness
    // packages. On-disk copies from other installs (e.g. the CLI's ~/.dsh
    // node_modules) must not shadow the versions the desktop actually loads.
    if (asar) {
      const am = readAsarManifest(asar, p);
      if (am) {
        packages[p] = {
          version: am.manifest.version,
          description: am.manifest.description || "",
          dependencies: am.manifest.dependencies || {},
          peerDependencies: am.manifest.peerDependencies || {},
          deprecated: am.manifest.deprecated || null,
          dir: null,
          asar: { path: asar, entry: am.entry, package: p }
        };
        order.push(p);
        continue;
      }
    }
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
  return { packages, order, nmRoot, roots, asar };
}

// Merge rows across layers: later layers win per row id (last write wins).
export function mergeRows(layers, opts = {}) {
  const byId = new Map();
  for (const layer of layers) {
    for (const row of parseCompositionTextStrict(layer.text, layer.layer, opts)) {
      const prev = byId.get(row.id);
      byId.set(row.id, {
        id: row.id,
        name: row.name || (prev && prev.name),
        disabled: row.disabled !== null ? row.disabled : (prev && prev.disabled),
        disabledExpr: row.disabledExpr || (prev && prev.disabledExpr) || null,
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
    layers = discoverSources({ home: homeDir, profile, root, asar: opts.asar });
  }
  const rows = mergeRows(layers, { home: homeDir, root, strict: opts.strict !== false });
  const { packages, order, nmRoot, roots, asar } = collectManifests(rows, { home: homeDir, profile, root, layers, asar: opts.asar });  // installed versions: top-level + per-consumer nested resolution.
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
    // desktop: the app archive wins over unrelated on-disk installs
    if (asar) {
      const am = readAsarManifest(asar, d);
      if (am && am.manifest.version) installed[d] = am.manifest.version;
    }
    if (installed[d]) continue;
    for (const r of roots) {
      const dir = resolvePkgDir(r, d);
      if (!dir) continue;
      const m = readJson(path.join(dir, "package.json"));
      if (m) { installed[d] = m.version; break; }
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

  // harness version: the desktop archive is authoritative; otherwise the dsh
  // package version from any resolved root (drift detection). In the 0.1.7
  // vendored layout nmRoot IS the dsh package's node_modules, so also check its
  // parent(s) for the dsh manifest itself.
  let harnessVersion = null;
  if (asar) {
    const dsh = readAsarJson(asar, "dsh/package.json");
    if (dsh && dsh.version) harnessVersion = dsh.version;
  }
  const harnessRoots = [];
  if (nmRoot) harnessRoots.push(nmRoot, path.resolve(nmRoot, ".."), path.resolve(nmRoot, "..", ".."));
  if (homeDir) harnessRoots.push(path.join(homeDir, "profiles", profile || "web", "node_modules"));
  for (const r of harnessRoots) {
    if (harnessVersion) break;
    const nested = readJson(path.join(r, "@deepseek-ai", "dsh", "package.json"));
    if (nested && nested.version) { harnessVersion = nested.version; break; }
    const self = readJson(path.join(r, "package.json"));
    if (self && self.name === "@deepseek-ai/dsh" && self.version) { harnessVersion = self.version; break; }
  }
  return { layers, missingBundles: Array.isArray(layers.missingBundles) ? layers.missingBundles : [], declared: layers.declared || {}, rows, packages, installed, nested, nmRoot, roots, harnessVersion, asar, layout: asar ? "desktop-asar" : "node_modules", truthSource: layers.some((l) => l.kind === "dump") ? "dump-config" : "scan" };
}

// Verify a range against the installed version; null when unknown.
export function rangeOk(installedVersion, range) {
  if (!installedVersion) return null;
  return satisfies(installedVersion, range);
}

// Resolve the version a given consumer package sees for a dependency. Node's
// own lookup walks `<ancestor>/node_modules` from the consumer upwards, so a
// vendored consumer (under <nm>/@deepseek-ai/dsh/node_modules) sees the
// vendored copy first, not a different version hoisted into the profile.
export function resolveInstalled(eco, consumerPkg, dep) {
  const m = eco.packages && eco.packages[consumerPkg];
  // 1) On-disk consumer: Node resolves its own (possibly nested) copy first.
  // A web plugin may vendor @deepseek-ai/* versions that differ from the
  // desktop runtime; that local copy is what the plugin actually loads.
  if (m && m.dir) {
    let dir = m.dir;
    for (let depth = 0; depth < 8 && dir; depth++) {
      const probe = path.join(dir, "node_modules", ...dep.split("/"), "package.json");
      if (fs.existsSync(probe)) {
        const mm = readJson(probe);
        if (mm && mm.version) return mm.version;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  // 2) Archive-deployed consumer: walk its nested node_modules inside the
  // archive (e.g. dsh-host-webserver's own negotiator), then fall back to the
  // archive's top-level copy for harness packages.
  if (m && m.asar && m.asar.entry) {
    let rel = m.asar.entry;
    for (let depth = 0; depth < 10 && rel; depth++) {
      const probe = rel + "/node_modules/" + dep + "/package.json";
      const mm = readAsarJson(m.asar.path, probe);
      if (mm && mm.version) return mm.version;
      const parent = rel.replace(/\/[^/]+$/, "");
      if (!parent || parent === rel) break;
      rel = parent;
    }
  }
  if (eco.asar && dep.startsWith("@deepseek-ai/")) {
    const am = readAsarManifest(eco.asar, dep);
    if (am && am.manifest.version) return am.manifest.version;
  }
  if (eco.nested && eco.nested[dep] && eco.nested[dep][consumerPkg]) return eco.nested[dep][consumerPkg];
  if (eco.packages && eco.packages[dep]) return eco.packages[dep].version;
  if (eco.installed && eco.installed[dep]) return eco.installed[dep];
  return null;
}

export { packageOf };