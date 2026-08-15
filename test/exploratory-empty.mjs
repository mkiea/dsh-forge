// dsh-forge/test/exploratory-empty.mjs
// Exploratory testing around the empty/conflicting-empty plugin fixtures:
// boundary compositions (empty set, single empty plugin, missing manifest,
// disabled rows, cross-layer overrides), a mixed stress composition, and
// randomized subset sampling. Verifies robustness (no crash) and output
// self-consistency (summary counts match per-type/per-severity breakdowns).
import * as fs from "node:fs";
import * as path from "node:path";
import { collectEcosystem } from "../core/composition.js";
import { checkConflicts, scanToolNames } from "../core/conflicts.js";
import { scanLeaks } from "../core/leaks.js";
import { scanScopeHints } from "../core/scope.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const TMP = path.join(ROOT, ".tmp-tests");
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

function writePkg(base, name, { src, deps = {}, peerDeps = {}, version = "1.0.0", missing = false } = {}) {
  const dir = path.join(base, "node_modules", ...name.split("/"));
  if (missing) return dir;
  fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version, type: "module", main: "lib/index.js", dependencies: deps, peerDependencies: peerDeps }, null, 2), "utf8");
  if (src !== undefined) fs.writeFileSync(path.join(dir, "lib", "index.js"), src, "utf8");
  return dir;
}
function writeComposition(base, rel, text) {
  const f = path.join(base, rel);
  fs.writeFileSync(f, text, "utf8");
  return f;
}
function ecoOf(base, files) {
  return collectEcosystem({ root: path.join(base, "node_modules"), compositionFiles: files.map((f) => path.join(base, f)) });
}
// Structural self-consistency check for a conflict result.
function assertConsistent(tag, conf) {
  const byType = {};
  const bySev = {};
  for (const c of conf.conflicts) { byType[c.type] = (byType[c.type] || 0) + 1; bySev[c.severity] = (bySev[c.severity] || 0) + 1; }
  const tOK = JSON.stringify(conf.summary.byType) === JSON.stringify(byType);
  const sOK = JSON.stringify(conf.summary.bySeverity) === JSON.stringify(bySev);
  const nOK = conf.summary.total === conf.conflicts.length;
  check(tag + ": byType consistent", tOK, "expect=" + JSON.stringify(byType) + " got=" + JSON.stringify(conf.summary.byType));
  check(tag + ": bySeverity consistent", sOK, "expect=" + JSON.stringify(bySev) + " got=" + JSON.stringify(conf.summary.bySeverity));
  check(tag + ": total consistent", nOK, "total=" + conf.summary.total);
}

// ---- S1: empty composition (no rows) ----
{
  const base = fs.mkdtempSync(path.join(TMP, "x-empty-"));
  writeComposition(base, "c.yml", "[]\n");
  const eco = ecoOf(base, ["c.yml"]);
  check("S1: empty composition -> 0 rows", eco.rows.length === 0, "rows=" + eco.rows.length);
  check("S1: no packages", Object.keys(eco.packages).length === 0, JSON.stringify(eco.packages));
  const conf = checkConflicts(eco);
  check("S1: 0 conflicts", conf.conflicts.length === 0, "total=" + conf.conflicts.length);
  check("S1: 0 leak findings", scanLeaks(eco.packages).findings.length === 0, "ok");
}

// ---- S2: single empty plugin ----
{
  const base = fs.mkdtempSync(path.join(TMP, "x-single-"));
  writePkg(base, "pkg-solo", { src: "export function apply(ctx) {}\n" });
  writeComposition(base, "c.yml", "- id: pkg-solo\n  name: pkg-solo\n");
  const eco = ecoOf(base, ["c.yml"]);
  check("S2: single plugin discovered", eco.rows.length === 1 && eco.rows[0].name === "pkg-solo", JSON.stringify(eco.rows));
  const conf = checkConflicts(eco);
  check("S2: 0 conflicts", conf.conflicts.length === 0, "total=" + conf.conflicts.length);
}

// ---- S3: missing manifest (row references package that is not installed) ----
{
  const base = fs.mkdtempSync(path.join(TMP, "x-missing-"));
  writePkg(base, "pkg-ghost", { missing: true });
  writeComposition(base, "c.yml", "- id: pkg-ghost\n  name: pkg-ghost\n");
  const eco = ecoOf(base, ["c.yml"]);
  check("S3: missing manifest tolerated", eco.rows.length === 1, "rows=" + eco.rows.length);
  check("S3: package not in packages map", !eco.packages["pkg-ghost"], JSON.stringify(Object.keys(eco.packages)));
  const conf = checkConflicts(eco);
  check("S3: conflict scan does not crash", Array.isArray(conf.conflicts), typeof conf);
}

// ---- S4: disabled + config rows on empty plugins ----
{
  const base = fs.mkdtempSync(path.join(TMP, "x-disable-"));
  writePkg(base, "pkg-off", { src: "export function apply(ctx) {}\n" });
  writePkg(base, "pkg-cfg", { src: "export function apply(ctx) {}\n" });
  writeComposition(base, "c.yml", [
    "- id: pkg-off",
    "  name: pkg-off",
    "  disabled: true",
    "- id: pkg-cfg",
    "  name: pkg-cfg",
    "  config:",
    "    profile: web"
  ].join("\n") + "\n");
  const eco = ecoOf(base, ["c.yml"]);
  const off = eco.rows.find((r) => r.id === "pkg-off");
  const cfg = eco.rows.find((r) => r.id === "pkg-cfg");
  check("S4: disabled parsed", off && off.disabled === true, JSON.stringify(off));
  check("S4: config parsed", cfg && cfg.configPresent === true, JSON.stringify(cfg));
  const conf = checkConflicts(eco).conflicts;
  check("S4: disabled-row finding", conf.some((c) => c.type === "disabled-row" && c.severity === "info"), JSON.stringify(conf.map((c) => c.type)));
}

// ---- S5: cross-layer row override (two composition files, same row id) ----
{
  const base = fs.mkdtempSync(path.join(TMP, "x-override-"));
  writePkg(base, "pkg-ovr", { src: "export function apply(ctx) {}\n" });
  writeComposition(base, "a.yml", "- id: pkg-ovr\n  name: pkg-ovr\n");
  writeComposition(base, "b.yml", "- id: pkg-ovr\n  name: pkg-ovr\n");
  const eco = ecoOf(base, ["a.yml", "b.yml"]);
  const row = eco.rows.find((r) => r.id === "pkg-ovr");
  check("S5: row merged across layers", row && row.layers.length === 2, row && JSON.stringify(row.layers));
  const conf = checkConflicts(eco).conflicts;
  check("S5: row-override finding", conf.some((c) => c.type === "row-override" && c.severity === "info"), JSON.stringify(conf.map((c) => c.type)));
}

// ---- S6: mixed stress composition (all fixture kinds at once) ----
{
  const base = fs.mkdtempSync(path.join(TMP, "x-mixed-"));
  const kinds = [
    ["pkg-empty-a", "export function apply(ctx) {}\n"],
    ["pkg-empty-b", "export function apply(ctx) {}\n"],
    ["pkg-dup-a", 'export function apply(ctx) { ctx.tools.register(defineTool({ name: "dup_tool" })); }\n'],
    ["pkg-dup-b", 'export function apply(ctx) { ctx.tools.register(defineTool({ name: "dup_tool" })); }\n'],
    ["pkg-sca", 'export function apply(ctx) { ctx.agentCtx.tools.register(defineTool({ name: "shared_tool" })); }\n'],
    ["pkg-scb", 'export function apply(ctx) { ctx.agentCtx.tools.register(defineTool({ name: "shared_tool" })); }\n'],
    ["pkg-svc-a", 'export function apply(ctx) { ctx.service("dupSvc"); }\n'],
    ["pkg-svc-b", 'export function apply(ctx) { ctx.service("dupSvc"); }\n'],
    ["pkg-leak", "export function apply(ctx) { setInterval(fn, 1000); }\n"],
    ["pkg-clean", "export function apply(ctx) { const t = setInterval(fn, 1000); return () => clearInterval(t); }\n"]
  ];
  const rowsText = kinds.map(([n]) => "- id: " + n + "\n  name: " + n).join("\n") + "\n";
  for (const [n, src] of kinds) writePkg(base, n, { src });
  writePkg(base, "pkg-vc", { src: "export function apply(ctx) {}\n", peerDeps: { "@deepseek-ai/cordis": "^3.0.0" } });
  writePkg(base, "@deepseek-ai/cordis", { version: "4.0.1", src: "export function apply(ctx) {}\n" });
  const vcRow = "- id: pkg-vc\n  name: pkg-vc\n";
  writeComposition(base, "c.yml", rowsText + vcRow);
  const eco = ecoOf(base, ["c.yml"]);

  check("S6: all 11 rows discovered", eco.rows.length === 11, "rows=" + eco.rows.length);
  const conf = checkConflicts(eco);
  const types = new Set(conf.conflicts.map((c) => c.type));
  check("S6: tool-collision present", types.has("tool-collision"), JSON.stringify([...types]));
  check("S6: scoped-variant present", types.has("tool-name-scoped-variant"), JSON.stringify([...types]));
  check("S6: service-collision present", types.has("service-collision"), JSON.stringify([...types]));
  check("S6: version-conflict present", types.has("version-conflict"), JSON.stringify([...types]));
  assertConsistent("S6", conf);
  const leaks = scanLeaks(eco.packages).findings;
  check("S6: leak-suspect present", leaks.some((f) => f.kind === "leak-suspect"), JSON.stringify(leaks.map((f) => f.kind)));
  check("S6: clean plugin not flagged", !leaks.some((f) => f.package === "pkg-clean" && f.kind === "leak-suspect"), "ok");
  check("S6: scope scan completes", Object.keys(scanScopeHints(eco.packages)).length === 11, "hints=" + Object.keys(scanScopeHints(eco.packages)).length);
}

// ---- S7: randomized subset sampling (exploratory) ----
{
  const base = fs.mkdtempSync(path.join(TMP, "x-random-"));
  const pool = [
    ["pkg-r1", "export function apply(ctx) {}\n", {}],
    ["pkg-r2", 'export function apply(ctx) { ctx.tools.register(defineTool({ name: "rt" })); }\n', {}],
    ["pkg-r3", 'export function apply(ctx) { ctx.tools.register(defineTool({ name: "rt" })); }\n', {}],
    ["pkg-r4", 'export function apply(ctx) { ctx.service("rSvc"); }\n', {}],
    ["pkg-r5", 'export function apply(ctx) { ctx.service("rSvc"); }\n', {}],
    ["pkg-r6", "export function apply(ctx) { setInterval(fn, 1); }\n", {}]
  ];
  for (const [n, src] of pool) writePkg(base, n, { src });
  let crashes = 0, badConsistency = 0, runs = 60;
  for (let i = 0; i < runs; i++) {
    // deterministic pseudo-random subset
    const subset = pool.filter((_, j) => ((i * 31 + j * 7) % 5) !== 0);
    const rows = subset.map(([n]) => "- id: " + n + "\n  name: " + n).join("\n") + "\n";
    writeComposition(base, "s.yml", rows);
    try {
      const eco = ecoOf(base, ["s.yml"]);
      const conf = checkConflicts(eco);
      scanLeaks(eco.packages);
      scanScopeHints(eco.packages);
      scanToolNames(eco.packages);
      const byType = {};
      for (const c of conf.conflicts) byType[c.type] = (byType[c.type] || 0) + 1;
      if (conf.summary.total !== conf.conflicts.length || JSON.stringify(conf.summary.byType) !== JSON.stringify(byType)) badConsistency++;
    } catch (e) { crashes++; results.push("FAIL  S7: run #" + i + " crashed: " + e.message); }
  }
  check("S7: no crashes in " + runs + " random subsets", crashes === 0, "crashes=" + crashes);
  check("S7: all subsets summary-consistent", badConsistency === 0, "bad=" + badConsistency);
}

fs.rmSync(TMP, { recursive: true, force: true });

const lines = ["# 空插件探索性测试（exploratory-empty）", "", "## 结果：" + passed + " 通过 / " + failed + " 失败", "", "### 场景", "", "S1 空组合（0 行）· S2 单空插件 · S3 缺失 manifest · S4 disabled/config 行", "S5 跨层 row-override · S6 混合压力组合（12 插件全冲突类型）· S7 随机子集采样 ×60", "", "---"];
for (const r of results) lines.push(r);
lines.push("---");
console.log(lines.join("\n"));
console.log("\nSUMMARY:", passed, "passed,", failed, "failed");
const reportDir = path.join(ROOT, "reports");
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, "exploratory-empty-results.md"), lines.join("\n") + "\n", "utf8");
process.exit(failed ? 1 : 0);