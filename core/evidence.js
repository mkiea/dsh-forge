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
  // F-7: widened from 32-bit FNV-1a to true 64-bit (BigInt). At ~4000+ plugins a
  // 32-bit space yields non-negligible collision probability; 64-bit shrinks it to
  // negligible while staying deterministic across runs and Node versions.
  const s = String(text == null ? "" : text);
  let h = 14695981039346656037n; // FNV-1a 64-bit offset basis
  const prime = 1099511628211n;
  const mask = 0xFFFFFFFFFFFFFFFFn;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

// A-2: stable finding_id binding a static suspect to runtime evidence.
// Derived from scope + name + category + location + involved packages, so
// identical findings are reproducible across runs and merge points (not a
// random uuid). packages IS part of the identity: multi-plugin findings
// (provider-indirection / row-override / disabled-row) share scope/name/
// category/location but differ by which packages they touch, so each gets its
// own id. Free-text message stays OUT of the key (metadata-only identity).
export function makeFindingId(find, opts = {}) {
  const scope = find.scope || opts.scope || find.package || find.packageName || "global";
  const category = find.category || find.type || find.kind || find.severity || "finding";
  const name = find.name || find.tool || find.service || find.id || find.row || "";
  const location = find.location || find.file || find.path || "";
  const pkgs = Array.isArray(find.packages)
    ? find.packages
    : (Array.isArray(opts.packages) ? opts.packages : []);
  const involved = pkgs.slice().sort().join(",");
  return hashId([scope, name, category, location, involved].join("|"));
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
  // F-8: pure — never mutate the input. First scan for any capping needed (fast
  // path returns the same array when nothing changes), then map only the affected
  // entries to capped copies.
  let cappedAny = false;
  for (const f of findings) {
    if (!f || typeof f !== "object" || f.confidence === undefined) continue;
    const r = CONFIDENCE_RANK[f.confidence];
    if (r !== undefined && r > rank) { cappedAny = true; break; }
  }
  if (!cappedAny) return findings;
  return findings.map((f) => {
    if (!f || typeof f !== "object" || f.confidence === undefined) return f;
    const r = CONFIDENCE_RANK[f.confidence];
    if (r !== undefined && r > rank) return { ...f, confidence: CONFIDENCE_LEVELS[rank], capped: true };
    return f;
  });
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