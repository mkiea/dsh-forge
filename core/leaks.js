// dsh-forge/core/leaks.js
// R3: non-reversible side-effect leak scan. Cordis's reversibility contract
// (plugin unload rolls back registrations/effects) only covers effects
// registered through ctx; bare process/document/global listeners and timers
// escape rollback. This scan looks for such bare registrations in a package's
// shipped code and checks for a matching cleanup call (best-effort heuristic,
// low confidence by design).
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";

const BARE_REG = [
  { name: "setInterval", re: /setInterval\(/g, cleanup: /clearInterval\(/g },
  { name: "setTimeout", re: /setTimeout\(/g, cleanup: /clearTimeout\(/g },
  { name: "process.on", re: /process\.on\(/g, cleanup: /process\.(off|removeListener)\(/g },
  { name: "document.addEventListener", re: /document\.addEventListener\(/g, cleanup: /document\.removeEventListener\(/g },
  { name: "window.addEventListener", re: /window\.addEventListener\(/g, cleanup: /window\.removeEventListener\(/g },
  { name: "addEventListener(bare)", re: /(?:^|[^.])\baddEventListener\(/g, cleanup: /removeEventListener\(/g },
  { name: "globalThis.setInterval", re: /globalThis\.setInterval\(/g, cleanup: /globalThis\.clearInterval\(/g }
];

export function scanLeaks(packages) {
  const findings = [];
  for (const [p, m] of Object.entries(packages)) {
    if (!m.dir) continue;
    const files = [];
    (function walk(d) {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, e.name);
        if (e.isDirectory()) walk(q);
        else if (e.name.endsWith(".js")) files.push(q);
      }
    })(path.join(m.dir, "lib"));
    if (!files.length) continue;
    for (const rule of BARE_REG) {
      let regCount = 0, cleanupCount = 0;
      for (const f of files.slice(0, 120)) {
        let text;
        try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
        if (text.length > 400000) continue;
        rule.re.lastIndex = 0;
        let mm;
        while ((mm = rule.re.exec(text))) regCount++;
        rule.cleanup.lastIndex = 0;
        while (rule.cleanup.exec(text)) cleanupCount++;
      }
      if (regCount > cleanupCount) {
        findings.push({
          package: p,
          kind: "leak-suspect",
          severity: "medium",
          message: "裸副作用注册多于清理：" + rule.name + " x" + regCount + " vs cleanup x" + cleanupCount,
          evidence: "静态扫描（heuristic）",
          impact: "若注册发生在 apply 路径且未走 ctx 可逆机制，插件卸载后会残留监听器/定时器（违反 Cordis 可逆副作用契约）。",
          advice: "用 ctx.effect / ctx.on 替代裸调用，或提供显式 disposer。",
          confidence: "low"
        });
      }
    }
  }
  return { findings, summary: { total: findings.length, bySeverity: findings.reduce((a, f) => { a[f.severity] = (a[f.severity] || 0) + 1; return a; }, {}) } };
}
