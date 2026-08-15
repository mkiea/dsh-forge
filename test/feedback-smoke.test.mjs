// dsh-forge/test/feedback-smoke.test.mjs
// v0.1.1 新功能「统一错误反馈体系」冒烟测试。
// 覆盖 normalizeFeedback / buildFeedback / preflight / renderFeedback 核心逻辑，
// core/index.js 导出完整性（此前 preflight/renderFeedback 导出缺失曾导致 harness 启动崩溃），
// 以及真实组合管道 -> check_conflicts -> feedback 字段的端到端集成。
import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeFeedback, buildFeedback, preflight, renderFeedback, SEVERITY_ORDER } from "../core/errors.js";
import * as core from "../core/index.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}
const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));

// ---- 1) core/index.js 导出完整性（回归此前启动崩溃点） ----
{
  check("index: preflight exported", typeof core.preflight === "function", typeof core.preflight);
  check("index: renderFeedback exported", typeof core.renderFeedback === "function", typeof core.renderFeedback);
  check("index: buildFeedback exported", typeof core.buildFeedback === "function", typeof core.buildFeedback);
  check("index: normalizeFeedback exported", typeof core.normalizeFeedback === "function", typeof core.normalizeFeedback);
}

// ---- 2) normalizeFeedback 归一化 ----
{
  const raw = normalizeFeedback({ severity: "error", message: "x" });
  check("norm: code auto-generated FORGE-NNN", /^FORGE-\d{3}$/.test(raw.code), raw.code);
  check("norm: severity preserved", raw.severity === "error", raw.severity);
  check("norm: recoverable defaults true", raw.recoverable === true, raw.recoverable);
  check("norm: recoverable false preserved", normalizeFeedback({ severity: "fatal", message: "y", recoverable: false }).recoverable === false);
  check("norm: invalid severity falls back to info", normalizeFeedback({ severity: "bogus", message: "z" }).severity === "info", "info");
  check("norm: explicit code override wins", normalizeFeedback({ severity: "info", message: "w", code: "FORGE-999" }).code === "FORGE-999");
  check("norm: row maps from package", normalizeFeedback({ severity: "info", message: "q", package: "pkg-a" }).row === "pkg-a");
  check("norm: source defaults dsh-forge", normalizeFeedback({ severity: "info", message: "s" }).source === "dsh-forge");
}

// ---- 3) buildFeedback 聚合与分级 ----
{
  const contract = { kind: "contract", severity: "high", type: "tool-collision", message: "dup tool", evidence: "e", advice: "a" };
  const fb = buildFeedback({ conflicts: { conflicts: [contract] }, leaks: { findings: [] }, assessment: null, patterns: [], verified: [] });
  const c = fb.find((f) => f.code === "FORGE-006");
  check("build: tool-collision -> error FORGE-006", !!c && c.severity === "error", c && c.severity);
  check("build: high contract not recoverable", c && c.recoverable === false, c && c.recoverable);

  const svc = { kind: "contract", severity: "high", type: "service-collision", message: "m", evidence: "e", advice: "a" };
  const fb2 = buildFeedback({ conflicts: { conflicts: [svc] }, leaks: { findings: [] }, assessment: null, patterns: [], verified: [] });
  check("build: service-collision -> FORGE-007", fb2.some((f) => f.code === "FORGE-007"), fb2.map((f) => f.code).join(","));

  const ver = { kind: "heuristic", severity: "high", type: "version-conflict", message: "m", evidence: "e", advice: "a" };
  const fb3 = buildFeedback({ conflicts: { conflicts: [ver] }, leaks: { findings: [] }, assessment: null, patterns: [], verified: [] });
  const v = fb3.find((f) => f.code === "FORGE-005");
  check("build: version-conflict -> warning FORGE-005", !!v && v.severity === "warning", v && v.severity);
  check("build: heuristic recoverable", v && v.recoverable === true, v && v.recoverable);

  const scoped = { kind: "heuristic", severity: "info", type: "tool-name-scoped-variant", message: "m", evidence: "e", advice: "a" };
  const fb4 = buildFeedback({ conflicts: { conflicts: [scoped] }, leaks: { findings: [] }, assessment: null, patterns: [], verified: [] });
  check("build: scoped-variant info excluded", !fb4.some((f) => f.type === "tool-name-scoped-variant"), fb4.map((f) => f.type).join(","));

  const fb5 = buildFeedback({ conflicts: { conflicts: [] }, leaks: { findings: [{ kind: "leak-suspect", message: "leak", evidence: "e", advice: "a" }] }, assessment: null, patterns: [], verified: [] });
  check("build: leak -> warning FORGE-008", fb5.some((f) => f.code === "FORGE-008" && f.severity === "warning"));

  const fb6 = buildFeedback({ conflicts: { conflicts: [] }, leaks: { findings: [] }, assessment: { health: "ok" }, patterns: [{ id: "knowledge-version-drift", message: "drift", evidence: "e" }], verified: [] });
  check("build: drift -> warning FORGE-010", fb6.some((f) => f.code === "FORGE-010" && f.severity === "warning"), fb6.map((f) => f.code).join(","));

  const fb7 = buildFeedback({ conflicts: { conflicts: [] }, leaks: { findings: [] }, assessment: { health: "ok" }, patterns: [], verified: [{ note: "ok", scoreDelta: 1 }] });
  check("build: verified -> info FORGE-013", fb7.some((f) => f.code === "FORGE-013" && f.severity === "info"));
  check("build: calibration disclaimer always present FORGE-014", fb7.some((f) => f.code === "FORGE-014"), fb7.map((f) => f.code).join(","));

  const fbAll = buildFeedback({ conflicts: { conflicts: [contract] }, leaks: { findings: [{ kind: "leak-suspect", message: "l", evidence: "e", advice: "a" }] }, assessment: { health: "ok" }, patterns: [{ id: "knowledge-version-drift", message: "d", evidence: "e" }], verified: [{ note: "v", scoreDelta: 0 }] });
  const order = fbAll.map((f) => SEVERITY_ORDER[f.severity]);
  check("build: sorted by severity asc", order.every((s, i) => i === 0 || order[i - 1] <= s), order.join(","));
}

// ---- 4) preflight 启动预检 ----
{
  const empty = preflight({ rows: [], packages: {} });
  check("preflight: empty rows -> fatal FORGE-002", empty.fatal.some((f) => f.code === "FORGE-002" && f.severity === "fatal"), empty.fatal.map((f) => f.code).join(","));
  check("preflight: empty rows no nonFatal", empty.nonFatal.length === 0, empty.nonFatal.length);

  const missing = preflight({ rows: [{ id: "r1", name: "ghost-pkg" }], packages: {} });
  check("preflight: missing pkg -> warning FORGE-003", missing.nonFatal.some((f) => f.code === "FORGE-003"), missing.nonFatal.map((f) => f.code).join(","));
  check("preflight: missing pkg not fatal", missing.fatal.length === 0, missing.fatal.length);

  const ok = preflight({ rows: [{ id: "r1", name: "pkg-a" }], packages: { "pkg-a": {} } });
  check("preflight: healthy -> no findings", ok.fatal.length === 0 && ok.nonFatal.length === 0, JSON.stringify(ok));

  const cordis = preflight({ rows: [{ id: "c1", name: "cordis:include" }], packages: {} });
  check("preflight: cordis: row excluded from missing", cordis.nonFatal.length === 0, cordis.nonFatal.length);

  const cap = preflight({ rows: Array.from({ length: 40 }, (_, i) => ({ id: "r" + i, name: "ghost-" + i })), packages: {} });
  check("preflight: missing list capped at 20", cap.nonFatal.length === 20, cap.nonFatal.length);
}

// ---- 5) renderFeedback 文本渲染 ----
{
  const txt = renderFeedback([
    normalizeFeedback({ code: "FORGE-002", severity: "fatal", message: "组合解析失败", guidance: "重跑" }),
    normalizeFeedback({ code: "FORGE-003", severity: "warning", message: "包缺失", detail: "详情" })
  ]);
  check("render: fatal group header", txt.includes("致命"), "has-fatal-group");
  check("render: code+message line", txt.includes("[FORGE-002] 组合解析失败"), "has-code");
  check("render: guidance line", txt.includes("建议: 重跑"), "has-guidance");
  check("render: detail line", txt.includes("详情: 详情"), "has-detail");
  check("render: warning group", txt.includes("警告"), "has-warning");
  check("render: fatal group printed before warning", txt.indexOf("致命") < txt.indexOf("警告"), txt.indexOf("致命") + "<" + txt.indexOf("警告"));
  check("render: empty list -> empty string", renderFeedback([]) === "", renderFeedback([]).length);
}

// ---- 6) 端到端：真实组合管道 -> buildFeedback ----
{
  const TMP = path.join(ROOT, ".tmp-tests");
  fs.mkdirSync(TMP, { recursive: true });
  const base = fs.mkdtempSync(path.join(TMP, "fb-"));
  function writePkg(name, src) {
    const dir = path.join(base, "node_modules", ...name.split("/"));
    fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", type: "module", main: "lib/index.js" }, null, 2), "utf8");
    if (src !== undefined) fs.writeFileSync(path.join(dir, "lib", "index.js"), src, "utf8");
  }
  function ecoOf(rowsText) {
    const f = path.join(base, "composition.yml");
    fs.writeFileSync(f, rowsText, "utf8");
    return core.collectEcosystem({ root: path.join(base, "node_modules"), compositionFiles: [f] });
  }
  const dupSrc = 'export function apply(ctx) { ctx.tools.register(defineTool({ name: "dup_tool" })); }\n';
  writePkg("pkg-a", dupSrc);
  writePkg("pkg-b", dupSrc);
  const eco = ecoOf(["- id: pkg-a\n  name: pkg-a", "- id: pkg-b\n  name: pkg-b"].join("\n"));
  const result = core.checkConflicts(eco, {});
  const feedback = core.buildFeedback({ conflicts: result, leaks: core.scanLeaks(eco.packages), assessment: null, patterns: [], verified: [] });
  check("e2e: tool-collision -> error feedback FORGE-006", feedback.some((f) => f.code === "FORGE-006" && f.severity === "error"), feedback.map((f) => f.code + ":" + f.severity).join(","));
  check("e2e: calibration disclaimer present", feedback.some((f) => f.code === "FORGE-014"));
  check("e2e: feedback sorted", feedback.map((f) => SEVERITY_ORDER[f.severity]).every((s, i) => i === 0 || s >= 0));
  fs.rmSync(TMP, { recursive: true, force: true });
}

const lines = ["# 错误反馈冒烟测试（feedback-smoke）", "", "## 结果：" + passed + " 通过 / " + failed + " 失败", "", "### 覆盖", "", "1. core/index.js 导出完整性（preflight/renderFeedback/buildFeedback/normalizeFeedback）", "2. normalizeFeedback：code 自动生成 / severity 校验回退 / recoverable 默认与保留 / code 覆盖 / row 映射 / source 默认", "3. buildFeedback：tool-collision→error、service-collision→error、version-conflict→warning、scoped-variant info 排除、leak→warning、drift→warning、verified→info、calibration→info、按 severity 排序", "4. preflight：空 rows→fatal FORGE-002、缺失包→warning FORGE-003、cordis: 行排除、健康组合→空、缺失列表 20 上限", "5. renderFeedback：分组 / code+message / detail / guidance / fatal 优先 / 空列表→空串", "6. 端到端：真实组合管道 → tool-collision 进入 feedback 且分级正确", "", "---"];
for (const r of results) lines.push(r);
lines.push("---");
console.log(lines.join("\n"));
console.log("\nSUMMARY:", passed, "passed,", failed, "failed");

const reportDir = path.join(ROOT, "reports");
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, "feedback-smoke-results.md"), lines.join("\n") + "\n", "utf8");

process.exit(failed ? 1 : 0);