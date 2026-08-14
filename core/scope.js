// dsh-forge/core/scope.js
// Scope-aware registration classification (E3: cordis tools/commands may be
// registered per-agent through agent.ctx; a global name collision is a hard
// contract error, while scoped variants with the same name are legal).
// Static, evidence-tagged: every classification carries a scopeHint derived
// from the package source (agent.ctx / scoped markers) and is explicitly a
// suspect until runtime-confirmed.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";

const SCOPED_MARKERS = [
  /agent\.ctx/g,
  /agentCtx/g,
  /\bscoped\b/gi,
  /per-agent/gi,
  /scopeOf\(/g,
  /agentScope/g
];

// Per-package: which source files carry scope markers, and whether any tool
// registration sits in a file with such markers (a scoped-variant hint).
export function scanScopeHints(packages) {
  const hints = {};
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
    let hasScopeMarker = false;
    let regInScopedFile = false;
    let registrationFiles = 0;
    for (const f of files.slice(0, 140)) {
      let text;
      try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
      if (text.length > 400000) continue;
      const scoped = SCOPED_MARKERS.some((re) => { re.lastIndex = 0; return re.test(text); });
      if (scoped) hasScopeMarker = true;
      const hasReg = /register(?:Tool)?\(|defineTool\(/.test(text) || /tools\.register\(/.test(text);
      if (hasReg) registrationFiles++;
      if (scoped && hasReg) regInScopedFile = true;
    }
    hints[p] = {
      hasScopeMarker,
      regInScopedFile,
      registrationFiles,
      hint: regInScopedFile ? "scoped" : hasScopeMarker ? "scoped-context-present" : "global"
    };
  }
  return hints;
}

// Classify a name collision across packages by scope hint.
// Returns: { kind: "contract" | "scoped-variant", detail }
export function classifyCollision(name, packagesList, scopeHints) {
  const involved = packagesList.map((p) => ({ p, hint: scopeHints[p] ? scopeHints[p].hint : "unknown" }));
  const allScoped = involved.length > 0 && involved.every((i) => i.hint === "scoped" || i.hint === "scoped-context-present");
  const anyScoped = involved.some((i) => i.hint === "scoped" || i.hint === "scoped-context-present");
  if (allScoped) {
    return { kind: "scoped-variant", detail: "所有注册方均带作用域标记（agent.ctx/scoped）：同名可能是合法 per-agent 变体" };
  }
  if (anyScoped) {
    return { kind: "contract", detail: "部分注册方在全局上下文（其余带作用域标记）：同名需按作用域核对" };
  }
  return { kind: "contract", detail: "注册方均未见作用域标记：全局同名属 harness 注册拒绝的硬错（静态疑似，待运行期确认）" };
}
