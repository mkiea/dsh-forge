// dsh-forge/test/gate-policy.test.mjs
// 方向 4（选项 C）— 可配置 gate 策略：severity/tier/confidence -> block|warn|allow。
// 守卫点：
//   - 无 policy => 冻结路径逐字节兼容（blockedBy/degraded/lever 由 severity-only 决定）。
//   - 有 policy => gate.pass 反映裁决（无 block 即 pass），blocked 仍是冻结 severity 计数。
//   - tier 只收紧：真实契约冲突即使被 scan cap 压低置信，policy.tier 仍可保持 block（修掉误标）。
//   - validatePolicy 确定性校验，非法值抛错。
"use strict";
import assert from "node:assert";
import {
  computeGate, gateFromFindings, resolveVerdict, validatePolicy, stricter, VERDICTS,
  buildCheckReport
} from "../core/index.js";

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.error("FAIL  " + name + "\n      " + (e && e.message)); } }

const makeFinding = (o) => Object.assign({
  finding_id: "id1", severity: "high", finalSeverity: "high", confidence: "high",
  evidenceTier: "contract-source", runtimeState: "not-executed", evidenceTag: "contract-source", type: "version-conflict"
}, o || {});

// ---------- validatePolicy ----------
test("validatePolicy normalizes valid policy", () => {
  const p = validatePolicy({ severity: { high: "warn" }, tier: { "contract-source": "block" }, confidence: { low: "warn" } });
  assert.strictEqual(p.severity.high, "warn");
  assert.strictEqual(p.tier["contract-source"], "block");
  assert.strictEqual(p.confidence.low, "warn");
});
test("validatePolicy throws on invalid value / key / non-object", () => {
  assert.throws(() => validatePolicy({ severity: { high: "nope" } }));
  assert.throws(() => validatePolicy({ severity: { bogus: "block" } }));
  assert.throws(() => validatePolicy({ confidence: { medium: "allow", nope: "block" } }));
  assert.throws(() => validatePolicy([1, 2]));
  assert.strictEqual(validatePolicy(null), null);
  assert.strictEqual(validatePolicy({}), null);
});
test("VERDICTS ordering is allow < warn < block", () => {
  assert.deepStrictEqual(VERDICTS, ["allow", "warn", "block"]);
  assert.strictEqual(stricter("warn", "block"), "block");
  assert.strictEqual(stricter("allow", "warn"), "warn");
  assert.strictEqual(stricter("allow", "allow"), "allow");
});

// ---------- resolveVerdict ----------
test("resolveVerdict: severity-based baseline with tier tightening", () => {
  const p = validatePolicy({ severity: { high: "warn" }, tier: { "contract-source": "block" } });
  // contract-source high (even under scan cap -> confidence medium, capped) stays block via tier
  assert.strictEqual(resolveVerdict(makeFinding({ confidence: "medium", capped: true }), p), "block");
  // heuristic high (confidence low, evidenceTier static) -> warn via severity
  assert.strictEqual(resolveVerdict(makeFinding({ evidenceTier: "static", confidence: "low", type: "tool-collision" }), p), "warn");
  // medium severity, no tier/sev rule (evidenceTier outside policy) -> default allow
  assert.strictEqual(resolveVerdict(makeFinding({ finalSeverity: "medium", severity: "medium", evidenceTier: "static" }), p), "allow");
});

// ---------- computeGate / gateFromFindings ----------
test("frozen path (no policy) stays severity-only; confirm contract not degraded-previous behavior intact", () => {
  const g = computeGate([makeFinding({ finding_id: "x", confidence: "high" })]);
  assert.strictEqual(g.pass, false);
  assert.strictEqual(g.lever, "block");
  assert.strictEqual(g.policy, false);
});
test("policy: contract-source conflict is strict even when confidence was scanned down (mislabel fix)", () => {
  const p = { severity: { high: "warn" }, tier: { "contract-source": "block" } };
  const g = computeGate([makeFinding({ finding_id: "c1", evidenceTier: "contract-source", confidence: "medium", capped: true })], p);
  assert.strictEqual(g.pass, false);            // policy verdict blocks
  assert.strictEqual(g.lever, "block");
  assert.strictEqual(g.blockedBy.length, 1);
  assert.strictEqual(g.blockedBy[0].verdict, "block");
  assert.strictEqual(g.blocked.high, 1);        // frozen severity count unchanged
});
test("policy: high->allow downgrades a heuristic blocker; pass true + advisory", () => {
  const g = computeGate([makeFinding({ finding_id: "h1", evidenceTier: "static", confidence: "low", type: "tool-collision" })], { severity: { high: "allow" } });
  assert.strictEqual(g.pass, true);
  assert.strictEqual(g.lever, "advisory");
  assert.strictEqual(g.blockedBy.length, 0);
});
test("policy: medium-severity leak downgraded to warn -> pass true + degraded", () => {
  const g = computeGate([makeFinding({ finalSeverity: "medium", severity: "medium", kind: "leak-shared-state", type: undefined })],
    { severity: { medium: "warn" } });
  assert.strictEqual(g.pass, true);            // no block verdict
  assert.strictEqual(g.lever, "degraded");     // warn-tier => degraded
  assert.strictEqual(g.degraded.length, 1);
});
test("gateFromFindings poly path carries policy pass", () => {
  const on = gateFromFindings([makeFinding({ evidenceTier: "contract-source", confidence: "medium", capped: true })],
    { tier: { "contract-source": "block" } });
  assert.strictEqual(on.pass, false);
  assert.strictEqual(on.blocked.high, 1);
  const off = gateFromFindings([makeFinding({ evidenceTier: "contract-source" })], { severity: { high: "allow" } });
  assert.strictEqual(off.pass, true);
});

// ---------- buildCheckReport integration ----------
function makeAnalysis(findings) {
  return {
    assessment: { pluginCount: 2, activeCount: 2, disabledCount: 0, edgeCount: 1, health: "A", avgScore: 1, maxScore: 5, bySeverity: { blocking: 0, high: 2, medium: 0, low: 0 } },
    ecosystem: { layers: [{ layer: "profile-root" }], truthSource: "scan", harnessVersion: "0.1.0-test" },
    conflicts: { conflicts: findings.filter((x) => x.kind !== "leak"), summary: { total: findings.length, bySeverity: {} } },
    leaks: { findings: findings.filter((x) => x.kind === "leak"), summary: { total: findings.filter((x) => x.kind === "leak").length, bySeverity: {} } }
  };
}
test("buildCheckReport with policy marks policyApplied and reflects verdict pass", () => {
  const r = buildCheckReport(makeAnalysis([makeFinding({ finding_id: "c1", evidenceTier: "contract-source", confidence: "medium", capped: true })]), { policy: { tier: { "contract-source": "block" } } });
  assert.strictEqual(r.gate.policyApplied, true);
  assert.strictEqual(r.gate.pass, false);
  assert.strictEqual(r.gate.lever, "block");
});
test("buildCheckReport without policy has no policyApplied (frozen)", () => {
  const r = buildCheckReport(makeAnalysis([makeFinding({ confidence: "high" })]));
  assert.strictEqual(r.gate.policyApplied, undefined);
  assert.strictEqual(r.gate.pass, false);
});

console.log("\ngate-policy: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);