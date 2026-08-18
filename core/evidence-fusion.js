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
  if (f.evidenceTier) return f.evidenceTier;
  const conf = String(f.confidence || "low").toLowerCase();
  return conf === "high" ? "static-suspect" : conf === "medium" ? "heuristic" : "heuristic";
}

// A-3: an upgrade/confirmation to high must be actionable and reproducible.
function requireAction(out) {
  if (!out.next_action) {
    out.next_action = "检查 " + (out.package || out.scope || "该插件") +
      " 的副作用注册是否在卸载/dispose 中清理（使用 ctx.on / ctx.effect 或显式 disposer 而非裸 listener/timer 注册）。";
  }
  if (!out.reproduce_hint) {
    out.reproduce_hint = "在同一运行时窗口内对 " + (out.package || out.scope || "该实例") +
      " 执行 加载 -> 卸载，再对比事件流计数：若残留监听器/定时器未归零即可复现（executed-residual）。";
  }
}

// Fuse ONE static finding against a runtime observation state
// (default to UNOBSERVED when none recorded). Returns a non-mutated copy of
// the finding with fused fields set (finalSeverity, evidenceTag, runtimeState).
function fuseOne(f, state) {
  const finalState = OBSERVED_STATES.includes(state) ? state : UNOBSERVED;
  const out = { ...f, runtimeState: finalState };
  const tier = inferTier(f);
  const sev = normSeverity(f.severity);

  // low + contract-source: verified-by-design, never upgraded at runtime.
  if (sev === "low" && tier === "contract-source") {
    out.finalSeverity = "low";
    out.evidenceTag = "contract-source";
    out.runtimeOnly = false;
    return out;
  }

  if (sev === "high" && tier === "static-suspect") {
    if (finalState === "executed-residual") {
      out.finalSeverity = "high";
      out.evidenceTag = "static-suspect -> runtime-confirmed";
      out.fused = true;
      requireAction(out);
    } else if (finalState === "executed-clean") {
      out.finalSeverity = "medium";
      out.evidenceTag = "static-suspect + executed-clean";
      out.fused = true;
    } else {
      out.finalSeverity = "high";
      out.evidenceTag = "static-suspect + not-executed";
      out.pendingConfirmation = true;
    }
    return out;
  }

  if (sev === "medium" && tier === "heuristic") {
    if (finalState === "executed-residual") {
      out.finalSeverity = "high";
      out.evidenceTag = "heuristic -> runtime-confirmed";
      out.fused = true;
      requireAction(out);
    } else if (finalState === "executed-clean") {
      out.finalSeverity = "low";
      out.evidenceTag = "heuristic + executed-clean";
      out.fused = true;
    } else {
      out.finalSeverity = "medium";
      out.evidenceTag = "heuristic + not-executed";
      out.pendingConfirmation = true;
    }
    return out;
  }

  // Default: no runtime-sensitive rule for this pair; reflect the observed
  // state without escalating (matches "low + contract-source", info, etc.).
  out.finalSeverity = sev;
  out.evidenceTag = (tier || "unknown") + (finalState !== UNOBSERVED ? " + " + finalState : "");
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