"use strict";
import path from "node:path";
import * as fs from "node:fs";
import {
  analyzeTool, conflictsTool, visualizeTool, simulateTool,
  auditTool, diffTool, historyTool, archiveTool, presetTool,
  verifyTool, suggestTool, upgradeTool, statsTool
} from "../src/tools/index.js";

const cfg = { profile: "web" };
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
// history dir is runtime-generated and gitignored; smoke uses the versioned snapshot instead
const SNAP = process.env.DSH_FORGE_SMOKE_SNAP || path.join(REPO_ROOT, "data", "ecosystem.json");

// Use find-up approach to locate dsh agent-presets directory
function findPresetDir() {
  const candidates = [];
  if (process.env.DSH_FORGE_PRESETS) candidates.push(process.env.DSH_FORGE_PRESETS);
  const dshHome = process.env.DSH_HOME;
  const userHome = process.env.USERPROFILE;
  if (dshHome) candidates.push(path.join(dshHome, "profiles", "web", "node_modules", "@deepseek-ai", "dsh", "config", "agent-presets"));
  if (userHome) {
    candidates.push(path.join(userHome, ".dsh", "profiles", "web", "node_modules", "@deepseek-ai", "dsh", "config", "agent-presets"));
    candidates.push(path.join(userHome, "node_modules", "@deepseek-ai", "dsh", "config", "agent-presets"));
  }
  for (const c of candidates) { try { if (c && fs.existsSync(c)) return c; } catch { /* skip */ } }
  return null;
}
const pd = findPresetDir();
console.log("preset dir resolved:", pd);
console.log("snap resolved:", SNAP, fs.existsSync(SNAP));

const presetsArgs = pd ? { agentPresetsDir: pd } : {};

const tools = [
  ["analyze_dependencies",  analyzeTool(cfg),  { dataset: SNAP }],
  ["check_conflicts",       conflictsTool(cfg),{ dataset: SNAP }],
  ["visualize_plugins",     visualizeTool(cfg),{ dataset: SNAP, format: "ascii" }],
  ["simulate_combination",  simulateTool(cfg), { dataset: SNAP }],
  ["audit_configuration",   auditTool(cfg),    { dataset: SNAP }],
  ["diff_combinations",     diffTool(cfg),     { dataset: SNAP, datasetB: SNAP }],
  ["preset_compare",        presetTool(cfg),   presetsArgs],
  ["verify_rows",           verifyTool(cfg),   { dataset: SNAP }],
  ["archive_snapshot",      archiveTool(cfg),  { dataset: SNAP, label: "smoke-test-no-write", dryRun: true }],
  ["snapshot_history",      historyTool(cfg),  {}],
  ["history_stats",         statsTool(cfg),    {}],
  ["suggest_patch",         suggestTool(cfg),  { dataset: SNAP }],
  ["check_upgrades",        upgradeTool(cfg),  { dataset: SNAP, limit: 0 }]
];
const results = [];
let skipped = 0;
for (const [name, t, args] of tools) {
  if (name === "preset_compare" && !pd) {
    skipped++;
    console.log(`SKIP  ${name.padEnd(24)} agent-presets not found in this environment`);
    results.push({ name, ok: true, skipped: true });
    continue;
  }
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
const pass = results.filter(r => r.ok && !r.skipped).length, fail = results.filter(r => !r.ok).length;
console.log(`13 tools: ${pass} pass / ${skipped} skip / ${fail} fail`);
process.exit(fail ? 1 : 0);