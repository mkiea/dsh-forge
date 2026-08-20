// dsh-forge/test/live-cal-unify.test.mjs
// v0.1.8: live calibration unification — the shell (src) now feeds ONE runtime
// calibrator (connectHarnessEvents) instead of the legacy createCalibration.
// Covers: event-name contract RUNTIME_LIFECYCLE_EVENTS, dual-channel bridge
// (direct top-level + session/event wrap) with dedup, honest offline degrade.
import * as path from "node:path";
import * as fs from "node:fs";
import {
  createRuntimeCalibration, staticRuntimeCalibration, UNOBSERVED_STATE,
  RUNTIME_LIFECYCLE_EVENTS, connectHarnessEvents
} from "../core/runtime-calibration.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}
const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));

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

// ---- 1) event-name contract matches the calibrator's live feed ----
check("RUNTIME_LIFECYCLE_EVENTS frozen list",
  Array.isArray(RUNTIME_LIFECYCLE_EVENTS) && RUNTIME_LIFECYCLE_EVENTS.includes("plugin/apply") &&
  RUNTIME_LIFECYCLE_EVENTS.includes("plugin/dispose") && RUNTIME_LIFECYCLE_EVENTS.includes("tool/call") &&
  RUNTIME_LIFECYCLE_EVENTS.includes("tool/result") && RUNTIME_LIFECYCLE_EVENTS.includes("turn/end"));

// ---- 2) dual-channel bridge: direct top-level lifecycle feeds fused state ----
{
  const ctx = makeFakeCtx();
  const conn = connectHarnessEvents(ctx);
  const cal = createRuntimeCalibration(conn.virtualCtx, {}).start();
  ctx.emit("plugin/apply", { data: { name: "pkgA" } });
  check("direct plugin/apply -> executed-clean",
    cal.observeState({ package: "pkgA" }) === "executed-clean", cal.observeState({ package: "pkgA" }));
  ctx.emit("plugin/dispose", { data: { name: "pkgA" } });
  check("direct plugin/dispose recorded", cal.counters()["plugin/dispose:pkgA"] === 1, cal.counters()["plugin/dispose:pkgA"]);
  cal.dispose();
  conn.dispose();
  check("bridge fully reversible", ctx.listenerCount() === 0, ctx.listenerCount());
}

// ---- 3) session/event wrap fallback feeds when no direct binding matched ----
{
  const ctx = makeFakeCtx();
  const conn = connectHarnessEvents(ctx);
  const cal = createRuntimeCalibration(conn.virtualCtx, {}).start();
  // host emits ONLY wrapped events (no direct top-level for tool/call here)
  ctx.emit("session/event", { event: { type: "tool/call", data: { tool: "x" } } });
  ctx.emit("session/event", { event: { type: "turn/end", data: {} } });
  check("session/event wrapped tool/call counted", cal.counters()["tool/call"] === 1, cal.counters()["tool/call"]);
  check("session/event wrapped turn/end counted", cal.counters()["turn/end"] === 1, cal.counters()["turn/end"]);
  cal.dispose(); conn.dispose();
}

// ---- 4) no double count when event arrives both channels ----
{
  const ctx = makeFakeCtx();
  const conn = connectHarnessEvents(ctx);
  const cal = createRuntimeCalibration(conn.virtualCtx, {}).start();
  ctx.emit("plugin/apply", { data: { name: "pkgB" } });          // direct
  ctx.emit("session/event", { event: { type: "plugin/apply", data: { name: "pkgB" } } }); // wrapped (dedup skipped)
  check("no double count for dual-channel event", cal.counters()["plugin/apply:pkgB"] === 1, cal.counters()["plugin/apply:pkgB"]);
  cal.dispose(); conn.dispose();
}

// ---- 5) honest offline degrade (no ctx) ----
{
  const stub = staticRuntimeCalibration();
  check("stub.available false", stub.available() === false);
  check("stub observeState not-executed", stub.observeState({ package: "x" }) === UNOBSERVED_STATE);
  const conn = connectHarnessEvents(null);
  check("connectHarnessEvents(null) -> null (caller falls back)", conn === null);
}

// ---- 6) wrapped lifecycle reaches fuse through bridge end-to-end ----
{
  const ctx = makeFakeCtx();
  const conn = connectHarnessEvents(ctx);
  const cal = createRuntimeCalibration(conn.virtualCtx, {}).start();
  const finding = { package: "pkgC", scope: "s", type: "t", severity: "medium", confidence: "low", evidence: "e" };
  const evBefore = cal.evidence([finding]);
  check("before activation -> not-executed", evBefore[finding.finding_id] === "not-executed");
  ctx.emit("session/event", { event: { type: "plugin/apply", data: { name: "pkgC" } } });
  const evAfter = cal.evidence([finding]);
  check("after wrapped apply -> executed-clean", evAfter[finding.finding_id] === "executed-clean", evAfter[finding.finding_id]);
  cal.dispose(); conn.dispose();
}

// ---- 7) plural-aware: conflicts findings carry `packages:[]`, not package ----
{
  const ctx = makeFakeCtx();
  const conn = connectHarnessEvents(ctx);
  const cal = createRuntimeCalibration(conn.virtualCtx, {}).start();
  const conflict = { type: "tool-collision", packages: ["pkgD", "pkgE"], severity: "high", confidence: "medium", evidence: "e" };
  check("conflict before activation -> not-executed", cal.observeState(conflict) === "not-executed");
  ctx.emit("plugin/apply", { data: { name: "pkgD" } });
  check("conflict observeState ANY involved activated -> executed-clean",
    cal.observeState(conflict) === "executed-clean", cal.observeState(conflict));
  // finding_id must bind identically pre/post activation so fuse looks up the same key
  const ev = cal.evidence([conflict]);
  check("conflict finding_id bound => executed-clean evidence",
    ev[conflict.finding_id] === "executed-clean", ev[conflict.finding_id]);
  cal.dispose(); conn.dispose();
}

const lines = [
  "# live 校准统一测试（live-cal-unify）", "", "## 结果：" + passed + " 通过 / " + failed + " 失败", "", "### 覆盖", "",
  "1. RUNTIME_LIFECYCLE_EVENTS 事件名契约", "2. 桥接双通道：direct 顶层生命周期 -> 三态观测",
  "3. session/event 包装回退 -> 计数", "4. 双通道去重（不重复计数）", "5. 离线诚实降级（no ctx）", "6. 包装生命周期 end-to-end 到 fuse 证据", "---",
];
for (const r of results) lines.push(r);
lines.push("---");
console.log(lines.join("\n"));
console.log("\nSUMMARY:", passed, "passed,", failed, "failed");
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "reports", "live-cal-unify-results.md"), lines.join("\n") + "\n", "utf8");
process.exit(failed ? 1 : 0);
