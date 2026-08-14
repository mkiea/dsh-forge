// dsh-forge/core/suggest.js
// Turn conflict advice into concrete cordis.patch.yml snippets (read-only
// output; never writes the composition).
"use strict";

export function suggestPatch(conflicts, opts = {}) {
  const lines = [];
  lines.push("# dsh-forge suggested patch (review before applying)");
  lines.push("");
  const inserts = new Map();
  const disables = [];
  const overrides = [];
  for (const c of conflicts.conflicts || []) {
    if (c.severity === "info") continue;
    if (c.type === "version-conflict" && c.advice && c.advice.includes("Align")) {
      // cannot auto-pin versions without a target; suggest reviewing ranges
      overrides.push({ id: "(review)", note: c.message });
      continue;
    }
    if (c.type === "missing-provider" || c.type === "provider-indirection") continue;
    if (c.type === "row-override") continue;
    if (c.type === "disabled-row") {
      disables.push(c.packages && c.packages[0]);
      continue;
    }
  }
  if (inserts.size) {
    lines.push("- insert:");
    for (const [name] of inserts) lines.push("    - id: " + name.split("/").pop() + "\n      name: '" + name + "'");
  }
  if (disables.length) {
    lines.push("# rows suggested to keep disabled are already disabled; nothing to add");
  }
  if (overrides.length) {
    lines.push("# version conflicts need a manual decision: upgrade the deployment or widen the range");
    for (const o of overrides.slice(0, 5)) lines.push("# - " + o.message.slice(0, 100));
  }
  if (lines.length <= 2) lines.push("# no actionable suggestions (all findings are informational)");
  return lines.join("\n");
}
