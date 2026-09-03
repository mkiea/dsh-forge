// dsh-forge/test/gate-lever.test.mjs
// 方向 4 — 闸门杠杆（lever）/ blockedBy 明细 / degraded 置信分层。
// 守卫点：gate.pass 冻结语义保持（任何 blocking/high 就 fail，与置信无关）；
// 追加的 blockedBy / degraded / lever 只是透明层，不改 pass/blocked。
// 纯、离线、自包含。
"use strict";
import assert from "node:assert";
import { computeGate, gateFromFindings, severityBlocks, buildCheckReport, CHECK_REPORT_SCHEMA } from "../core/index.js";

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.error("FAIL  " + name + "\n      " + (e && e.message));
  }
}

const f = (o) => Object.assign({
  finding_id: "id1", severity: "high", finalSeverity: "high", confidence: "high",
  evidenceTier: "contract-source", runtimeState: "not-executed", evidenceTag: "contract-source",
  type: "version-conflict"
}, o || {});

// ---- unit: computeGate ----
test("severityBlocks true only for blocking/high", () => {
  assert.strictEqual(severityBlocks("blocking"), true);
  assert.strictEqual(severityBlocks("high"), true);
  assert.strictEqual(severityBlocks("medium"), false);
  assert.strictEqual(severityBlocks("low"), false);
});

test("advisory when nothing blocks", () => {
  const g = computeGate([
    f({ finalSeverity: "medium", severity: "medium", confidence: "medium" })
  ]);
  assert.strictEqual(g.lever, "advisory");
  assert.strictEqual(g.blocked.high, 0);
  assert.strictEqual(g.blockedBy.length, 0);
});

test("uncapped high-confidence high blocks -> lever block", () => {
  const g = computeGate([f({})]);
  assert.strictEqual(g.lever, "block");
  assert.strictEqual(g.blocked.high, 1);
  assert.strictEqual(g.blockedBy.length, 1);
  assert.strictEqual(g.blockedBy[0].rule, "version-conflict");
  assert.strictEqual(g.blockedBy[0].capped, false);
  assert.strictEqual(g.degraded.length, 0);
});

test("scan-capped high stays fail but lever degraded", () => {
  const g = computeGate([f({ confidence: "medium", capped: true })]);
  assert.strictEqual(g.blocked.high, 1); // frozen semantics: still counts as blocker
  assert.strictEqual(g.blockedBy.length, 1);
  assert.strictEqual(g.blockedBy[0].confidence, "medium");
  assert.strictEqual(g.blockedBy[0].capped, true);
  assert.strictEqual(g.degraded.length, 1);
  assert.strictEqual(g.lever, "degraded");
});

test("low-confidence high blocks but lever degraded", () => {
  const g = computeGate([f({ confidence: "low", capped: false })]);
  assert.strictEqual(g.blocked.high, 1);
  assert.strictEqual(g.lever, "degraded");
  assert.strictEqual(g.degraded.length, 1);
});

test("medium confidence (capped:false) high -> degraded not block lever", () => {
  const g = computeGate([f({ confidence: "medium", capped: false })]);
  assert.strictEqual(g.blocked.high, 1);
  assert.strictEqual(g.lever, "degraded");
});

test("mixed blockers: one strict -> lever block, degraded lists the rest", () => {
  const g = computeGate([
    f({ finding_id: "a" }),
    f({ finding_id: "b", confidence: "low" })
  ]);
  assert.strictEqual(g.lever, "block");
  assert.strictEqual(g.blockedBy.length, 2);
  assert.strictEqual(g.degraded.length, 1);
  assert.strictEqual(g.degraded[0].finding_id, "b");
});

test("blocking severity increments critical, rule falls back to kind when type absent", () => {
  const g = computeGate([f({ finalSeverity: "blocking", severity: "blocking", type: undefined, kind: "leak-shared-state" })]);
  assert.strictEqual(g.blocked.critical, 1);
  assert.strictEqual(g.blocked.high, 0);
  assert.strictEqual(g.blockedBy[0].rule, "leak-shared-state");
});

// ---- gateFromFindings: includes frozen pass ----
test("gateFromFindings returns pass + blocked + lever", () => {
  const on = gateFromFindings([f({})]);
  assert.strictEqual(on.pass, false);
  assert.strictEqual(on.blocked.high, 1);
  assert.strictEqual(on.lever, "block");
  const clean = gateFromFindings([f({ finalSeverity: "info" })]);
  assert.strictEqual(clean.pass, true);
  assert.strictEqual(clean.lever, "advisory");
});

// ---- integration: buildCheckReport carries the transparency layer ----
function makeAnalysis(findings) {
  return {
    assessment: { pluginCount: 2, activeCount: 2, disabledCount: 0, edgeCount: 1, health: "A", avgScore: 1, maxScore: 5, bySeverity: { blocking: 0, high: 2, medium: 0, low: 0 } },
    ecosystem: { layers: [{ layer: "profile-root" }], truthSource: "scan", harnessVersion: "0.1.0-test" },
    conflicts: { conflicts: findings.filter((x) => x.kind !== "leak"), summary: { total: findings.length, bySeverity: {} } },
    leaks: { findings: findings.filter((x) => x.kind === "leak"), summary: { total: findings.filter((x) => x.kind === "leak").length, bySeverity: {} } }
  };
}

test("buildCheckReport keeps frozen gate.pass=false with lever + blockedBy", () => {
  const r = buildCheckReport(makeAnalysis([f({ finding_id: "abc", confidence: "high" })]));
  assert.strictEqual(r.schemaVersion, CHECK_REPORT_SCHEMA);
  assert.strictEqual(r.gate.pass, false);
  assert.strictEqual(r.gate.blocked.high, 1);
  assert.strictEqual(r.gate.lever, "block");
  assert.ok(Array.isArray(r.gate.blockedBy) && r.gate.blockedBy.length === 1);
  assert.strictEqual(r.gate.blockedBy[0].finding_id, "abc");
  // projected finding carries the additive rule/capped fields
  assert.strictEqual(r.findings[0].rule, "version-conflict");
});

test("buildCheckReport degraded lever from a capped finding", () => {
  const r = buildCheckReport(makeAnalysis([f({ finding_id: "cap1", confidence: "medium", capped: true })]));
  assert.strictEqual(r.gate.pass, false); // frozen contract unchanged
  assert.strictEqual(r.gate.lever, "degraded");
  assert.strictEqual(r.gate.degraded.length, 1);
  assert.strictEqual(r.gate.degraded[0].finding_id, "cap1");
});

test("clean report: no blockedBy, lever advisory, frozen pass true", () => {
  const r = buildCheckReport(makeAnalysis([f({ finalSeverity: "info", severity: "info", confidence: "high" })]));
  assert.strictEqual(r.gate.pass, true);
  assert.strictEqual(r.gate.lever, "advisory");
  assert.ok(!r.gate.blockedBy);
});

console.log("\ngate-lever: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);