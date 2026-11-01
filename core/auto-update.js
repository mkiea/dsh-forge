// dsh-forge/core/auto-update.js
// Web-side auto-update plumbing (zero-dependency, node builtins only):
//   1. composition watch set + signature  -> the dashboard re-analyses when the
//      profile / bundle patches / offline snapshot actually change;
//   2. version detection for dsh-forge itself and the DeepSeek Harness;
//   3. a guarded upgrade executor (never runs unless the caller passes
//      apply:true and the target is on the allow-list).
// All filesystem reads are best-effort: a missing file is reported as such
// instead of throwing, so a half-installed profile still yields a signature.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { compareVersions, parseVersion } from "./semver.js";
import { latestFromRegistry } from "./upgrade.js";

export const SELF_PACKAGE = "dsh-forge";
export const HARNESS_PACKAGE = "@deepseek-ai/dsh";
// Files inside a dsh profile that change when the composition changes.
export const PROFILE_WATCH_FILES = ["cordis.yml", "cordis.patch.yml", "package.json", "pnpm-workspace.yaml"];
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;

// Collect the files whose mtime/size define the current composition. `layers`
// comes from collectEcosystem/discoverSources (bundle patches + profile root);
// asar-backed layers live inside the archive and are not watchable on disk.
export function buildWatchSet(opts = {}) {
  const files = [];
  const seen = new Set();
  const add = (p) => {
    if (!p) return;
    const abs = path.resolve(String(p));
    if (seen.has(abs)) return;
    seen.add(abs);
    files.push(abs);
  };
  if (opts.profileDir) for (const name of PROFILE_WATCH_FILES) add(path.join(opts.profileDir, name));
  for (const l of opts.layers || []) {
    if (!l || l.asar || !l.path) continue;
    add(l.path);
  }
  if (opts.datasetPath) add(opts.datasetPath);
  for (const f of opts.files || []) add(f);
  return files;
}

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Stat-based signature: cheap enough to poll every few seconds on the web.
export function watchSignature(files) {
  const entries = [];
  for (const file of files || []) {
    try {
      const st = fs.statSync(file);
      entries.push({ file, mtimeMs: Math.round(st.mtimeMs), size: st.size });
    } catch {
      entries.push({ file, missing: true });
    }
  }
  const key = fnv1a(JSON.stringify(entries));
  return { checkedAt: new Date().toISOString(), key, entries };
}

// Compare two signatures -> which files changed / appeared / disappeared.
export function diffSignature(prev, next) {
  const before = new Map(((prev && prev.entries) || []).map((e) => [e.file, e]));
  const after = new Map(((next && next.entries) || []).map((e) => [e.file, e]));
  const changed = [];
  const added = [];
  const removed = [];
  for (const [file, e] of after) {
    const old = before.get(file);
    if (!old) { added.push(file); continue; }
    if (!!old.missing !== !!e.missing || old.mtimeMs !== e.mtimeMs || old.size !== e.size) changed.push(file);
  }
  for (const file of before.keys()) if (!after.has(file)) removed.push(file);
  return {
    same: changed.length === 0 && added.length === 0 && removed.length === 0,
    changed, added, removed
  };
}

// Pure compare helper so version detection stays testable without a registry.
export function assessVersion(current, latest) {
  const cur = current || null;
  if (!latest) return { current: cur, latest: null, status: "unknown", newer: false };
  if (!cur) return { current: null, latest, status: "unknown-installed", newer: false };
  const lv = parseVersion(latest);
  const cv = parseVersion(cur);
  if (!lv || !cv) return { current: cur, latest, status: "unknown", newer: false };
  const cmp = compareVersions(lv, cv);
  return {
    current: cur,
    latest,
    status: cmp > 0 ? "outdated" : cmp === 0 ? "current" : "local-ahead",
    newer: cmp > 0
  };
}

// Concrete commands the UI shows (and the executor runs for harness/forge).
export function updateCommands(target, version, opts = {}) {
  const profile = opts.profile || "web";
  if (target === "harness") {
    const v = version || "latest";
    return {
      npx: "npx " + HARNESS_PACKAGE + "@" + v,
      global: "npm install -g " + HARNESS_PACKAGE + "@" + v,
      desktop: "桌面版请使用应用内更新（resources/app.asar 由 Electron 管理）"
    };
  }
  const v = version || "latest";
  return {
    plugin: "npx " + HARNESS_PACKAGE + " plugin --profile " + profile + " add " + SELF_PACKAGE + "@" + v,
    npm: "npm install " + SELF_PACKAGE + "@" + v,
    ui: "npx " + HARNESS_PACKAGE + " plugin --profile " + profile + " add dsh-forge-ui@" + v
  };
}

// Detect newer dsh-forge / harness releases. Network failures are surfaced as
// networkError instead of being silently reported as "up to date".
export async function checkVersionUpdates(opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const net = { registry: opts.registry, registries: opts.registries, timeoutMs: opts.timeoutMs, fetch: fetchImpl };
  const [forge, harness] = await Promise.all([
    latestFromRegistry(SELF_PACKAGE, net),
    latestFromRegistry(HARNESS_PACKAGE, net)
  ]);
  return {
    checkedAt: new Date().toISOString(),
    forge: { name: SELF_PACKAGE, ...assessVersion(opts.forgeVersion, forge.latest), registry: forge.registry, registrySource: forge.registrySource, networkError: forge.networkError, commands: updateCommands("forge", forge.latest, opts) },
    harness: { name: HARNESS_PACKAGE, ...assessVersion(opts.harnessVersion, harness.latest), registry: harness.registry, registrySource: harness.registrySource, networkError: harness.networkError, commands: updateCommands("harness", harness.latest, opts) }
  };
}

// Execute an allow-listed upgrade. Read-only by default (apply:false returns
// the command only). package.json is backed up before any write.
export function runUpdate(opts = {}) {
  const target = opts.target;
  const pkg = target === "harness" ? HARNESS_PACKAGE : target === "forge" ? SELF_PACKAGE : null;
  const version = opts.version ? String(opts.version) : "";
  const plannedPm = opts.packageManager || "npm";
  const command = pkg ? plannedPm + " add " + pkg + "@" + version : "";
  if (!pkg) return Promise.resolve({ ok: false, applied: false, target, command, error: "unsupported update target (harness|forge)" });
  if (!version || !VERSION_RE.test(version)) return Promise.resolve({ ok: false, applied: false, target, command, error: "invalid version" });
  if (!opts.apply) return Promise.resolve({ ok: true, applied: false, target, version, command, plan: true });
  const cwd = opts.cwd ? path.resolve(opts.cwd) : process.cwd();
  if (!fs.existsSync(cwd)) return Promise.resolve({ ok: false, applied: false, target, version, command, error: "cwd does not exist: " + cwd });
  const packageManager = opts.packageManager || (fs.existsSync(path.join(cwd, "pnpm-lock.yaml")) ? "pnpm" : "npm");
  const args = ["add", pkg + "@" + version];
  const finalCommand = packageManager + " " + args.join(" ");
  let backup = null;
  const pkgFile = path.join(cwd, "package.json");
  try {
    if (fs.existsSync(pkgFile)) {
      backup = pkgFile + ".bak-" + new Date().toISOString().replace(/[:.]/g, "-");
      fs.copyFileSync(pkgFile, backup);
    }
  } catch { backup = null; }
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(packageManager, args, {
        cwd,
        shell: process.platform === "win32",
        windowsHide: true,
        env: { ...process.env, ...(opts.env || {}) }
      });
    } catch (e) {
      resolve({ ok: false, applied: false, target, version, command: finalCommand, backup, error: String(e.message || e) });
      return;
    }
    const cap = (s, chunk) => (s + String(chunk)).slice(-20000);
    child.stdout.on("data", (d) => { out = cap(out, d); });
    child.stderr.on("data", (d) => { err = cap(err, d); });
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
    }, opts.timeoutMs || 300000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, applied: false, target, version, command: finalCommand, backup, error: String(e.message || e) });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, applied: true, target, version, command: finalCommand, backup, code, stdout: out, stderr: err, durationMs: Date.now() - startedAt });
    });
  });
}
