// dsh-forge/core/diff.js
// Compare two ecosystems (snapshots or live): row-level add/remove/change.
"use strict";

export function diffCombinations(ecoA, ecoB) {
  const rowsOf = (eco) => new Map(eco.rows.map((r) => [r.id, r]));
  const a = rowsOf(ecoA), b = rowsOf(ecoB);
  const added = [], removed = [], changed = [];
  for (const [id, rb] of b) {
    const ra = a.get(id);
    if (!ra) { added.push({ id, name: rb.name, package: rb.name, disabled: rb.disabled === true }); continue; }
    const hash = (r) => JSON.stringify([r.name, r.disabled, r.configText || ""]);
    if (hash(ra) !== hash(rb)) {
      changed.push({
        id,
        name: ra.name,
        nameChanged: ra.name !== rb.name,
        disabledChanged: ra.disabled !== rb.disabled,
        configChanged: (ra.configText || "") !== (rb.configText || ""),
        from: { name: ra.name, disabled: ra.disabled === true },
        to: { name: rb.name, disabled: rb.disabled === true }
      });
    }
  }
  for (const [id, ra] of a) {
    if (!b.has(id)) removed.push({ id, name: ra.name });
  }
  // risk delta when both assessments available
  let riskDelta = null;
  if (ecoA._assessment && ecoB._assessment) {
    riskDelta = Math.round((ecoB._assessment.avgScore - ecoA._assessment.avgScore) * 10) / 10;
  }
  return { added, removed, changed, riskDelta, summary: { added: added.length, removed: removed.length, changed: changed.length } };
}
