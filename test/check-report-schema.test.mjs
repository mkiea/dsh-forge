// dsh-forge/test/check-report-schema.test.mjs
// P0-3 frozen check --json report schema guard. Pure, offline, self-contained:
// fabricates an in-memory analysis object and asserts the shape of
// core.buildCheckReport / CHECK_REPORT_SCHEMA and the gate-driven blocking.
"use strict";
import assert from "node:assert";
import { buildCheckReport, CHECK_REPORT_SCHEMA } from "../core/index.js";

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

function makeFinding(over) {
  return Object.assign({
    finding_id: "ab" + Math.floor(Math.random() * 1e12).toString(16).padStart(14, "0"),
    severity: "info",
    finalSeverity: "info",
    confidence: "low",
    evidenceTier: "heuristic",
    runtimeState: "not-executed",
    evidenceTag: "heuristic + not-executed"
  }, over || {});
}

function makeAnalysis(findings) {
  return {
    assessment: {
      pluginCount: 3, activeCount: 3, disabledCount: 0, edgeCount: 2,
      health: "A", avgScore: 0.1, maxScore: 5,
      bySeverity: { blocking: 0, high: 0, medium: 0, low: 3 }
    },
    ecosystem: {
      layers: [{ layer: "profile-root" }, { layer: "profile-patch" }],
      truthSource: "scan",
      harnessVersion: "0.1.0-test"
    },
    conflicts: {
      conflicts: findings.filter((f) => f.kind !== "leak"),
      summary: { total: findings.length, bySeverity: {} }
    },
    leaks: {
      findings: findings.filter((f) => f.kind === "leak"),
      summary: { total: findings.filter((f) => f.kind === "leak").length, bySeverity: {} }
    }
  };
}

// ---- shape: schemaVersion / inputs / findings[] / gate ----
test("schemaVersion constant is frozen", () => {
  assert.strictEqual(CHECK_REPORT_SCHEMA, "dsh-forge/report@1");
});

test("report exposes frozen top-level fields", () => {
  const r = buildCheckReport(makeAnalysis([makeFinding()]));
  assert.strictEqual(r.schemaVersion, "dsh-forge/report@1");
  assert.strictEqual(typeof r.generatedAt, "string");
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(r.generatedAt), "generatedAt is ISO timestamp");
  assert.ok(Array.isArray(r.findings), "findings is an array");
  assert.strictEqual(typeof r.gate, "object");
  assert.strictEqual(r.gate.blocked.critical, 0);
  assert.strictEqual(r.gate.blocked.high, 0);
});

test("inputs carries profile/rows/truthSource/harnessVersion", () => {
  const r = buildCheckReport(makeAnalysis([makeFinding()]));
  assert.deepStrictEqual(r.inputs.profile, ["profile-root", "profile-patch"]);
  assert.strictEqual(r.inputs.rows, 3);
  assert.strictEqual(r.inputs.truthSource, "scan");
  assert.strictEqual(r.inputs.harnessVersion, "0.1.0-test");
});

test("every projected finding keeps the evidence fields", () => {
  const r = buildCheckReport(makeAnalysis([
    makeFinding({ confidence: "medium", evidenceTier: "contract-source", runtimeState: "not-executed", evidenceTag: "contract-source" })
  ]));
  const f = r.findings[0];
  for (const k of ["finding_id", "severity", "finalSeverity", "confidence", "evidenceTier", "runtimeState", "evidenceTag"]) {
    assert.ok(k in f, "finding missing " + k);
  }
});

test("finalSeverity defaults to severity when unset", () => {
  const r = buildCheckReport(makeAnalysis([makeFinding({ finalSeverity: undefined, severity: "medium" })]));
  assert.strictEqual(r.findings[0].finalSeverity, "medium");
});

test("conflicts and leaks both contribute to findings", () => {
  const r = buildCheckReport(makeAnalysis([makeFinding(), makeFinding({ kind: "leak" })]));
  assert.strictEqual(r.findings.length, 2);
});

// ---- gate: blocking/high findings block; absent info/medium do not ----
test("gate passes with only info/medium findings", () => {
  const r = buildCheckReport(makeAnalysis([makeFinding({ severity: "info", finalSeverity: "info" })]));
  assert.strictEqual(r.gate.pass, true);
});

test("gate blocks on a high finalSeverity", () => {
  const r = buildCheckReport(makeAnalysis([makeFinding({ finalSeverity: "high" })]));
  assert.strictEqual(r.gate.pass, false);
  assert.strictEqual(r.gate.blocked.high, 1);
});

test("gate blocks on a blocking finalSeverity (critical count)", () => {
  const r = buildCheckReport(makeAnalysis([makeFinding({ finalSeverity: "blocking" })]));
  assert.strictEqual(r.gate.pass, false);
  assert.strictEqual(r.gate.blocked.critical, 1);
});

test("flat backward-compat fields remain present", () => {
  const r = buildCheckReport(makeAnalysis([]));
  for (const k of ["profile", "rows", "active", "disabled", "health", "conflicts", "leaks", "truthSource"]) {
    assert.ok(k in r, "flat field missing " + k);
  }
});

console.log("\ncheck-report-schema: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);