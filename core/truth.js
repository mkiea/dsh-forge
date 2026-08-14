// dsh-forge/core/truth.js
// R0 ground truth: consume the harness's own --dump-config resolved tree as
// the authoritative composition (the exact rows the harness would mount),
// instead of reconstructing it from source scans.
// The dump does NOT evaluate !!js expressions; the scan path does. When both
// are available they complement each other: dump = composed rows + provenance,
// scan = evaluated platform switches + manifests.
"use strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const HEADER_RE = /^# == (.+)$/;

// Locate the dsh CLI binary the way the deployment itself would.
export function findDshBin(profile) {
  const candidates = [];
  if (process.env.DSH_BIN) candidates.push(process.env.DSH_BIN);
  const home = process.env.DSH_HOME || "";
  // resolve from the profile directory: the harness install root is reliably
  // reachable from there (verified across environments)
  const profileDir = home ? path.join(home, "profiles", profile || "web") : null;
  if (profileDir) {
    try {
      const req = createRequire(path.join(profileDir, "resolve-probe.js"));
      const p = req.resolve("@deepseek-ai/dsh/package.json");
      const idx = p.indexOf("node_modules");
      if (idx >= 0) candidates.push(path.join(p.slice(0, idx + "node_modules".length), "@deepseek-ai", "dsh", "lib", "bin.js"));
    } catch { /* profile dir cannot reach the deployment root */ }
  }
  if (home) candidates.push(path.join(home, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"));
  // walk up from cwd looking for a deployment install
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const probe = path.join(dir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
    if (fs.existsSync(probe)) candidates.push(probe);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

// Run: dsh --profile <name> --dump-config; returns {ok, stdout, stderr, error}
export function runDumpConfig(profile, opts = {}) {
  const bin = opts.bin || findDshBin(profile);
  if (!bin) return { ok: false, error: "dsh bin not found" };
  return new Promise((resolve) => {
    execFile(process.execPath, [bin, "--profile", profile || "web", "--dump-config"], {
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env, DSH_HOME: opts.home || process.env.DSH_HOME },
      timeout: opts.timeoutMs || 20000,
      windowsHide: true
    }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, error: String(err.message || err).split("\n")[0], stderr: stderr || "" });
      else resolve({ ok: true, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

// Parse the dump: rows with provenance (origin layer + patched-by layers).
// The dump groups rows under "# == <origin>[, patched by <layer>...]" comments;
// row text is plain YAML lines we already know how to parse.
export function parseDumpConfig(dumpText) {
  const lines = String(dumpText).split(/\r?\n/);
  const groups = [];
  let current = null;
  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    if (m) {
      const label = m[1];
      const patchedBy = [];
      let origin = label;
      const pb = label.match(/, patched by (.+)$/);
      if (pb) {
        origin = label.slice(0, label.length - pb[0].length);
        patchedBy.push(...pb[1].split(",").map((s) => s.trim()));
      }
      current = { origin, patchedBy, body: [] };
      groups.push(current);
      continue;
    }
    if (current) current.body.push(line);
  }
  // split each group body into row blocks at "- id:" boundaries
  const rows = [];
  const layerOrder = [];
  for (const g of groups) {
    const blocks = [];
    let cur = null;
    for (const line of g.body) {
      if (/^\s*-\s*id:/.test(line)) {
        cur = [line];
        blocks.push(cur);
      } else if (cur && line.trim() !== "") {
        cur.push(line);
      }
    }
    if (!blocks.length) continue;
    if (!layerOrder.includes(g.origin)) layerOrder.push(g.origin);
    for (const block of blocks) {
      const r = parseRowBlock(block.join("\n"), g.origin);
      r.origin = g.origin;
      r.patchedBy = g.patchedBy;
      rows.push(r);
    }
  }
  return { rows, layers: layerOrder };
}

// parse one row block: - id / name / config / disabled
function parseRowBlock(text, layer) {
  const idM = /-\s*id:\s*(\S+)/.exec(text);
  const nameM = /name:\s*['"]([^'"]+)['"]/.exec(text) || /name:\s*(\S+)/.exec(text);
  const disabledM = /disabled:\s*(true|false)/.exec(text);
  const configPresent = /^\s*config:\s*[\s\S]/m.test(text) && /config:/.test(text);
  return {
    id: idM ? idM[1] : null,
    name: nameM ? (nameM[1] || nameM[2]) : null,
    disabled: disabledM ? disabledM[1] === "true" : null,
    configPresent,
    configText: configPresent ? text : null,
    layer
  };
}

// Full ecosystem from the dump-config ground truth: rows with provenance +
// manifests (same collection as the scan path).
export async function loadTruthEcosystem(opts = {}) {
  const { home, profile } = opts;
  const res = await runDumpConfig(profile || "web", { home });
  if (!res.ok) return { ok: false, error: res.error || "dump-config failed" };
  const parsed = parseDumpConfig(res.stdout);
  const { collectManifests } = await import("./composition.js");
  // deployment root from the located dsh bin: <root>/node_modules/@deepseek-ai/dsh/lib/bin.js
  const bin = opts.bin || findDshBin(profile || "web");
  let truthRoot = null;
  if (bin) {
    const idx = bin.indexOf("node_modules");
    if (idx >= 0) truthRoot = bin.slice(0, idx + "node_modules".length);
  }
  const { packages, order, nmRoot } = collectManifests(parsed.rows, { home, profile: profile || "web", root: truthRoot, layers: [] });
  const installed = {};
  const wanted = new Set();
  for (const p of order) {
    const m = packages[p];
    if (!m) continue;
    for (const d of Object.keys(m.dependencies)) wanted.add(d);
    for (const d of Object.keys(m.peerDependencies)) wanted.add(d);
  }
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
  for (const d of wanted) {
    if (packages[d]) { installed[d] = packages[d].version; continue; }
    if (nmRoot) {
      const probe = path.join(nmRoot, ...d.split("/"), "package.json");
      const m = readJson(probe);
      if (m) { installed[d] = m.version; }
    }
  }
  for (const r of parsed.rows) {
    r.layers = [r.origin].concat(r.patchedBy || []);
  }
  let harnessVersion = null;
  if (truthRoot) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(truthRoot, "@deepseek-ai", "dsh", "package.json"), "utf8"));
      harnessVersion = m.version || null;
    } catch { /* skip */ }
  }
  const eco = {
    harnessVersion,
    layers: parsed.layers.map((l) => ({ layer: l, kind: "dump", text: "" })),
    rows: parsed.rows,
    packages,
    installed,
    nested: {},
    nmRoot,
    truthSource: "dump-config",
    provenance: parsed.rows.map((r) => ({ id: r.id, origin: r.origin, patchedBy: r.patchedBy }))
  };
  return { ok: true, ecosystem: eco };
}
