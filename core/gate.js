// dsh-forge/core/gate.js
// Gate decision (方向 4, configurable policy — option C).
//
// Frozen contract (guard: test/check-report-schema.test.mjs): WITHOUT a policy,
// `gate.pass === false` whenever ANY finding has finalSeverity blocking/high,
// regardless of confidence. That path must stay byte-for-byte stable.
//
// WITH an explicit policy, the caller opts into a configurable verdict:
//   policy = {
//     severity?:   { blocking|high|medium|low  : "block"|"warn"|"allow" },
//     tier?:       { <evidenceTier>            : "block"|"warn"|"allow" },
//     confidence?: { high|medium|low           : "block"|"warn"|"allow" }
//   }
// Resolution per finding:
//   base  = severity[finalSeverity]  else DEFAULT (blocking/high -> block, else allow)
//   tier/confidence contributions only ever TIGHTEN (stricter-than) the verdict,
//   so you downgrade via `severity`, and you hold authoritative evidence via `tier`
//   (e.g. "contract-source": "block" keeps real contract conflicts strict even when
//   the truth-source scan cap has lowered their confidence field to medium).
// Violent-free, deterministic, zero dependencies, offline-tested.
"use strict";

export const VERDICTS = ["allow", "warn", "block"];
const ORDER = { allow: 0, warn: 1, block: 2 };
const DEFAULT_SEVERITY_VERDICT = { blocking: "block", high: "block", medium: "allow", low: "allow" };
const CONF_KEYS = ["high", "medium", "low"];
const SEV_KEYS = ["blocking", "high", "medium", "low"];

// Frozen existence contract: any blocking/high finalSeverity trips `pass`,
// independent of confidence. (Guard in check-report-schema.test.mjs)
export function severityBlocks(finalSeverity) {
  return finalSeverity === "blocking" || finalSeverity === "high";
}

// stricter(a, b): keep the most severe of the two. block > warn > allow.
export function stricter(a, b) {
  return ORDER[a] >= ORDER[b] ? a : b;
}

function confKey(c) {
  return CONF_KEYS.includes(c) ? c : "low";
}
function sevKey(s) {
  return SEV_KEYS.includes(s) ? s : "low";
}

// Validate an optional policy object. Returns the normalized policy or throws a
// deterministic Error describing the first problem. Empty/undefined -> null.
export function validatePolicy(policy) {
  if (policy == null) return null;
  if (typeof policy !== "object" || Array.isArray(policy)) throw new Error("gate policy must be a plain object");
  const norm = { severity: {}, tier: {}, confidence: {} };
  let has = false;
  if (policy.severity != null) {
    for (const k of Object.keys(policy.severity)) {
      if (!SEV_KEYS.includes(k)) throw new Error("gate policy severity key invalid: " + k);
      const v = policy.severity[k];
      if (!ORDER.hasOwnProperty(v)) throw new Error("gate policy severity value invalid: " + v);
      norm.severity[sevKey(k)] = v;
      has = true;
    }
  }
  if (policy.tier != null) {
    for (const k of Object.keys(policy.tier)) {
      if (typeof k !== "string" || k.length === 0) throw new Error("gate policy tier key must be a non-empty string");
      const v = policy.tier[k];
      if (!ORDER.hasOwnProperty(v)) throw new Error("gate policy tier value invalid: " + v);
      norm.tier[k] = v;
      has = true;
    }
  }
  if (policy.confidence != null) {
    for (const k of Object.keys(policy.confidence)) {
      if (!CONF_KEYS.includes(k)) throw new Error("gate policy confidence key invalid: " + k);
      const v = policy.confidence[k];
      if (!ORDER.hasOwnProperty(v)) throw new Error("gate policy confidence value invalid: " + v);
      norm.confidence[confKey(k)] = v;
      has = true;
    }
  }
  return has ? norm : null;
}

// Per-finding verdict under a policy. Only called with a non-empty policy.
export function resolveVerdict(f, policy) {
  const sev = sevKey(f.finalSeverity || f.severity);
  let v = policy.severity && policy.severity[sev] != null ? policy.severity[sev] : (DEFAULT_SEVERITY_VERDICT[sev] || "allow");
  if (policy.tier && f.evidenceTier != null && policy.tier[f.evidenceTier] != null) v = stricter(v, policy.tier[f.evidenceTier]);
  if (policy.confidence != null && policy.confidence[confKey(f.confidence)] != null) v = stricter(v, policy.confidence[confKey(f.confidence)]);
  return v;
}

function entry(f) {
  return {
    finding_id: f.finding_id || null,
    rule: f.rule || f.type || f.kind || null,
    finalSeverity: f.finalSeverity || f.severity || null,
    confidence: f.confidence || "low",
    evidenceTier: f.evidenceTier || null,
    capped: f.capped === true
  };
}

// Deprecated-style degraded check, used only on the (no-policy) frozen path to
// keep its output byte-for-byte identical to the pre-policy version.
function isFrozenDegraded(f) {
  if (f.capped === true) return true;
  const c = f.confidence;
  return c === "low" || c === "medium" || c === undefined;
}

// Build the gate detail. Returns { blocked, blockedBy, degraded, lever }.
//   policy omitted -> frozen path (severity-only existence contract, block triggers),
//                     byte-for-byte identical to the pre-policy version.
//   policy present  -> configurable verdict path.
//     blocked   = frozen severity-only counts (always computed, for the report)
//     blockedBy = findings marked non-allow (frozen) or != "allow" (policy)
//     degraded  = warn-tier findings (policy) / frozen degraded blockers (frozen)
//     lever     = "block" | "degraded" | "advisory"
export function computeGate(findings, policy) {
  const arr = Array.isArray(findings) ? findings : [];
  const usesPolicy = !!validatePolicy(policy);

  const blocked = { critical: 0, high: 0 };
  const blockedBy = [];
  const degraded = [];
  const all = [];

  for (const f of arr) {
    if (usesPolicy) {
      const verdict = resolveVerdict(f, policy);
      const e = entry(f);
      e.verdict = verdict;
      all.push(e);
      if (f.finalSeverity === "blocking") blocked.critical++;
      else if (f.finalSeverity === "high") blocked.high++;
      if (verdict !== "allow") blockedBy.push(e);
      if (verdict === "warn") degraded.push(e);
    } else {
      if (!severityBlocks(f.finalSeverity)) continue;
      const e = entry(f);
      if (e.finalSeverity === "blocking") blocked.critical++;
      else blocked.high++;
      blockedBy.push(e);
      if (isFrozenDegraded(f)) degraded.push(e);
      all.push(e);
    }
  }

  // pass uses the right semantics for the path:
  //   policy path : no finding is verdict-blocked
  //   frozen path : no blocking/high outcome severity (unchanged contract)
  const pass = usesPolicy ? !blockedBy.some((b) => b.verdict === "block") : blocked.critical === 0 && blocked.high === 0;
  let lever;
  if (usesPolicy) {
    if (blockedBy.length === 0) lever = "advisory";
    else if (degraded.length === blockedBy.length) lever = "degraded";
    else lever = "block";
  } else {
    if (pass) lever = "advisory";
    else if (blockedBy.length > 0 && blockedBy.every((b) => degraded.includes(b))) lever = "degraded";
    else lever = "block";
  }
  return { pass, blocked, blockedBy, degraded, lever, policy: usesPolicy };
}

// Keep the frozen gate shape (pass + blocked) plus verdict/lever. Pure.
export function gateFromFindings(findings, policy) {
  const g = computeGate(findings, policy);
  return { pass: g.pass, ...g };
}