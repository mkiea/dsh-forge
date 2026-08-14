// dsh-forge/test/review-fixes.test.mjs
// Self-contained tests for the reviewer-fix modules: scope-aware collision
// classification, runtime calibration from mocked events, apply-path leak
// slicing. No machine paths, no live harness required.
import * as fs from "node:fs";
import * as path from "node:path";
import { classifyCollision, scanScopeHints } from "../core/scope.js";
import { createCalibration, staticCalibration } from "../core/calibration.js";
import { scanLeaks } from "../core/leaks.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

// 1) scope-aware collision classification
const hintsAllScoped = { a: { hint: "scoped" }, b: { hint: "scoped" } };
const hintsMixed = { a: { hint: "global" }, b: { hint: "scoped" } };
const hintsAllGlobal = { a: { hint: "global" }, b: { hint: "global" } };
const c1 = classifyCollision("tool_x", ["a", "b"], hintsAllScoped);
check("all-scoped -> scoped-variant", c1.kind === "scoped-variant", c1.kind);
const c2 = classifyCollision("tool_x", ["a", "b"], hintsMixed);
check("mixed -> contract", c2.kind === "contract", c2.kind);
const c3 = classifyCollision("tool_x", ["a", "b"], hintsAllGlobal);
check("all-global -> contract", c3.kind === "contract", c3.kind);

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const TMP_ROOT = path.join(ROOT, ".tmp-tests");
fs.rmSync(TMP_ROOT, { recursive: true, force: true });
fs.mkdirSync(TMP_ROOT, { recursive: true });
const base = fs.mkdtempSync(path.join(TMP_ROOT, "case-"));
fs.mkdirSync(path.join(base, "pkg-a", "lib"), { recursive: true });
fs.mkdirSync(path.join(base, "pkg-b", "lib"), { recursive: true });
fs.writeFileSync(path.join(base, "pkg-a", "lib", "index.js"), "function apply(ctx) { ctx.agentCtx.tools.register(defineTool({name:'x'})); }", "utf8");
fs.writeFileSync(path.join(base, "pkg-b", "lib", "index.js"), "export function apply(ctx) { ctx.tools.register(defineTool({name:'x'})); }", "utf8");
const pkgs = { "pkg-a": { dir: path.join(base, "pkg-a") }, "pkg-b": { dir: path.join(base, "pkg-b") } };
const hints = scanScopeHints(pkgs);
check("scope scan detects scoped package", hints["pkg-a"] && hints["pkg-a"].hint !== "global", JSON.stringify(hints["pkg-a"]));
check("scope scan marks global package", hints["pkg-b"] && hints["pkg-b"].hint === "global", hints["pkg-b"] && hints["pkg-b"].hint);

// 2) runtime calibration from mocked events
let listener = null;
const mockCtx = { on(ev, fn) { if (ev === "session/event") listener = fn; return () => { listener = null; }; } };
const cal = createCalibration(mockCtx);
check("calibration subscribes", cal.available === true);
if (listener) {
  listener({ event: { type: "tool/call", data: { tool: "analyze" } } });
  listener({ event: { type: "tool/call", data: { tool: "analyze" } } });
  listener({ event: { type: "tool/call", data: { tool: "check" } } });
  listener({ event: { type: "tool/result", data: { tool: "analyze", ok: true } } });
  listener({ event: { type: "tool/result", data: { tool: "check", ok: false, error: "boom" } } });
  listener({ event: { type: "turn/end", data: {} } });
}
const snap = cal.snapshot();
check("calibration counts tool calls", snap.toolCalls === 3, "calls=" + snap.toolCalls);
check("calibration counts failures", snap.toolFailures === 1, "fails=" + snap.toolFailures);
check("calibration failure rate", snap.toolFailureRate === 33.3, "rate=" + snap.toolFailureRate);
check("calibration counts turns", snap.turns === 1, "turns=" + snap.turns);
check("calibration topTools", snap.topTools.length === 2 && snap.topTools[0].tool === "analyze", JSON.stringify(snap.topTools));
cal.dispose();
const stc = staticCalibration();
check("static calibration honest", stc.snapshot().available === false && stc.snapshot().toolFailureRate === null);

// 3) apply-path leak slicing
fs.mkdirSync(path.join(base, "pkg-l", "lib"), { recursive: true });
fs.writeFileSync(path.join(base, "pkg-l", "lib", "index.js"), "function apply(ctx) { setInterval(fn, 1000); ctx.effect(() => {}); }", "utf8");
const leakPkgs = { "pkg-l": { dir: path.join(base, "pkg-l") } };
const probeFiles = [];
(function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) w(q); else if (e.name.endsWith(".js")) probeFiles.push(q); } })(path.join(base, "pkg-l", "lib"));

const fnSrc = scanLeaks.toString();
const leak = scanLeaks(leakPkgs);
const suspect = leak.findings.find((f) => f.kind === "leak-suspect" && f.package === "pkg-l");
check("leak suspect found in apply file", !!suspect, suspect ? suspect.message : "none");
check("leak evidence has location", suspect && suspect.evidence.includes("index.js"), suspect && suspect.evidence);
fs.writeFileSync(path.join(base, "pkg-l", "lib", "index.js"), "function apply(ctx) { const t = setInterval(fn, 1000); return () => clearInterval(t); }", "utf8");
const leak2 = scanLeaks(leakPkgs);
const suspect2 = leak2.findings.find((f) => f.kind === "leak-suspect" && f.package === "pkg-l");
check("cleanup present -> no leak-suspect", !suspect2, suspect2 ? suspect2.message : "ok");

fs.rmSync(base, { recursive: true, force: true });

const lines = ["# 审视修复测试（review-fixes）", "", "## 结果：" + passed + " 通过 / " + failed + " 失败", "", "---"];
for (const r of results) lines.push(r);
lines.push("---");
console.log(lines.join("\n"));
console.log("\nSUMMARY:", passed, "passed,", failed, "failed");
process.exit(failed ? 1 : 0);
