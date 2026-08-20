// dsh-forge/test/empty-plugins.test.mjs
// Self-contained regression tests built around two EMPTY plugins and
// "conflicting empty" plugins (minimal packages that only carry a single
// conflict surface). No machine paths, no live harness required: fixtures are
// generated on the fly under .tmp-tests and composed through the same
// collectEcosystem pipeline the host plugin uses (composition -> manifests ->
// conflicts / leaks / scope).
import * as fs from "node:fs";
import * as path from "node:path";
import { collectEcosystem } from "../core/composition.js";
import { checkConflicts, scanToolNames } from "../core/conflicts.js";
import { scanLeaks } from "../core/leaks.js";
import { scanScopeHints, classifyCollision } from "../core/scope.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const TMP_ROOT = path.join(ROOT, ".tmp-tests");
fs.rmSync(TMP_ROOT, { recursive: true, force: true });
fs.mkdirSync(TMP_ROOT, { recursive: true });

// ---- fixture builders ----
// Write one package under base/node_modules/<name> with a package.json
// manifest and an optional lib/index.js source. "Empty" means: no deps, no
// peer deps, and an apply() that does nothing.
function writePkg(base, name, { src, deps = {}, peerDeps = {}, version = "1.0.0" } = {}) {
  const dir = path.join(base, "node_modules", ...name.split("/"));
  fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name, version,
    description: "fixture for dsh-forge empty/conflict tests",
    type: "module",
    main: "lib/index.js",
    dependencies: deps,
    peerDependencies: peerDeps
  }, null, 2), "utf8");
  if (src !== undefined) fs.writeFileSync(path.join(dir, "lib", "index.js"), src, "utf8");
  return dir;
}

// Write the composition patch document listing the composed rows.
function writeComposition(base, rowsText) {
  const f = path.join(base, "composition.yml");
  fs.writeFileSync(f, rowsText, "utf8");
  return f;
}

function ecoOf(base, rowsText) {
  const f = writeComposition(base, rowsText);
  return collectEcosystem({ root: path.join(base, "node_modules"), compositionFiles: [f] });
}

const rowsFor = (...ids) => ids.map((id) => "- id: " + id + "\n  name: " + id).join("\n");

// ---- Scenario 1: two empty plugins ----
{
  const base = fs.mkdtempSync(path.join(TMP_ROOT, "empty-"));
  writePkg(base, "pkg-empty-a", { src: "export function apply(ctx) {}\n" });
  writePkg(base, "pkg-empty-b", { src: "export function apply(ctx) {}\n" });
  const eco = ecoOf(base, rowsFor("pkg-empty-a", "pkg-empty-b"));

  check("empty: composition discovers 2 rows", eco.rows.length === 2, "rows=" + eco.rows.length);
  check("empty: both manifests resolved", Object.keys(eco.packages).sort().join(",") === "pkg-empty-a,pkg-empty-b", Object.keys(eco.packages).sort().join(","));
  check("empty: no tool registrations", Object.keys(scanToolNames(eco.packages)).filter((k) => k !== "__dynamicRegistrationHint" && k !== "__dynamicPackages").length === 0, JSON.stringify(scanToolNames(eco.packages)));
  check("empty: no scope markers", Object.values(scanScopeHints(eco.packages)).every((h) => h.hint === "global"), JSON.stringify(scanScopeHints(eco.packages)));

  const conf = checkConflicts(eco).conflicts;
  const hardTypes = conf.map((c) => c.type).filter((t) => ["version-conflict", "tool-collision", "tool-name-scoped-variant", "service-collision", "missing-provider"].includes(t));
  check("empty: zero hard conflicts", hardTypes.length === 0, "hard=" + hardTypes.join(",") + " total=" + conf.length);
  check("empty: conflict summary consistent", conf.length === checkConflicts(eco).summary.total, "total=" + conf.length);

  const leaks = scanLeaks(eco.packages).findings;
  check("empty: zero leak findings", leaks.length === 0, "leaks=" + leaks.length);
}

// ---- Scenario 2: conflicting empty plugins -- same tool name (global) ----
{
  const base = fs.mkdtempSync(path.join(TMP_ROOT, "dup-tool-"));
  const src = 'export function apply(ctx) { ctx.tools.register(defineTool({ name: "dup_tool" })); }\n';
  writePkg(base, "pkg-dup-a", { src });
  writePkg(base, "pkg-dup-b", { src });
  const eco = ecoOf(base, rowsFor("pkg-dup-a", "pkg-dup-b"));

  const toolNames = scanToolNames(eco.packages);
  check("dup-tool: same name scanned from both", toolNames["pkg-dup-a"] && toolNames["pkg-dup-b"] && toolNames["pkg-dup-a"][0] === "dup_tool" && toolNames["pkg-dup-b"][0] === "dup_tool", JSON.stringify(toolNames));
  check("dup-tool: classified as global contract", classifyCollision("dup_tool", ["pkg-dup-a", "pkg-dup-b"], scanScopeHints(eco.packages)).kind === "contract", classifyCollision("dup_tool", ["pkg-dup-a", "pkg-dup-b"], scanScopeHints(eco.packages)).kind);

  const hit = checkConflicts(eco).conflicts.find((c) => c.type === "tool-collision");
  check("dup-tool: tool-collision detected", !!hit, hit ? hit.message : "missing");
  check("dup-tool: severity high", hit && hit.severity === "high", hit && hit.severity);
  check("dup-tool: packages listed", hit && hit.packages.sort().join(",") === "pkg-dup-a,pkg-dup-b", hit && hit.packages.join(","));
}

// ---- Scenario 3: conflicting empty plugins -- same tool name (scoped) ----
{
  const base = fs.mkdtempSync(path.join(TMP_ROOT, "dup-scoped-"));
  // agentCtx marker => per-agent scoped registration: legal variant, not a hard error
  const src = 'export function apply(ctx) { ctx.agentCtx.tools.register(defineTool({ name: "shared_tool" })); }\n';
  writePkg(base, "pkg-sca", { src });
  writePkg(base, "pkg-scb", { src });
  const eco = ecoOf(base, rowsFor("pkg-sca", "pkg-scb"));

  check("scoped: both hinted scoped", Object.values(scanScopeHints(eco.packages)).every((h) => h.hint === "scoped"), JSON.stringify(scanScopeHints(eco.packages)));
  check("scoped: classified as scoped-variant", classifyCollision("shared_tool", ["pkg-sca", "pkg-scb"], scanScopeHints(eco.packages)).kind === "scoped-variant", classifyCollision("shared_tool", ["pkg-sca", "pkg-scb"], scanScopeHints(eco.packages)).kind);

  const hit = checkConflicts(eco).conflicts.find((c) => c.type === "tool-name-scoped-variant");
  check("scoped: scoped-variant (info, not contract)", !!hit && hit.severity === "info", hit ? hit.severity : "missing");
  check("scoped: no hard tool-collision", !checkConflicts(eco).conflicts.some((c) => c.type === "tool-collision"), "ok");
}

// ---- Scenario 4: conflicting empty plugins -- same service ----
{
  const base = fs.mkdtempSync(path.join(TMP_ROOT, "dup-svc-"));
  const src = 'export function apply(ctx) { ctx.service("dupSvc"); }\n';
  writePkg(base, "pkg-svc-a", { src });
  writePkg(base, "pkg-svc-b", { src });
  const eco = ecoOf(base, rowsFor("pkg-svc-a", "pkg-svc-b"));

  const hit = checkConflicts(eco).conflicts.find((c) => c.type === "service-collision");
  check("dup-svc: service-collision detected", !!hit, hit ? hit.message : "missing");
  check("dup-svc: severity high", hit && hit.severity === "high", hit && hit.severity);
  check("dup-svc: both packages listed", hit && hit.packages.sort().join(",") === "pkg-svc-a,pkg-svc-b", hit && hit.packages.join(","));
}

// ---- Scenario 5: conflicting empty plugin -- dependency version conflict ----
{
  const base = fs.mkdtempSync(path.join(TMP_ROOT, "ver-conflict-"));
  writePkg(base, "@deepseek-ai/cordis", { version: "4.0.1", src: "export function apply(ctx) {}\n" });
  writePkg(base, "pkg-vc-a", { src: "export function apply(ctx) {}\n", peerDeps: { "@deepseek-ai/cordis": "^3.0.0" } });
  const eco = ecoOf(base, rowsFor("pkg-vc-a"));

  const hit = checkConflicts(eco).conflicts.find((c) => c.type === "version-conflict");
  check("ver-conflict: version-conflict detected", !!hit, hit ? hit.message : "missing");
  check("ver-conflict: severity high (core runtime)", hit && hit.severity === "high", hit && hit.severity);
  check("ver-conflict: evidence points at manifest", hit && hit.evidence.includes("package.json"), hit && hit.evidence);
}

// ---- Scenario 6: leak slicing on otherwise-empty plugins ----
{
  const base = fs.mkdtempSync(path.join(TMP_ROOT, "leak-"));
  writePkg(base, "pkg-leak", { src: "export function apply(ctx) { setInterval(fn, 1000); }\n" });
  writePkg(base, "pkg-clean", { src: "export function apply(ctx) { const t = setInterval(fn, 1000); return () => clearInterval(t); }\n" });
  const pkgs = { "pkg-leak": { dir: path.join(base, "node_modules", "pkg-leak") }, "pkg-clean": { dir: path.join(base, "node_modules", "pkg-clean") } };

  const suspect = scanLeaks(pkgs).findings.find((f) => f.kind === "leak-suspect" && f.package === "pkg-leak");
  check("leak: bare setInterval -> leak-suspect", !!suspect, suspect ? suspect.message : "none");
  const cleanHit = scanLeaks(pkgs).findings.find((f) => f.package === "pkg-clean" && f.kind === "leak-suspect");
  check("leak: explicit cleanup -> no leak-suspect", !cleanHit, cleanHit ? cleanHit.message : "ok");
}

fs.rmSync(TMP_ROOT, { recursive: true, force: true });

// ---- report ----
const lines = ["# 空插件 / 冲突空插件回归测试（empty-plugins）", "", "## 结果：" + passed + " 通过 / " + failed + " 失败", "", "### 覆盖场景", "", "1. 两个空插件（apply 空实现）：组合发现 / 无工具 / 无冲突 / 无泄漏", "2. 冲突空插件 · 同名工具（全局注册）→ tool-collision（contract/high）", "3. 冲突空插件 · 同名工具（agentCtx 作用域）→ scoped-variant（heuristic/info）", "4. 冲突空插件 · 同名服务 → service-collision（contract/high）", "5. 冲突空插件 · 依赖版本不满足（cordis ^3 vs 4.0.1）→ version-conflict（high）", "6. 泄漏切片：空插件裸 setInterval → leak-suspect；显式 cleanup → 无泄漏", "", "---"];
for (const r of results) lines.push(r);
lines.push("---");
console.log(lines.join("\n"));
console.log("\nSUMMARY:", passed, "passed,", failed, "failed");

const reportDir = path.join(ROOT, "reports");
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, "empty-plugin-test-results.md"), lines.join("\n") + "\n", "utf8");

process.exit(failed ? 1 : 0);