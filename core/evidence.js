// dsh-forge/core/evidence.js
// Evidence metadata primitives (INV-6 / A-2): stable finding_id derivation,
// confidence ranking, truth-source confidence cap (INV-4), and schema
// validation requiring every finding to carry confidence + evidence (no
// defaults). Zero dependencies; offline-testable.
"use strict";

export const EVIDENCE_TIERS = Object.freeze(["contract-source", "static-suspect", "heuristic", "runtime-probe"]);
export const CONFIDENCE_LEVELS = Object.freeze(["low", "medium", "high"]);
export const CONFIDENCE_RANK = Object.freeze({ low: 0, medium: 1, high: 2 });
export const TRUTH_SOURCES = Object.freeze(["dump-config", "auto", "scan"]);

// Stable FNV-1a hash of a string -> 8-hex id.
export function hashId(text) {
  let h = 0x811c9dc5;
  const s = String(text == null ? "" : text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h >>> 0) * 0x01000193;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// A-2: stable finding_id binding a static suspect to runtime evidence.
// Derived from scope + name + category + location, so identical findings are
// reproducible across runs and merge points (not a random uuid).
export function makeFindingId(find, opts = {}) {
  const scope = find.scope || opts.scope || find.package || find.packageName || "global";
  const category = find.category || find.type || find.kind || find.severity || "finding";
  const name = find.name || find.tool || find.service || find.id || find.row || "";
  const location = find.location || find.file || find.path || "";
  return hashId([scope, name, category, location].join("|"));
}

// Attach a deterministic finding_id to every finding. Idempotent: an existing
// explicit finding_id is preserved. Requires an attachable (non-null) object.
export function attachFindingIds(findings) {
  const out = { findings: [], added: 0 };
  if (!Array.isArray(findings)) return out;
  for (const f of findings) {
    if (f && typeof f === "object" && !f.finding_id) {
      f.finding_id = makeFindingId(f);
      out.added++;
    }
  }
  out.findings = findings;
  return out;
}

// Cap every finding's confidence to the given maximum (string or rank),
// enforcing the truth-source global cap (INV-4: scan/auto never > medium).
// Marks capped findings with capped=true for transparency. Lowers only, never
// raises.
export function capConfidence(findings, cap) {
  const rank = typeof cap === "string" ? CONFIDENCE_RANK[cap] : cap;
  if (rank === undefined) throw new TypeError("invalid confidence cap: " + String(cap));
  if (!Array.isArray(findings)) return findings;
  for (const f of findings) {
    if (!f || typeof f !== "object" || f.confidence === undefined) continue;
    const r = CONFIDENCE_RANK[f.confidence];
    if (r !== undefined && r > rank) {
      f.confidence = CONFIDENCE_LEVELS[rank];
      f.capped = true;
    }
  }
  return findings;
}

// INV-6 schema check: every finding must carry confidence + evidence.
// Returns the list of offending entries (empty == all valid).
export function validateFindings(findings) {
  const violations = [];
  if (!Array.isArray(findings)) return violations;
  for (const f of findings) {
    if (!f || typeof f !== "object") continue;
    const missing = [];
    if (f.confidence === undefined || f.confidence === null || f.confidence === "") missing.push("confidence");
    if (f.evidence === undefined || f.evidence === null || f.evidence === "") missing.push("evidence");
    if (missing.length) violations.push({ finding_id: f.finding_id || null, type: f.type || f.kind || null, missing });
  }
  return violations;
}