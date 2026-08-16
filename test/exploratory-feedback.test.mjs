// dsh-forge/test/exploratory-feedback.test.mjs
// 深度探索性测试：围绕「统一错误反馈体系」做随机组合压力验证。
// 随机生成插件池（工具名 / 服务名 / 版本 / 泄漏模式随机组合），
// 多轮随机组合 -> collectEcosystem -> checkConflicts -> scanLeaks -> buildFeedback，
// 强校验：feedback 结构合法、分级计数与冲突/泄漏来源一致、按 severity 排序稳定、
// 确定性（同输入两次一致）、空组合仅剩 calibration 声明。
import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "../core/index.js";
import { buildFeedback, preflight, renderFeedback, SEVERITY_ORDER } from "../core/index.js";

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

const TOOLS = ["alpha_tool", "beta_tool", "gamma_tool", "delta_tool"];
const SVCS = ["alphaSvc", "betaSvc", "gammaSvc"];
const VERS = ["^0.1.0", "^0.2.0", "^1.0.0", "^2.0.0", "^3.0.0"];
const INSTALLED = ["1.0.0", "0.3.0", "2.1.0", "0.1.5"];

function writePkg(base, name, { src, version = "1.0.0", peerDeps = {} } = {}) {
  const dir = path.join(base, "node_modules", ...name.split("/"));
  fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version, type: "module", main: "lib/index.js", peerDependencies: peerDeps }, null, 2), "utf8");
  if (src !== undefined) fs.writeFileSync(path.join(dir, "lib", "index.js"), src, "utf8");
  return dir;
}
function ecoOf(base, rowsText) {
  const f = path.join(base, "composition.yml");
  fs.writeFileSync(f, rowsText, "utf8");
  return core.collectEcosystem({ root: path.join(base, "node_modules"), compositionFiles: [f] });
}
// 确定性伪随机（避免 Math.random 不可复现）
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 每个包注册 tool + service + 可选 peerDep；tool/service 从池中取（会命中重复）
function makePackage(base, id, rnd) {
  const tool = TOOLS[Math.floor(rnd() * TOOLS.length)];
  const svc = SVCS[Math.floor(rnd() * SVCS.length)];
  const useSvc = rnd() > 0.3;
  const src = "export function apply(ctx) { ctx.tools.register(defineTool({ name: \"" + tool + "\" }));" +
    (useSvc ? " ctx.service(\"" + svc + "\");" : "") + " }\n";
  let peerDeps = {};
  if (rnd() > 0.6) peerDeps["@deepseek-ai/cordis"] = VERS[Math.floor(rnd() * VERS.length)];
  writePkg(base, id, { src, version: INSTALLED[Math.floor(rnd() * INSTALLED.length)], peerDeps });
}

// 一致性校验器：feedback 分级计数必须与冲突/泄漏来源吻合
function validateRun(tag, eco) {
  const result = core.checkConflicts(eco, {});
  const leaks = core.scanLeaks(eco.packages);
  const fb = buildFeedback({ conflicts: result, leaks, assessment: { health: "x" }, patterns: [], verified: [] });

  // 结构合法
  const legal = fb.every((f) => /^FORGE-\d{3}$/.test(f.code) && ["fatal", "error", "warning", "info"].includes(f.severity));
  check(tag + ": all feedback codes/sevs legal", legal, legal ? "ok" : JSON.stringify(fb));

  // 排序稳定
  const order = fb.map((f) => SEVERITY_ORDER[f.severity]);
  check(tag + ": sorted by severity asc", order.every((s, i) => i === 0 || order[i - 1] <= s), order.join(","));

  // error 计数 == 非 info 的 contract 冲突数（tool/service/other contract）
  const contractNonInfo = (result.conflicts || []).filter((c) => c.kind === "contract" && c.severity !== "info").length;
  const errCount = fb.filter((f) => f.severity === "error").length;
  check(tag + ": error count == non-info contract count", errCount === contractNonInfo, "err=" + errCount + " contract=" + contractNonInfo);

  // warning 计数 == heuristic(非info) + leak-suspect + drift
  const warnExpect = (result.conflicts || []).filter((c) => c.kind === "heuristic" && c.severity !== "info").length +
    leaks.findings.filter((l) => l.kind === "leak-suspect").length;
  const warnCount = fb.filter((f) => f.severity === "warning").length;
  check(tag + ": warning count matches sources", warnCount === warnExpect, "warn=" + warnCount + " expect=" + warnExpect);

  // calibration 恒存在
  check(tag + ": calibration FORGE-014 present", fb.some((f) => f.code === "FORGE-014"));

  // 确定性：同输入两次完全一致
  const fb2 = buildFeedback({ conflicts: core.checkConflicts(eco, {}), leaks: core.scanLeaks(eco.packages), assessment: { health: "x" }, patterns: [], verified: [] });
  check(tag + ": deterministic (same input twice)", JSON.stringify(fb.map((f) => f.code + f.severity)) === JSON.stringify(fb2.map((f) => f.code + f.severity)));

  return { fb, result, leaks };
}

// ---- F1: 空组合 -> 仅 calibration ----
{
  const base = fs.mkdtempSync(path.join(TMP, "f-empty-"));
  const eco = ecoOf(base, "[]\n");
  const fb = buildFeedback({ conflicts: core.checkConflicts(eco, {}), leaks: core.scanLeaks(eco.packages), assessment: null, patterns: [], verified: [] });
  check("F1: empty -> only calibration", fb.length === 1 && fb[0].code === "FORGE-014", fb.map((f) => f.code).join(","));
  const pf = preflight(eco);
  check("F1: empty -> preflight fatal FORGE-002", pf.fatal.length === 1 && pf.fatal[0].code === "FORGE-002", pf.fatal.map((f) => f.code).join(","));
}

// ---- F2: 固定 12 插件组合（确定性种子）-> 强一致性 ----
{
  const base = fs.mkdtempSync(path.join(TMP, "f-fixed-"));
  const rnd = mulberry32(20260815);
  const ids = [];
  for (let i = 0; i < 12; i++) { const id = "pkg-" + i; makePackage(base, id, rnd); ids.push(id); }
  const eco = ecoOf(base, ids.map((id) => "- id: " + id + "\n  name: " + id).join("\n"));
  const { fb } = validateRun("F2", eco);
  check("F2: feedback non-trivial", fb.length >= 2, "count=" + fb.length);
  check("F2: renderFeedback renders", typeof renderFeedback(fb) === "string" && renderFeedback(fb).length > 0, renderFeedback(fb).length);
}

// ---- F3: 随机种子多轮（确定性，每种子 40 包，30 轮） ----
{
  let crash = 0, bad = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const base = fs.mkdtempSync(path.join(TMP, "f-rnd-"));
    const rnd = mulberry32(seed * 7919);
    const ids = [];
    for (let i = 0; i < 40; i++) { const id = "pkg-" + seed + "-" + i; makePackage(base, id, rnd); ids.push(id); }
    try {
      const eco = ecoOf(base, ids.map((id) => "- id: " + id + "\n  name: " + id).join("\n"));
      const r = validateRun("F3#" + seed, eco);
      if (!r) bad++;
    } catch (e) { crash++; }
  }
  check("F3: 30 random seeds no crash", crash === 0, "crashes=" + crash);
  check("F3: 30 random seeds all consistent", bad === 0, "bad=" + bad);
}

// ---- F4: 随机子集采样（从固定池随机抽子集，60 次） ----
{
  const base = fs.mkdtempSync(path.join(TMP, "f-sub-"));
  const rnd = mulberry32(424242);
  const ids = [];
  for (let i = 0; i < 20; i++) { const id = "sub-" + i; makePackage(base, id, rnd); ids.push(id); }
  let crash = 0, bad = 0;
  for (let i = 0; i < 60; i++) {
    const subset = ids.filter((_, j) => ((i * 31 + j * 7) % 5) !== 0);
    try {
      const eco = ecoOf(base, subset.map((id) => "- id: " + id + "\n  name: " + id).join("\n"));
      const r = validateRun("F4#" + i, eco);
      if (!r) bad++;
    } catch (e) { crash++; }
  }
  check("F4: 60 random subsets no crash", crash === 0, "crashes=" + crash);
  check("F4: 60 random subsets all consistent", bad === 0, "bad=" + bad);
}

// ---- F5: 极端组合（全同名 tool + 全同名 service + 版本冲突 + 泄漏） ----
{
  const base = fs.mkdtempSync(path.join(TMP, "f-extreme-"));
  for (let i = 0; i < 6; i++) writePkg(base, "x-" + i, { src: "export function apply(ctx) { ctx.tools.register(defineTool({ name: \"same_tool\" })); ctx.service(\"sameSvc\"); setInterval(function(){}, 1000); }\n", peerDeps: { "@deepseek-ai/cordis": "^3.0.0" } });
  const eco = ecoOf(base, Array.from({ length: 6 }, (_, i) => "- id: x-" + i + "\n  name: x-" + i).join("\n"));
  const { fb } = validateRun("F5", eco);
  check("F5: tool-collision error present", fb.some((f) => f.code === "FORGE-006"), fb.map((f) => f.code).join(","));
  check("F5: service-collision error present", fb.some((f) => f.code === "FORGE-007"), fb.map((f) => f.code).join(","));
  check("F5: leak warning present", fb.some((f) => f.code === "FORGE-008"), fb.map((f) => f.code).join(","));
}

fs.rmSync(TMP, { recursive: true, force: true });

const lines = ["# 错误反馈深度探索性测试（exploratory-feedback）", "", "## 结果：" + passed + " 通过 / " + failed + " 失败", "", "### 场景", "", "F1 空组合 -> 仅 calibration + preflight fatal", "F2 固定 12 插件（确定性种子）-> 强一致性 + render 输出", "F3 30 个随机种子 x 40 插件 -> 无崩溃且分级计数与冲突/泄漏来源一致", "F4 60 次随机子集采样 -> 无崩溃且一致", "F5 极端组合（全同名 tool + service + 版本冲突 + 泄漏）-> 三类发现齐全", "", "### 强校验", "", "- feedback 全部合法 code（FORGE-NNN）/ 合法 severity", "- 按 severity 升序稳定排序", "- error 计数 == 非 info 的 contract 冲突数", "- warning 计数 == heuristic(非info) + leak-suspect + drift 数", "- calibration FORGE-014 恒存在", "- 同输入两次结果完全一致（确定性）", "", "---"];
for (const r of results) lines.push(r);
lines.push("---");
console.log(lines.join("\n"));
console.log("\nSUMMARY:", passed, "passed,", failed, "failed");

const reportDir = path.join(ROOT, "reports");
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, "exploratory-feedback-results.md"), lines.join("\n") + "\n", "utf8");

process.exit(failed ? 1 : 0);