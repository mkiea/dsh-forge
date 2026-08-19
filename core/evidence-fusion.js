// dsh-forge/core/evidence-fusion.js
// Evidence fusion engine (v0.1.5 P1): merges static results with the runtime
// calibration baseline into a final (fused) alert set.
//
// Invariants honored here:
//   INV-3  runtime absence only LOWERS severity, never clears a finding.
//   A-1    unobserved is tri-stated (not-executed / executed-clean /
//          executed-residual); absence of evidence is NOT evidence of absence.
//   A-3    any upgrade/confirmation to high carries next_action + reproduce_hint.
//   A-2    static<->runtime binding via a stable finding_id.
// Zero dependencies; pure; fully CI-testable offline (no runtime needed).
"use strict";
import { attachFindingIds } from "./evidence.js";

export const OBSERVED_STATES = Object.freeze(["not-executed", "executed-clean", "executed-residual"]);
export const UNOBSERVED = "not-executed";

function normSeverity(s) {
  const v = String(s == null ? "info" : s).toLowerCase();
  return ["high", "medium", "low", "info"].includes(v) ? v : "info";
}

function inferTier(f) {
  // F-5: evidenceTier is the authoritative provenance dimension (conflicts/leaks
  // set it explicitly). confidence is a separate certainty axis — mapping one to
  // the other conflates two dimensions. Unclassified static findings default to
  // heuristic (conservative; runtime may correct them).
  return f.evidenceTier || "heuristic";
}

// A-3: an upgrade/confirmation to high must be actionable and reproducible.
// Localization seam (F-6): default zh-CN action/reproduce copy lives here rather
// than inline across the fusion branches, so a future i18n pass touches one place.
const ACTION_NEXT_DEFAULT = (out) =>
  "检查 " + (out.package || out.scope || "该插件") +
  " 的副作用注册是否在卸载/dispose 中清理（使用 ctx.on / ctx.effect 或显式 disposer 而非裸 listener/timer 注册）。";
const ACTION_REPRODUCE_DEFAULT = (out) =>
  "在同一运行时窗口内对 " + (out.package || out.scope || "该实例") +
  " 执行 加载 -> 卸载，再对比事件流计数：若残留监听器/定时器未归零即可复现（executed-residual）。";

function requireAction(out) {
  if (!out.next_action) out.next_action = ACTION_NEXT_DEFAULT(out);
  if (!out.reproduce_hint) out.reproduce_hint = ACTION_REPRODUCE_DEFAULT(out);
}

// Fuse ONE static finding against a runtime observation state
// (default to UNOBSERVED when none recorded). Returns a non-mutated copy of
// the finding with fused fields set (finalSeverity, evidenceTag, runtimeState).
function nextLower(sev) { return sev === "high" ? "medium" : sev === "medium" ? "low" : sev; }
function nextHigher(sev) { return sev === "high" ? "high" : sev === "medium" ? "high" : sev === "low" ? "medium" : "info"; }

// Complete fusion matrix (F-4): the former 7-row subset let combinations like
// high+heuristic fall into a default branch and skip INV-3 (clean only downgrades,
// never clears). Every (severity x tier x state) resolves here explicitly:
//   contract-source   runtime-immune (verified-by-design) — never changes.
//   static/heuristic  executed-residual -> confirm / escalate toward high;
//                     executed-clean    -> downgrade one step (INV-3);
//                     not-executed      -> keep severity, mark pending (A-1).
function resolveFusion(sev, tier, state) {
  if (tier === "contract-source") {
    return { finalSeverity: sev, evidenceTag: "contract-source", runtimeOnly: false };
  }
  const tag = tier === "unknown" ? "heuristic" : tier;
  if (state === "executed-residual") {
    const up = sev === "high" || sev === "medium" ? "high" : nextHigher(sev);
    return { finalSeverity: up, evidenceTag: tag + " -> runtime-confirmed", fused: true, confirmedHigh: up === "high" };
  }
  if (state === "executed-clean") {
    return { finalSeverity: nextLower(sev), evidenceTag: tag + " + executed-clean", fused: true };
  }
  return { finalSeverity: sev, evidenceTag: tag + " + not-executed", pendingConfirmation: sev !== "info" };
}

// Fuse ONE static finding against a runtime observation state
// (default to UNOBSERVED when none recorded). Returns a non-mutated copy of
// the finding with fused fields set (finalSeverity, evidenceTag, runtimeState).
function fuseOne(f, state) {
  const finalState = OBSERVED_STATES.includes(state) ? state : UNOBSERVED;
  const out = { ...f, runtimeState: finalState };
  const d = resolveFusion(normSeverity(f.severity), inferTier(f), finalState);
  if (d.finalSeverity !== undefined) out.finalSeverity = d.finalSeverity;
  if (d.evidenceTag) out.evidenceTag = d.evidenceTag;
  if (d.fused) out.fused = true;
  if (d.pendingConfirmation) out.pendingConfirmation = true;
  if (d.confirmedHigh) requireAction(out); // A-3: confirmed-high must be actionable
  return out;
}

// Fuse a list of static findings against a runtime evidence map
// (finding_id -> observed state). Every input finding appears in the output
// exactly once (INV-3: never clear). Findings without a finding_id get one
// attached deterministically (A-2).
export function fuse(staticFindings, runtimeEvidence = {}) {
  const prep = attachFindingIds(staticFindings);
  const findings = prep.findings.map((f) => fuseOne(f, runtimeEvidence[f.finding_id]));
  const summary = {
    total: findings.length,
    high: findings.filter((f) => f.finalSeverity === "high").length,
    medium: findings.filter((f) => f.finalSeverity === "medium").length,
    low: findings.filter((f) => f.finalSeverity === "low").length,
    info: findings.filter((f) => f.finalSeverity === "info").length,
    runtimeConfirmed: findings.filter((f) => f.fused).length,
    pendingConfirmation: findings.filter((f) => f.pendingConfirmation).length,
    needsAction: findings.filter((f) => f.finalSeverity === "high" && f.next_action).length
  };
  return { findings, summary };
}