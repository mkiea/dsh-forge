// dsh-forge/test/runtime-calibration.test.mjs
// v0.1.5 P1: runtime calibration (A-4 sliding window / A-2 finding_id binding /
// INV-2 start boundary / reversibility). Uses an injecting fake ctx so the
// suite is logic-safe and runs in CI without a real Cordis runtime.
import * as path from "node:path";
import * as fs from "node:fs";
import { createRuntimeCalibration, staticRuntimeCalibration, UNOBSERVED_STATE, OBSERVED_STATES } from "../core/runtime-calibration.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}
const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));

// Fake Cordis ctx exposing on/off and an event emitter to drive it.
function makeFakeCtx() {
  const listeners = new Map();
  const offs = [];
  const ctx = {
    on(evt, handler) { (listeners.get(evt) || listeners.set(evt, []).get(evt)).push(handler); const id = offs.length; offs.push([evt, handler]); return () => ctx.off(evt, handler); },
    off(evt, handler) { const a = listeners.get(evt); if (a) { const i = a.indexOf(handler); if (i >= 0) a.splice(i, 1); } },
    emit(evt, payload) { (listeners.get(evt) || []).forEach((h) => { try { h(payload); } catch {} }); },
    listenerCount() { let n = 0; for (const a of listeners.values()) n += a.length; return n; }
  };
  ctx.offs = offs;
  return ctx;
}

// ---- 1) A-4 sliding window + cardinality cap ----
{
  const ctx = makeFakeCtx();
  const cal = createRuntimeCalibration(ctx, { windowSize: 8, cardinalityCap: 3 }).start();
  for (let i = 0; i < 20; i++) ctx.emit("tool/call", {});
  const c = cal.counters();
  check("A-4 window filled capped at 8", c.window.filled === 8, c.window.filled);
  check("A-4 cardinality distinct", c.cardinality.distinct === 1, c.cardinality.distinct);
  // cap=3: tool/call(1) + p0(2) + p1(3) -> cap reached; p2 becomes the 4th ->
  // dropped but retained counters keep counting.
  ctx.emit("plugin/apply", { data: { name: "p0" } });
  ctx.emit("plugin/apply", { data: { name: "p0" } });
  for (let i = 0; i < 2; i++) ctx.emit("plugin/apply", { data: { name: "p1" } });
  for (let i = 0; i < 2; i++) ctx.emit("plugin/apply", { data: { name: "p2" } });
  const c2 = cal.counters();
  check("A-4 distinct capped at cap (3)", c2.cardinality.distinct === 3, c2.cardinality.distinct);
  check("A-4 retained counter keeps counting (p0 retries)", c2["plugin/apply:p0"] === 2, c2["plugin/apply:p0"]);
  ctx.emit("plugin/apply", { data: { name: "p0" } });
  check("A-4 above cap new distinct dropped, retained keep counting", cal.counters().cardinality.distinct === 3 && cal.counters()["plugin/apply:p0"] === 3, cal.counters().cardinality.distinct);
  cal.dispose();
  check("A-4 reversibility: dispose clears listeners", ctx.listenerCount() === 0, ctx.listenerCount());
}

// ---- 2) INV-2 start boundary: no recording before start ----
{
  const ctx = makeFakeCtx();
  const cal = createRuntimeCalibration(ctx, {});
  ctx.emit("tool/call", {});
  check("INV-2 nothing recorded before start", cal.counters().total === undefined && cal.counters().window.filled === 0, cal.counters().window.filled);
  cal.start();
  ctx.emit("tool/call", {});
  check("INV-2 recorded after start", cal.counters()["tool/call"] === 1, cal.counters()["tool/call"]);
  cal.dispose();
}

// ---- 3) A-2 finding_id -> observeState mapping ----
{
  const ctx = makeFakeCtx();
  const cal = createRuntimeCalibration(ctx, {}).start();
  // a finding for a package that never activated -> not-executed
  const f = { package: "never-pkg", scope: "s", type: "t", severity: "medium", confidence: "low", evidence: "e" };
  const ev = cal.evidence([f]);
  const id = f.finding_id;
  check("A-1 unactivated package -> not-executed", ev[id] === "not-executed", ev[id]);
  // activate then clean
  ctx.emit("plugin/apply", { data: { name: "act-pkg" } });
  check("A-1 activated clean -> executed-clean", cal.observeState({ package: "act-pkg" }) === "executed-clean");
  // mark residual
  cal.markResidual("act-pkg");
  check("A-1 residual mark wins -> executed-residual", cal.observeState({ package: "act-pkg" }) === "executed-residual");
  cal.dispose();
}

// ---- 4) lifecycle counters (plugin/apply, plugin/dispose, tool failure) ----
{
  const ctx = makeFakeCtx();
  const cal = createRuntimeCalibration(ctx, {}).start();
  ctx.emit("plugin/apply", { data: { name: "a" } });
  ctx.emit("plugin/apply", { data: { name: "a" } });
  ctx.emit("plugin/dispose", { data: { name: "a" } });
  ctx.emit("tool/result", { data: { ok: false, error: "boom" } });
  ctx.emit("turn/end", {});
  const c = cal.counters();
  check("lifecycle apply count", c["plugin/apply:a"] === 2, c["plugin/apply:a"]);
  check("lifecycle dispose count", c["plugin/dispose:a"] === 1, c["plugin/dispose:a"]);
  check("lifecycle failure signal recorded", c["tool/result:fail"] === 1, c["tool/result:fail"]);
  check("lifecycle turn/end recorded", c["turn/end"] === 1, c["turn/end"]);
  cal.dispose();
}

// ---- 5) snapshot shape + offline stub ----
{
  const ctx = makeFakeCtx();
  const cal = createRuntimeCalibration(ctx, {}).start();
  const snap = cal.snapshot();
  check("snapshot.available true with ctx", snap.available === true);
  check("snapshot exposes window/cardinality", typeof snap.windowSize === "number" && typeof snap.cardinality === "object");
  cal.dispose();
  const stub = staticRuntimeCalibration();
  check("stub.available false (offline)", stub.available() === false);
  const s2 = stub.snapshot();
  check("stub snapshot honest not-executed note", s2.available === false);
}

// ---- 6) no ctx -> degrade gracefully ----
{
  const cal = createRuntimeCalibration(null, {}).start();
  check("no-ctx available false", cal.available() === false);
  check("no-ctx observeState falls to not-executed", cal.observeState({ package: "x" }) === "not-executed", cal.observeState({ package: "x" }));
  cal.dispose();
}

// ---- 7) overflow observable + dispose releases references (F-8 / F-7) ----
{
  const ctx = makeFakeCtx();
  const cal = createRuntimeCalibration(ctx, { windowSize: 8, cardinalityCap: 2 }).start();
  ctx.emit("plugin/apply", { data: { name: "a" } });
  ctx.emit("plugin/apply", { data: { name: "b" } }); // distinct reaches the cap (2)
  for (let i = 0; i < 3; i++) ctx.emit("plugin/apply", { data: { name: "c" } }); // 4th key -> dropped
  const c = cal.counters();
  check("F-8 overflow dropped is observable", c.cardinality.dropped >= 3, c.cardinality.dropped);
  check("F-8 overflow does not bump distinct", c.cardinality.distinct === 2, c.cardinality.distinct);
  cal.dispose();
  const after = cal.counters();
  const dataKeys = Object.keys(after).filter((k) => k !== "cardinality" && k !== "window");
  check("F-7 dispose clears retained counter map", dataKeys.length === 0, dataKeys.length);
  check("F-7 dispose resets window/distinct", after.cardinality.distinct === 0 && after.window.filled === 0);
}

const lines = [
  "# 运行时校准测试（runtime-calibration）", "", "## 结果：" + passed + " 通过 / " + failed + " 失败", "", "### 覆盖", "",
  "1. A-4 滑动窗口 + 事件基数上限 + 计数优先/超限丢帧", "2. A-4 可逆性（dispose 清除全部监听器）",
  "3. INV-2 启动时序边界（start 前不记录）", "4. A-2 finding_id -> 三态观测映射",
  "5. 生命周期计数（apply/dispose/fail/turn）", "6. 快照形状 + 离线 stub（诚实 not-executed）", "7. 无 ctx 优雅降级", "---",
];
for (const r of results) lines.push(r);
lines.push("---");
console.log(lines.join("\n"));
console.log("\nSUMMARY:", passed, "passed,", failed, "failed");
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "reports", "runtime-calibration-results.md"), lines.join("\n") + "\n", "utf8");
process.exit(failed ? 1 : 0);