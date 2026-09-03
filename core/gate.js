// dsh-forge/core/gate.js
// Gate decision transparency (方向 4). The CI contract keeps the frozen
// `gate.pass` semantics (any blocking/high finalSeverity fails, regardless of
// confidence — see test/check-report-schema.test.mjs). This module ADDS an
// advisory lever so consumers can see WHY a high was raised and whether it
// rests on confidence-degraded (scan-capped / low / medium) evidence that
// should be re-confirmed via dump-config before enforcing. Pure, deterministic,
// zero dependencies, offline-testable.
"use strict";

// A finding blocks the gate: severity is the sole frozen driver (pass contract).
// Separately, a blocker is "strict" only when backed by an uncapped HIGH
// confidence (typically contract-source / confirmed dump-config). Anything
// capped by the truth-source cap, or natively low/medium confidence, is
// "degraded" — meaningfully weaker evidence for that severity.
export function severityBlocks(finalSeverity) {
  return finalSeverity === "blocking" || finalSeverity === "high";
}

function isDegraded(f) {
  if (f.capped === true) return true;
  const c = f.confidence;
  return c === "low" || c === "medium" || c === undefined;
}

// Build the advisory gate detail from projected findings.
// Returns { blocked, blockedBy, degraded, lever }.
//   blocked = { critical, high }   // frozen-semantics counts (severity only)
//   blockedBy = every finding whose severity trips the gate, annotated with
//               finding_id / rule / finalSeverity / confidence / evidenceTier
//               / capped — the "因哪条规则拦了谁" load-level ledger.
//   degraded   = subset of blockedBy that rests on confidence-degraded evidence.
//   lever      = "block"    (>=1 strict blocker)
//                "degraded" (gate fails but every blocker is confidence-degraded)
//                "advisory" (gate passes; no blocker)
export function computeGate(findings) {
  const blocked = { critical: 0, high: 0 };
  const blockedBy = [];
  const degraded = [];
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!severityBlocks(f.finalSeverity)) continue;
    const entry = {
      finding_id: f.finding_id || null,
      rule: f.rule || f.type || f.kind || null,
      finalSeverity: f.finalSeverity,
      confidence: f.confidence || "low",
      evidenceTier: f.evidenceTier || null,
      capped: f.capped === true
    };
    if (entry.finalSeverity === "blocking") blocked.critical++;
    else blocked.high++;
    blockedBy.push(entry);
    if (isDegraded(f)) degraded.push(entry);
  }
  const pass = blocked.critical === 0 && blocked.high === 0;
  let lever;
  if (pass) lever = "advisory";
  else if (blockedBy.length > 0 && blockedBy.every((b) => degraded.includes(b))) lever = "degraded";
  else lever = "block";
  return { blocked, blockedBy, degraded, lever };
}

// Keep the frozen gate shape (pass + blocked) as a convenience, used by
// buildCheckReport. Pure.
export function gateFromFindings(findings) {
  const g = computeGate(findings);
  return { pass: g.blocked.critical === 0 && g.blocked.high === 0, ...g };
}