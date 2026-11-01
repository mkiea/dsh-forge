// dsh-forge/core/dynamic.js
// Runtime probing: actually import every collected package entry in one child
// process. Static analysis cannot see ESM link-time failures (a package asking
// for an export that the installed version no longer provides), so this layer
// converts them into `runtime-probe` evidence.
//
// Granularity / honesty notes:
//   - one shared child process, per-package try/catch, NDJSON on stdout;
//   - the parent kill timeout bounds the whole batch (a hung import is reported
//     as `timeout`, never silently dropped);
//   - importing a plugin entry may execute top-level code, so the probe is
//     OPT-IN (CLI --dynamic / verify_rows dynamic:true), never part of the
//     default cached analysis path.
"use strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { attachFindingIds } from "./evidence.js";

export const DEFAULT_PROBE_TIMEOUT_MS = 30000;
export const DEFAULT_PROBE_LIMIT = 300;

// Child program. Bare `-e` cannot resolve deployment packages from an arbitrary
// temp cwd, so the parent passes absolute file URLs (entry points).
export const PROBE_SCRIPT = `
import * as fs from "node:fs";
const list = JSON.parse(fs.readFileSync(process.env.DSH_FORGE_PROBE_FILE, "utf8"));
for (const it of list) {
  const started = Date.now();
  try {
    await import(it.url);
    process.stdout.write(JSON.stringify({ package: it.package, ok: true, ms: Date.now() - started }) + "\\n");
  } catch (e) {
    process.stdout.write(JSON.stringify({ package: it.package, ok: false, ms: Date.now() - started, error: String((e && e.message) || e).split("\\n")[0], code: (e && e.code) || null }) + "\\n");
  }
}
process.exit(0);
`;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

// Resolve the runtime entry of an installed package directory (exports["."]
// first, then legacy main/module).
export function packageEntry(dir) {
  const m = readJson(path.join(dir, "package.json"));
  if (!m) return null;
  let rel = null;
  const exp = m.exports;
  if (typeof exp === "string") rel = exp;
  else if (exp && typeof exp === "object") {
    const dot = exp["."];
    if (typeof dot === "string") rel = dot;
    else if (dot && typeof dot === "object") rel = dot.default || dot.import || dot.require || null;
    if (!rel && exp["."] === undefined) rel = exp.default || exp.import || null;
  }
  rel = rel || m.module || m.main || "index.js";
  const abs = path.resolve(dir, rel);
  return fs.existsSync(abs) ? abs : null;
}

// Probe list ordered so composed row packages come first (those are the ones
// the harness actually mounts); pure libs follow alphabetically.
export function buildProbeList(eco, opts = {}) {
  const list = [];
  const seen = new Set();
  for (const [p, m] of Object.entries((eco && eco.packages) || {})) {
    if (!m || !m.dir || seen.has(p)) continue;
    const entry = packageEntry(m.dir);
    if (!entry) continue;
    seen.add(p);
    list.push({ package: p, version: m.version || null, entry, url: pathToFileURL(entry).href });
  }
  const rowPkgs = new Set(((eco && eco.rows) || []).map((r) => r.name).filter(Boolean));
  list.sort((a, b) => {
    const ra = rowPkgs.has(a.package) ? 0 : 1;
    const rb = rowPkgs.has(b.package) ? 0 : 1;
    return ra - rb || a.package.localeCompare(b.package);
  });
  const limit = opts.limit === undefined ? 0 : Number(opts.limit);
  return limit > 0 ? list.slice(0, limit) : list;
}

// Error text -> failure category. `missing-export` is the 0.1.7 CallId class:
// the link step fails with "does not provide an export named 'X'".
export function classifyProbeError(text) {
  const s = String(text == null ? "" : text);
  const m = /does not provide an export named ['"`]?([^'"`\s)]+)['"`]?/.exec(s)
    || /requested module ['"`]?([^'"`\s)]+)['"`]? does not provide export named/.exec(s);
  if (m) return { category: "missing-export", symbol: m[1] };
  if (/ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package|ERR_PACKAGE_PATH_NOT_EXPORTED|Cannot resolve module/.test(s)) {
    return { category: "module-not-found" };
  }
  if (/timeout|timed out|ETIMEDOUT|did not complete/i.test(s)) return { category: "timeout" };
  return { category: "other" };
}

// Parse the child's NDJSON output into normalized probe results.
export function parseProbeOutput(text) {
  const out = [];
  for (const line of String(text == null ? "" : text).split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    let o;
    try { o = JSON.parse(s); } catch { continue; }
    if (!o || typeof o.package !== "string") continue;
    const cls = o.ok ? { category: null } : classifyProbeError(o.error);
    out.push({
      package: o.package,
      entry: o.entry || null,
      ok: !!o.ok,
      ms: Number(o.ms) || 0,
      error: o.error || null,
      code: o.code || null,
      category: cls.category,
      symbol: cls.symbol || null
    });
  }
  return out;
}

// Probe failures -> findings carrying runtime-probe evidence (INV-6 shape:
// every finding has evidence + confidence). High severity is safe here: the
// import really did fail in this deployment.
export function dynamicFindings(probe) {
  const failures = ((probe && probe.results) || []).filter((r) => !r.ok);
  return failures.map((r) => {
    const cat = r.category || classifyProbeError(r.error).category;
    const timeout = cat === "timeout";
    const severity = timeout ? "medium" : "high";
    const symbol = r.symbol ? " '" + r.symbol + "'" : "";
    let message;
    let advice;
    if (cat === "missing-export") {
      message = "运行期导入失败（缺失导出）: " + r.package + " 请求的模块已不再导出" + symbol + "，ESM 链接阶段直接抛错，该插件在 harness 中无法加载。";
      advice = "把该插件升级到与当前 harness 兼容的版本，或移除对已删除导出的依赖（0.1.7 的 dsh-llm 已移除 CallId 等导出）。";
    } else if (cat === "module-not-found") {
      message = "运行期导入失败（模块无法解析）: " + r.package + " 的依赖在本次部署中不可解析。";
      advice = "补齐缺失依赖；若依赖来自 harness 旧版本，按新版本的包布局迁移（0.1.7+ 插件内嵌于 dsh 包内）。";
    } else if (timeout) {
      message = "运行期导入未在超时内完成: " + r.package + "（不能据此判定失败，需人工复核）。";
      advice = "在交互式环境单独 import 该包复核，或提高 --dynamic-timeout 后重跑。";
    } else {
      message = "运行期导入失败: " + r.package + " — " + (r.error || "unknown error");
      advice = "按错误栈定位该包在加载期的初始化异常。";
    }
    return {
      type: "dynamic-import",
      rule: "dynamic-import",
      category: "dynamic-import",
      name: r.package,
      scope: r.package,
      location: r.entry || "",
      packages: [r.package],
      severity,
      finalSeverity: severity,
      confidence: timeout ? "low" : "high",
      evidenceTier: "runtime-probe",
      runtimeState: timeout ? "not-executed" : "executed-residual",
      evidenceTag: timeout ? "runtime-probe + not-executed" : "runtime-probe -> runtime-confirmed",
      message,
      evidence: "dynamic import(" + (r.entry || r.package) + ") -> " + (r.error || cat),
      impact: timeout ? "该包未获得运行期证据，静态结论仍需保留。" : "该行在装载/导入阶段即失败，运行期不可用。",
      advice,
      next_action: advice,
      reproduce_hint: r.entry
        ? "node --input-type=module -e \"import('" + pathToFileURL(r.entry).href + "')\""
        : "node --input-type=module -e \"import('" + r.package + "')\""
    };
  });
}

// Merge dynamic findings into a (possibly cached) analysis WITHOUT mutating it.
// Kept out of runAnalysis so the cache stays a pure static result.
export function mergeDynamicFindings(analysis, probe) {
  const dyn = dynamicFindings(probe);
  if (!dyn.length) return { ...analysis, dynamicProbe: probeSummary(probe) };
  attachFindingIds(dyn);
  const base = analysis.conflicts || {};
  const conflicts = [...(base.conflicts || []), ...dyn];
  const bySeverity = conflicts.reduce((a, f) => {
    const s = f.finalSeverity || f.severity || "info";
    a[s] = (a[s] || 0) + 1;
    return a;
  }, {});
  return {
    ...analysis,
    conflicts: { ...base, conflicts, summary: { ...(base.summary || {}), total: conflicts.length, bySeverity } },
    dynamicProbe: probeSummary(probe)
  };
}

export function probeSummary(probe) {
  const results = (probe && probe.results) || [];
  return {
    probed: (probe && probe.probed) || results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    timedOut: !!(probe && probe.timedOut),
    elapsedMs: (probe && probe.elapsedMs) || 0,
    unconfirmed: results.filter((r) => r.category === "timeout").map((r) => r.package),
    // Desktop asar packages have no on-disk entry, so they cannot be imported.
    // Report them explicitly instead of implying they were probed.
    notExecuted: (probe && probe.notExecuted) || []
  };
}

// Run the batch probe. Resolves (never rejects) with
// {probed, results, ok, failed, timedOut, elapsedMs, error}.
export async function probeEcosystem(eco, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_PROBE_TIMEOUT_MS;
  const limit = opts.limit === undefined ? DEFAULT_PROBE_LIMIT : Number(opts.limit);
  const list = buildProbeList(eco, { limit });
  const startedAt = Date.now();
  const probe = { probed: list.length, results: [], ok: [], failed: [], timedOut: false, elapsedMs: 0, error: null };
  const probed = new Set(list.map((i) => i.package));
  probe.notExecuted = Object.entries((eco && eco.packages) || {})
    .filter(([p, m]) => m && m.asar && !probed.has(p))
    .map(([p]) => p);
  if (!list.length) return probe;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-forge-probe-"));
  const manifest = path.join(tmpDir, "probes.json");
  fs.writeFileSync(manifest, JSON.stringify(list), "utf8");
  try {
    const result = await new Promise((resolve) => {
      execFile(process.execPath, ["--input-type=module", "-e", PROBE_SCRIPT], {
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, DSH_FORGE_PROBE_FILE: manifest }
      }, (err, stdout, stderr) => resolve({ err, stdout: stdout || "", stderr: stderr || "" }));
    });
    const byPkg = new Map(list.map((i) => [i.package, i]));
    const results = parseProbeOutput(result.stdout);
    for (const r of results) {
      const it = byPkg.get(r.package);
      if (it) r.entry = it.entry;
    }
    const done = new Set(results.map((r) => r.package));
    for (const it of list) {
      if (done.has(it.package)) continue;
      results.push({
        package: it.package,
        entry: it.entry,
        ok: false,
        ms: 0,
        error: "probe did not complete (timeout or child crash)",
        code: "timeout",
        category: "timeout",
        symbol: null
      });
    }
    if (result.err && (result.err.killed || result.err.signal)) probe.timedOut = true;
    if (!results.length && result.err) probe.error = String(result.err.message || result.err).split("\n")[0];
    if (!results.length && !result.err && result.stderr) probe.error = String(result.stderr).split("\n")[0];
    probe.results = results;
    probe.ok = results.filter((r) => r.ok).map((r) => r.package);
    probe.failed = results.filter((r) => !r.ok);
    probe.elapsedMs = Date.now() - startedAt;
    return probe;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
