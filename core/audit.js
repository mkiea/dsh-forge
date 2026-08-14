// dsh-forge/core/audit.js
// Configuration audit: inspect each row's configText for key settings and
// flag risky/inconsistent values (evidence-based rules).
"use strict";

// key -> [severity, pattern-regex, message template]
const RULES = [
  { key: "openAt", sev: "medium", bad: /openAt:\s*(?:startup|first-search)/, ok: /openAt:\s*never/,
    note: "openAt is never: full-text search stays disabled; enable only if search is required" },
  { key: "openAt", sev: "info", bad: /openAt:\s*never/, ok: /openAt:\s*(?:startup|first-search)/,
    note: "openAt opens the search index at startup/first-search: adds SQLite open cost" },
  { key: "mode", sev: "info", bad: /mode:\s*!!js\s+process\.env\.DSH_TELEMETRY_MODE/, ok: null,
    note: "telemetry mode is env-driven; verify DSH_TELEMETRY_MODE when telemetry is expected" },
  { key: "timeout", sev: "info", bad: null, ok: null,
    note: "explicit timeout present" },
  { key: "path", sev: "info", bad: /path:\s*['"]:memory:['"]/, ok: null,
    note: "in-memory path: data is not persisted across restarts" },
  { key: "fetch", sev: "medium", bad: /fetch:\s*true/, ok: /fetch:\s*false/,
    note: "fetch enabled: SSRF exposure for model-chosen targets; the shipped web row keeps it false" }
];

export function auditConfiguration(eco) {
  const findings = [];
  for (const row of eco.rows) {
    if (!row.configText) continue;
    for (const rule of RULES) {
      const m = row.configText.match(new RegExp(rule.key + "\s*:")) ;
      if (!m) continue;
      const valLine = row.configText.split("\n").find((l) => l.includes(rule.key + ":"));
      const bad = rule.bad && rule.bad.test(row.configText);
      const ok = rule.ok && rule.ok.test(row.configText);
      if (rule.sev === "info" && !bad && !ok) continue;
      if (bad) {
        findings.push({
          row: row.id,
          key: rule.key,
          severity: rule.sev,
          message: rule.note,
          evidence: (valLine || "").trim().slice(0, 120),
          confidence: "high"
        });
      }
    }
  }
  return { findings, summary: { total: findings.length, bySeverity: findings.reduce((a, f) => { a[f.severity] = (a[f.severity] || 0) + 1; return a; }, {}) } };
}
