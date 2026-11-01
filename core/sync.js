// dsh-forge/core/sync.js
// Cross-surface alignment: make the web profile and the desktop app archive
// share the same plugin set and versions. Planning is pure (it only reads the
// bridge payload); applying is guarded and always ends with a verification
// pass, because an install that does not land is worse than no plan at all.
//
// Design constraints:
//   - zero dependencies (node builtins + sibling core modules only);
//   - pluggable: planSync() is fed by buildBridge(); applySync() accepts
//     injected run/collect/probe/preflight so CLI, web and tests share one path;
//   - desktop is app-managed (resources/app.asar), so actions aimed at it are
//     reported as blocked instead of pretending they can be executed;
//   - apply backs up the profile files, re-collects the composition, checks the
//     exact versions, and dynamically imports the touched packages. Any failure
//     restores the backup and says what to run next.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { collectEcosystem, defaultHome } from "./composition.js";
import { probeEcosystem } from "./dynamic.js";
import { HARNESS_PACKAGE } from "./auto-update.js";
import { compareVersions, parseVersion } from "./semver.js";

export const SYNC_SCHEMA = "dsh-forge/sync@1";
export const DEFAULT_SYNC_TIMEOUT_MS = 300000;
export const SYNC_BATCH_SIZE = 40;
// Files a `dsh plugin` / package-manager operation can touch inside a profile.
export const SYNC_BACKUP_FILES = [
  "package.json", "cordis.yml", "cordis.patch.yml",
  "pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json"
];

const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const PACKAGE_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const HARNESS_SCOPE = /^@deepseek-ai\//;
const DEFAULT_REGISTRY = "https://registry.npmjs.org/";
const PREFLIGHT_TIMEOUT_MS = 3500;

function isPackageName(name) {
  return typeof name === "string" && name.length <= 214 && PACKAGE_RE.test(name);
}

function pickWeb(profiles) {
  const named = profiles.find((p) => p.name === "web");
  if (named) return named.name;
  const first = profiles.find((p) => !p.desktop && !p.error);
  return (first || profiles[0] || {}).name || "web";
}

function pickDesktop(profiles) {
  const named = profiles.find((p) => p.desktop);
  if (named) return named.name;
  return "desktop";
}

function findPair(bridge, a, b) {
  return (bridge.pairs || []).find((p) =>
    (p.left === a && p.right === b) || (p.left === b && p.right === a)
  ) || null;
}

// `npx @deepseek-ai/dsh@<harness> plugin --profile <name> <args...>`.
// Pinning the harness version keeps the installer identical to the runtime the
// profile actually mounts; without a known harness version we fall back to the
// plain command from the README.
export function pluginCommand(profile, args, harnessVersion) {
  const pin = harnessVersion && VERSION_RE.test(String(harnessVersion)) ? "@" + harnessVersion : "";
  return "npx " + HARNESS_PACKAGE + pin + " plugin --profile " + profile + " " + args.join(" ");
}

function installSpec(pkg, to) {
  return pkg + "@" + to;
}

function directionOf(from, to) {
  const f = parseVersion(from);
  const t = parseVersion(to);
  if (!f || !t) return "align";
  const cmp = compareVersions(t, f);
  return cmp > 0 ? "upgrade" : cmp < 0 ? "downgrade" : "align";
}

function chunkSpecs(specs, size) {
  const out = [];
  for (let i = 0; i < specs.length; i += size) out.push(specs.slice(i, i + size));
  return out;
}

// ── planning (pure) ────────────────────────────────────────────────────────
// bridge: payload from buildBridge(). opts:
//   { web, desktop, reference, packages, force, root, home }
// reference defaults to the desktop edition (the shipped baseline); when the
// reference is "web" the desktop side would have to move, which is always
// blocked because the app archive is managed by Electron.
export function planSync(bridge, opts = {}) {
  const profiles = Array.isArray(bridge && bridge.profiles) ? bridge.profiles : [];
  const webName = opts.web || pickWeb(profiles);
  const desktopName = opts.desktop || pickDesktop(profiles);
  const web = profiles.find((p) => p.name === webName) || null;
  const desktop = profiles.find((p) => p.name === desktopName) || null;
  const desktopAvailable = !!(bridge && bridge.desktop && bridge.desktop.available)
    || !!(desktop && !desktop.error && desktop.packageCount > 0);
  const reference = opts.reference === webName ? webName : desktopName;
  const plan = {
    schema: SYNC_SCHEMA,
    generatedAt: new Date().toISOString(),
    web: webName,
    desktop: desktopName,
    reference,
    desktopAvailable,
    status: "ok",
    ok: true,
    actions: [],
    blocked: [],
    desktopMissing: [],
    desktopRuntime: [],
    warnings: [],
    harness: null,
    install: null,
    summary: {}
  };
  const wanted = Array.isArray(opts.packages) && opts.packages.length ? new Set(opts.packages) : null;
  const wantedPkg = (pkg) => !wanted || wanted.has(pkg);

  if (!web) {
    plan.blocked.push({ scope: "profile", profile: webName, reason: "web profile '" + webName + "' was not collected by the bridge" });
    return finalize(plan, web, desktop);
  }
  if (web.error) {
    plan.blocked.push({ scope: "profile", profile: webName, reason: "web 组合扫描失败: " + web.error + "（先修复 profile 或其 bundle，再重试；不做猜测性安装）" });
    return finalize(plan, web, desktop);
  }
  if (desktop && desktop.error) {
    plan.blocked.push({ scope: "profile", profile: desktopName, reason: "桌面端组合扫描失败: " + desktop.error });
    return finalize(plan, web, desktop);
  }
  if (!desktopAvailable) {
    plan.status = "no-desktop";
    plan.warnings.push("未检测到桌面端归档（resources/app.asar）；没有可对齐的第二端。");
    return finalize(plan, web, desktop);
  }
  const pair = findPair(bridge, webName, desktopName);
  if (!pair) {
    plan.blocked.push({ scope: "pair", reason: "未采集到 " + webName + " × " + desktopName + " 的对比结果；请把两端都传给 bridge（--profiles " + webName + "," + desktopName + "）" });
    return finalize(plan, web, desktop);
  }
  // An incomplete scan means some declared bundles were not resolvable, so the
  // composed row set is partial. The plugin set itself is still trustworthy:
  // the profile's own package.json dependencies are read directly (declared),
  // so third-party plugins can be aligned without guessing about harness rows.
  if (pair.complete === false) {
    plan.status = "partial";
    const detail = [];
    for (const side of ["left", "right"]) {
      const missing = (pair.missing && pair.missing[side]) || [];
      if (missing.length) detail.push(pair[side] + ": " + missing.join(", "));
    }
    plan.warnings.push("组合口径不完整（未解析到 " + detail.join("; ") + "）；仅对齐已知插件版本，harness 运行时包不做推断。安装目标 bundle 或传 --root <node_modules> 可恢复完整口径。");
  }

  const webIsLeft = pair.left === webName;
  const targetSide = reference === desktopName ? webName : desktopName;
  const harnessVersion = web.harnessVersion || null;

  const pushInstall = (pkg, from, to, action) => {
    plan.actions.push({
      kind: "install",
      side: webName,
      action,
      package: pkg,
      from: from || null,
      to,
      direction: directionOf(from, to),
      spec: installSpec(pkg, to)
    });
  };

  // 1) shared packages with version drift.
  for (const s of pair.shared || []) {
    if (!wantedPkg(s.package)) continue;
    const wv = webIsLeft ? s.left : s.right;
    const dv = webIsLeft ? s.right : s.left;
    const from = targetSide === webName ? wv : dv;
    const to = reference === desktopName ? dv : wv;
    if (!isPackageName(s.package) || !VERSION_RE.test(String(to))) {
      plan.blocked.push({ scope: "package", package: s.package, reason: "版本不可用于安装: " + JSON.stringify(to) });
      continue;
    }
    if (from === to) continue;
    if (targetSide === webName) {
      pushInstall(s.package, from, to, "align");
      if (directionOf(from, to) === "downgrade") {
        plan.warnings.push(s.package + "：web 端 " + from + " 高于参考端 " + to + "，将下调到参考版本；若新版本应被保留，请先更新桌面端应用。");
      }
    } else {
      plan.blocked.push({
        scope: "package",
        package: s.package,
        side: desktopName,
        reason: "桌面端为只读应用归档（resources/app.asar），无法从 forge 改动；需通过桌面应用更新到 " + to
      });
    }
  }

  // 2) packages that exist on only one side.
  const onlyWeb = webIsLeft ? pair.onlyLeft : pair.onlyRight;
  const onlyDesktop = webIsLeft ? pair.onlyRight : pair.onlyLeft;
  const webPkgs = web.packages || {};
  const deskPkgs = desktop.packages || {};
  const declared = web.declared || {};
  const actionFor = (pkg) => plan.actions.find((a) => a.kind === "install" && a.package === pkg) || null;

  // 2a) Declared dependencies are the authoritative install record when the
  // composition scan is partial: a package listed in the profile package.json
  // may be installed but not composed (or mounted through a bundle that could
  // not be resolved). Only exact semver pins are aligned; ranges and
  // link:/git+/file: specs are left alone so a working local install is never
  // overwritten by a registry version.
  for (const [pkg, declaredVersion] of Object.entries(declared)) {
    if (!wantedPkg(pkg)) continue;
    if (HARNESS_SCOPE.test(pkg) || !isPackageName(pkg)) continue;
    if (!EXACT_VERSION_RE.test(String(declaredVersion))) continue;
    const dv = deskPkgs[pkg];
    if (!dv || !VERSION_RE.test(String(dv))) continue;
    if (declaredVersion === dv || actionFor(pkg)) continue;
    pushInstall(pkg, declaredVersion, dv, "align");
  }

  for (const pkg of onlyDesktop) {
    if (!wantedPkg(pkg)) continue;
    const to = deskPkgs[pkg];
    if (!isPackageName(pkg) || !VERSION_RE.test(String(to))) {
      plan.blocked.push({ scope: "package", package: pkg, reason: "桌面端清单里没有可安装的版本" });
      continue;
    }
    // The desktop archive carries the whole harness runtime. Mirroring every
    // @deepseek-ai/* package into the web profile would install the desktop
    // app itself, not a shared plugin, so those are reported separately and
    // require an explicit opt-in.
    if (HARNESS_SCOPE.test(pkg) && opts.includeRuntime !== true) {
      // A runtime package the web profile already declares is installed, so it
      // is neither missing nor something to mirror.
      if (declared[pkg] !== undefined) {
        if (declared[pkg] !== to) {
          plan.warnings.push(pkg + "：web 已声明 " + declared[pkg] + "，桌面端为 " + to + "；运行时包不做自动替换。");
        }
        continue;
      }
      plan.desktopRuntime.push({
        package: pkg,
        version: to,
        reason: "桌面端运行时包（应用自身组成），默认不装入 web；确认需要时用 includeRuntime/--include-runtime"
      });
      continue;
    }
    // Declared non-runtime packages: handled by the alignment above, or left
    // alone on purpose when the spec is link:/git+/a range.
    if (declared[pkg] !== undefined) continue;
    if (reference === desktopName) {
      pushInstall(pkg, null, to, "add");
    } else {
      plan.desktopMissing.push({ package: pkg, version: to, side: desktopName, reason: "参考端（" + reference + "）没有该包，桌面端又不可写" });
    }
  }
  for (const pkg of onlyWeb) {
    if (!wantedPkg(pkg)) continue;
    const version = webPkgs[pkg] || null;
    if (reference === webName) {
      plan.blocked.push({
        scope: "package", package: pkg, side: desktopName,
        reason: "参考端（web）有 " + pkg + "@" + (version || "?") + "，但桌面端不可安装；请随桌面应用发版或从 web 移除"
      });
      continue;
    }
    plan.desktopMissing.push({
      package: pkg,
      version,
      side: desktopName,
      reason: "桌面端没有该插件且不可写入；如需完全一致，可在 web 端移除",
      removeCommand: pluginCommand(webName, ["remove", pkg], harnessVersion)
    });
  }

  // 3) harness skew. Plugin versions are chosen against the desktop baseline,
  // so an older web harness is a warning and a newer web harness requires a
  // desktop app update (blocked).
  const wv = web.harnessVersion || null;
  const dv = desktop.harnessVersion || null;
  if (wv && dv && wv !== dv) {
    const w = parseVersion(wv);
    const d = parseVersion(dv);
    const cmp = w && d ? compareVersions(d, w) : 0;
    plan.harness = { web: wv, desktop: dv, drift: true };
    if (cmp > 0) {
      plan.harness.action = {
        kind: "harness", side: webName, action: "align", from: wv, to: dv, manual: true,
        command: "npm install -g " + HARNESS_PACKAGE + "@" + dv,
        note: "web 端 harness 落后于桌面端；建议先对齐 harness 再对齐插件"
      };
      plan.warnings.push("harness 漂移：" + webName + " " + wv + " → " + dv + "（先对齐 harness，否则按桌面版本安装的插件可能加载失败）");
    } else {
      plan.harness.action = {
        kind: "harness", side: desktopName, action: "align", from: dv, to: wv, blocked: true,
        reason: "桌面端 harness " + dv + " 落后于 web 端 " + wv + "；桌面应用需更新"
      };
      plan.blocked.push({
        scope: "harness", side: desktopName,
        reason: "桌面端 harness " + dv + " 落后于 web 端 " + wv + "；请更新桌面应用，forge 无法修改 app.asar"
      });
    }
  } else if (!wv || !dv) {
    plan.warnings.push("harness 版本未知（" + webName + ": " + (wv || "?") + " · " + desktopName + ": " + (dv || "?") + "）；安装命令将使用最新 dsh CLI");
  }

  return finalize(plan, web, desktop);
}

function finalize(plan, web, desktop) {
  const installs = plan.actions.filter((a) => a.kind === "install" && a.side === plan.web);
  const specs = installs.map((a) => a.spec);
  if (specs.length) {
    const batches = chunkSpecs(specs, SYNC_BATCH_SIZE).map((chunk) => ({
      packages: chunk,
      command: pluginCommand(plan.web, ["add", ...chunk], web && web.harnessVersion)
    }));
    plan.install = { side: plan.web, count: specs.length, packages: specs, batches };
  }
  plan.ok = plan.blocked.length === 0;
  if (!plan.ok) plan.status = plan.status === "ok" ? "blocked" : plan.status;
  plan.summary = {
    reference: plan.reference,
    desktopAvailable: plan.desktopAvailable,
    actions: installs.length,
    changes: plan.actions.filter((a) => a.kind === "harness").length,
    blocked: plan.blocked.length,
    desktopMissing: plan.desktopMissing.length,
    desktopRuntime: plan.desktopRuntime.length,
    warnings: plan.warnings.length,
    batches: plan.install ? plan.install.batches.length : 0
  };
  return plan;
}

// ── preflight (pure apart from fetch) ──────────────────────────────────────
// Verify each exact spec exists in the registry before touching the profile.
// A missing version is a reliable "this install cannot work"; a network error
// is unknown and never blocks (the install itself is the final authority).
export async function preflightSync(plan, opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const registry = opts.registry || DEFAULT_REGISTRY;
  const timeoutMs = opts.timeoutMs || PREFLIGHT_TIMEOUT_MS;
  const specs = (plan && plan.install && plan.install.packages) || [];
  const out = { registry, checked: 0, available: [], unavailable: [], unknown: [], networkError: false };
  if (!specs.length) return out;
  if (typeof fetchImpl !== "function") { out.networkError = true; return out; }
  const concurrency = Math.max(1, opts.concurrency || 6);

  async function probe(spec) {
    const at = spec.lastIndexOf("@");
    if (at <= 0) return { spec, state: "unknown" };
    const pkg = spec.slice(0, at);
    const version = spec.slice(at + 1);
    const url = registry + encodeURIComponent(pkg).replace(/%2F/g, "/") + "/" + encodeURIComponent(version);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
      if (res.status === 404) return { spec, state: "unavailable" };
      if (!res.ok) return { spec, state: "unknown" };
      return { spec, state: "available" };
    } catch {
      return { spec, state: "unknown" };
    } finally {
      clearTimeout(timer);
    }
  }

  for (let i = 0; i < specs.length; i += concurrency) {
    const batch = specs.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(probe));
    for (const r of results) {
      if (r.state === "available") out.available.push(r.spec);
      else if (r.state === "unavailable") out.unavailable.push(r.spec);
      else out.unknown.push(r.spec);
    }
  }
  out.checked = specs.length;
  out.networkError = out.unknown.length === specs.length;
  return out;
}

// ── apply (guarded, verified, reversible) ─────────────────────────────────
function defaultRun(step, opts) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(step.command, {
        cwd: opts.cwd,
        shell: process.platform === "win32",
        windowsHide: true,
        env: { ...process.env, ...(opts.env || {}) }
      });
    } catch (e) {
      resolve({ ok: false, command: step.command, error: String((e && e.message) || e) });
      return;
    }
    const cap = (s, chunk) => (s + String(chunk)).slice(-20000);
    child.stdout.on("data", (d) => { out = cap(out, d); });
    child.stderr.on("data", (d) => { err = cap(err, d); });
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
    }, opts.timeoutMs || DEFAULT_SYNC_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, command: step.command, error: String((e && e.message) || e), stdout: out, stderr: err, durationMs: Date.now() - startedAt });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, command: step.command, code, stdout: out, stderr: err, durationMs: Date.now() - startedAt });
    });
  });
}

function readBackup(dir) {
  const snap = new Map();
  for (const name of SYNC_BACKUP_FILES) {
    const file = path.join(dir, name);
    try {
      if (fs.existsSync(file)) snap.set(name, { text: fs.readFileSync(file, "utf8"), existed: true });
    } catch { /* unreadable file is left alone */ }
  }
  return snap;
}

function restoreBackup(dir, snap) {
  const restored = [];
  const removed = [];
  for (const name of SYNC_BACKUP_FILES) {
    const file = path.join(dir, name);
    const before = snap.get(name);
    try {
      if (before) {
        fs.writeFileSync(file, before.text, "utf8");
        restored.push(file);
      } else if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        removed.push(file);
      }
    } catch { /* best effort: report what we could */ }
  }
  return { restored, removed };
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

// Verification is deliberately explicit: version equality first, then a real
// dynamic import for the touched packages. `timeout` and unknown errors are
// reported but do not trigger a rollback (they are not proof of breakage);
// missing exports / unresolvable modules are fatal and do.
//
// The version check reads the installed manifest in the profile's node_modules
// as well as the composed package map: `dsh plugin add` installs a package but
// does not necessarily add a composition row or bundle, and an installed-only
// package must not be reported as a failed install.
export async function verifySync(plan, steps, opts = {}) {
  const home = opts.home || defaultHome();
  const collect = opts.collect || ((o) => collectEcosystem(o));
  const eco = await collect({ home, profile: plan.web, root: opts.root });
  const profileNm = path.join(home, "profiles", plan.web, "node_modules");
  const versions = [];
  const mismatches = [];
  const notComposed = [];
  const probePkgs = {};
  for (const s of steps) {
    const composed = eco.packages && eco.packages[s.package];
    let m = composed || null;
    let source = "composition";
    if (!m) {
      const dir = path.join(profileNm, ...s.package.split("/"));
      const manifest = readManifest(dir);
      if (manifest) {
        m = { version: manifest.version, dir };
        source = "node_modules";
        notComposed.push(s.package);
      }
    }
    const actual = m ? m.version || null : null;
    versions.push({ package: s.package, expected: s.to, actual, source: m ? source : null });
    if (!m) mismatches.push({ package: s.package, expected: s.to, actual: null, reason: "not-visible-in-composition" });
    else if (actual !== s.to) mismatches.push({ package: s.package, expected: s.to, actual, reason: "version-mismatch" });
    else if (m.dir) probePkgs[s.package] = { ...m, dependencies: m.dependencies || {}, peerDependencies: m.peerDependencies || {} };
  }
  let dynamic = null;
  let loadFailures = [];
  let loadWarnings = [];
  if (opts.probe !== false && Object.keys(probePkgs).length) {
    const probe = opts.probeEcosystem || probeEcosystem;
    const result = await probe({ packages: probePkgs, rows: [], installed: {}, nested: {} }, { timeoutMs: opts.probeTimeoutMs });
    dynamic = {
      probed: result.probed,
      ok: (result.results || []).filter((r) => r.ok).length,
      failed: (result.results || []).filter((r) => !r.ok).map((r) => ({
        package: r.package, category: r.category, error: r.error
      })),
      notExecuted: result.notExecuted || []
    };
    for (const r of result.results || []) {
      if (r.ok) continue;
      const fatal = r.category === "missing-export" || r.category === "module-not-found";
      if (fatal) loadFailures.push({ package: r.package, category: r.category, error: r.error });
      else loadWarnings.push({ package: r.package, category: r.category, error: r.error });
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    rows: (eco.rows || []).length,
    packages: (eco.packages ? Object.keys(eco.packages).length : 0),
    versions,
    mismatches,
    notComposed,
    dynamic,
    loadFailures,
    loadWarnings,
    ok: mismatches.length === 0 && loadFailures.length === 0
  };
}

// applySync(plan, opts):
//   apply:true            required to execute anything
//   confirm:"sync-<web>"  explicit confirmation (same guard style as /api/update)
//   run / collect / probe injectable adapters
//   preflight:false       skip registry existence checks
// Returns {ok, applied, steps, verification, preflight, rollback, error}.
export async function applySync(plan, opts = {}) {
  const result = {
    ok: false,
    applied: false,
    web: plan && plan.web,
    steps: [],
    verification: null,
    preflight: null,
    unavailable: [],
    rollback: null,
    error: null
  };
  if (!plan || plan.schema !== SYNC_SCHEMA) {
    result.error = "not a dsh-forge/sync@1 plan";
    return result;
  }
  if (!opts.apply) {
    result.ok = plan.ok;
    result.planned = true;
    result.commands = plan.install ? plan.install.batches.map((b) => b.command) : [];
    return result;
  }
  const expected = "sync-" + plan.web;
  if (opts.confirm !== expected) {
    result.error = "confirmation required: confirm=\"" + expected + "\"";
    return result;
  }
  if (plan.status === "no-desktop") {
    result.ok = true;
    result.skipped = "no-desktop";
    return result;
  }
  if (plan.blocked.length) {
    result.error = "plan has blocking items; resolve them first";
    result.blocked = plan.blocked;
    return result;
  }
  if (!plan.install || !plan.install.packages.length) {
    result.ok = true;
    result.skipped = "nothing-to-install";
    return result;
  }
  const home = opts.home || defaultHome();
  const profileDir = path.join(home, "profiles", plan.web);
  if (!fs.existsSync(profileDir)) {
    result.error = "profile directory does not exist: " + profileDir;
    return result;
  }

  let steps = plan.actions
    .filter((a) => a.kind === "install" && a.side === plan.web)
    .map((a) => ({ ...a }));

  if (opts.preflight !== false) {
    const pre = await preflightSync(plan, {
      fetch: opts.fetch, registry: opts.registry, timeoutMs: opts.preflightTimeoutMs, concurrency: opts.concurrency
    });
    result.preflight = pre;
    if (pre.unavailable.length) {
      const gone = new Set(pre.unavailable);
      steps = steps.filter((s) => !gone.has(s.spec));
      result.unavailable = pre.unavailable.slice();
    }
    if (!steps.length) {
      result.error = "registry has no installable version for: " + pre.unavailable.join(", ");
      return result;
    }
  }

  const snapshot = readBackup(profileDir);
  const run = opts.run || defaultRun;
  const runOpts = { cwd: opts.cwd || profileDir, timeoutMs: opts.timeoutMs, env: opts.env };

  const applied = [];
  for (const chunk of chunkSpecs(steps, SYNC_BATCH_SIZE)) {
    const specs = chunk.map((s) => s.spec);
    const command = pluginCommand(plan.web, ["add", ...specs], opts.harnessVersion);
    const step = { kind: "install", side: plan.web, command, packages: specs, startedAt: new Date().toISOString() };
    let r;
    try {
      r = await run(step, runOpts);
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) };
    }
    Object.assign(step, {
      ok: !!(r && r.ok),
      code: r && r.code != null ? r.code : null,
      stdout: (r && r.stdout) || "",
      stderr: (r && r.stderr) || "",
      error: (r && !r.ok) ? (r.error || ("install exited with code " + (r.code == null ? "?" : r.code))) : null,
      durationMs: r && r.durationMs != null ? r.durationMs : null
    });
    result.steps.push(step);
    applied.push(...chunk);
    if (!step.ok) {
      result.error = "install failed: " + (step.error || "unknown error");
      result.rollback = { ...restoreBackup(profileDir, snapshot), needsInstall: true, command: pluginCommand(plan.web, ["install"], opts.harnessVersion) };
      result.verification = { skipped: true, reason: "install command failed" };
      return result;
    }
  }
  result.applied = true;

  let verification;
  try {
    verification = await verifySync(plan, applied, {
      home,
      root: opts.root,
      collect: opts.collect,
      probe: opts.probe,
      probeEcosystem: opts.probeEcosystem,
      probeTimeoutMs: opts.probeTimeoutMs
    });
  } catch (e) {
    verification = { ok: false, error: String((e && e.message) || e), mismatches: [], loadFailures: [] };
  }
  result.verification = verification;

  if (!verification.ok) {
    const reasons = [];
    for (const m of verification.mismatches || []) {
      reasons.push(m.package + " 期望 " + m.expected + "，实际 " + (m.actual || "不可见") + "（" + m.reason + "）");
    }
    for (const f of verification.loadFailures || []) {
      reasons.push(f.package + " 安装后无法导入（" + f.category + "）");
    }
    result.error = "post-install verification failed: " + reasons.join("; ");
    result.rollback = { ...restoreBackup(profileDir, snapshot), needsInstall: true, command: pluginCommand(plan.web, ["install"], opts.harnessVersion) };
    return result;
  }

  result.ok = true;
  return result;
}
