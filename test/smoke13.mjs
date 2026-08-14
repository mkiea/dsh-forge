"use strict";
import path from "node:path";
import * as fs from "node:fs";
import {
  analyzeTool, conflictsTool, visualizeTool, simulateTool,
  auditTool, diffTool, historyTool, archiveTool, presetTool,
  verifyTool, suggestTool, upgradeTool, statsTool
} from "../src/tools.js";

const cfg = { profile: "web" };
const HISTORY_DIR = path.resolve("../dsh-forge/data/history"); // resolve at runtime
const SNAP = path.join(HISTORY_DIR, "2026-08-14T03-41-06-014Z-remediated-v1.json");
const PRESETS = path.resolve(process.env.DSH_HOME || (process.env.USERPROFILE + "/.dsh"), "../AppData/Roaming/TRAE SOLO CN/ModularData/ai-agent/work-mode-projects/6a7e118f38bccda5a8ed9695"); // won't resolve; pass env fallback
// preset compare: pass agentPresetsDir — the one bundled in product
const agentPresetsDir = path.dirname(import.meta.url.replace(/^file:\/\/\//, "")).replace(/^\/([A-Za-z]:)/, "$1"); // fallback; we detect it via npx installed packages

// Use find-up approach to locate dsh agent-presets directory
function findPresetDir() {
  const cacheHome = process.env.npm_config_cache;
  const candidates = [
    process.env.APPDATA + "/npm/node_modules/@deepseek-ai/dsh/config/agent-presets",
    process.env.APPDATA + "/../Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh/config/agent-presets",
    process.env.USERPROFILE + "/.npm_cache/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh/config/agent-presets"
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}
const pd = findPresetDir();
console.log("preset dir resolved:", pd);
console.log("snap resolved:", SNAP, fs.existsSync(SNAP));

const presetsArgs = pd ? { agentPresetsDir: pd } : {};

const tools = [
  ["analyze_dependencies",  analyzeTool(cfg),  {}],
  ["check_conflicts",       conflictsTool(cfg),{}],
  ["visualize_plugins",     visualizeTool(cfg),{ format: "dashboard" }],
  ["simulate_combination",  simulateTool(cfg), { ops: [] }],
  ["audit_configuration",   auditTool(cfg),    {}],
  ["diff_combinations",     diffTool(cfg),     { dataset: SNAP, datasetB: SNAP }],
  ["preset_compare",        presetTool(cfg),   presetsArgs],
  ["verify_rows",           verifyTool(cfg),   {}],
  ["archive_snapshot",      archiveTool(cfg),  { note: "smoke-test-no-write", dryRun: true }],
  ["snapshot_history",      historyTool(cfg),  {}],
  ["history_stats",         statsTool(cfg),    {}],
  ["suggest_patch",         suggestTool(cfg),  {}],
  ["check_upgrades",        upgradeTool(cfg),  {}]
];
const results = [];
for (const [name, t, args] of tools) {
  try {
    const t0 = Date.now();
    const out = await t.execute(args, {});
    const ms = Date.now() - t0;
    let summary = "";
    if (out && typeof out === "object") {
      const keys = Object.keys(out).slice(0, 5).join(",");
      summary = `keys=[${keys}]`;
      if ("truthSource" in out) summary += ` truthSource=${out.truthSource}`;
      if ("leaks" in out) summary += ` leaks=${out.leaks?.length ?? 0}`;
      if ("conflicts" in out) summary += ` conflicts=${out.conflicts?.length ?? 0}`;
      if ("disclaimer" in out) summary += " disclaimer=present";
      if ("warnings" in out) summary += ` warnings=${out.warnings?.length ?? 0}`;
      if ("findings" in out) summary += ` findings=${out.findings?.length ?? 0}`;
      if ("diff" in out) summary += ` diff=${JSON.stringify(out.diff).slice(0,60)}`;
      if ("matrices" in out) summary += ` matrices=${Object.keys(out.matrices || {}).length}`;
      if ("checked" in out) summary += ` checked=${out.checked}`;
    }
    console.log(`OK    ${name.padEnd(24)} ${String(ms).padStart(5)}ms ${summary}`);
    results.push({ name, ok: true, ms });
  } catch (e) {
    console.log(`FAIL  ${name.padEnd(24)} ERR ${e.message}`);
    results.push({ name, ok: false, error: e.message });
  }
}
console.log("---------------------------------------------------");
const pass = results.filter(r => r.ok).length, fail = results.filter(r => !r.ok).length;
console.log(`13 tools: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);