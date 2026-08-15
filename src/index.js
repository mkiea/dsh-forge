// dsh-forge/src/index.js
// dsh-forge: plugin-combination analysis for the DeepSeek Harness.
//
// Mount as a composition row, e.g. in a profile cordis.patch.yml:
//   - id: forge
//     name: 'dsh-forge'
// with the package installed alongside the deployment.
//
// All tools are read-only; simulate_combination never touches the real
// composition.
"use strict";
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { analyzeTool, conflictsTool, visualizeTool, simulateTool, auditTool, diffTool, historyTool, archiveTool, presetTool, verifyTool, suggestTool, upgradeTool, statsTool } from "./tools.js";
import { createCalibration, staticCalibration, preflight, collectEcosystem } from "../core/index.js";

export const name = "dsh-forge";
export const inject = ["tools"];

export const Config = z.object({
  profile: z.string().required(false),
  root: z.string().required(false),
  compositionSources: z.array(z.string()).required(false),
  datasetPath: z.string().required(false)
});

const ALL_TOOLS = [analyzeTool, conflictsTool, visualizeTool, simulateTool, auditTool, diffTool, historyTool, archiveTool, presetTool, verifyTool, suggestTool, upgradeTool, statsTool];

// Runtime service probe: which services the live host plane actually provides.
// Static analysis can only infer providers from source; this is ground truth.
const PROBE_SERVICES = [
  "sessions", "settings", "credentials", "jobs", "tools", "sandbox", "llm",
  "fs", "web", "subagents", "workflows", "goals", "spill", "sessionQuery",
  "sessionProjections", "typert", "approval", "attachments", "loader",
  "agentPresets", "messageFeedback", "workspaces"
];
function probeRuntime(ctx) {
  const found = [];
  const missing = [];
  for (const name of PROBE_SERVICES) {
    try {
      const v = ctx.get ? ctx.get(name) : undefined;
      if (v !== undefined && v !== null) found.push(name);
      else missing.push(name);
    } catch {
      missing.push(name);
    }
  }
  return { found, missing };
}

export function apply(ctx, config = {}) {
  const calibration = (ctx && typeof ctx.on === "function") ? createCalibration(ctx) : staticCalibration();
  const cfg = {
    profile: config.profile || "web",
    root: config.root,
    compositionSources: config.compositionSources,
    datasetPath: config.datasetPath,
    runtimeProbe: probeRuntime(ctx),
    calibration
  };
  // startup preflight: fatal issues go to the terminal that launched the
  // harness, so a crashing/misconfigured plugin leaves a clear diagnostic
  // even if the harness itself dies at boot.
  try {
    if (!config.datasetPath) {
      const eco = collectEcosystem({ home: process.env.DSH_HOME, profile: cfg.profile, root: cfg.root });
      const pf = preflight(eco);
      for (const f of pf.fatal) {
        console.error("[dsh-forge] FATAL " + f.code + " " + f.message);
        if (f.detail) console.error("[dsh-forge]         " + f.detail);
        if (f.guidance) console.error("[dsh-forge]         " + f.guidance);
      }
      for (const f of pf.nonFatal) {
        console.error("[dsh-forge] WARN  " + f.code + " " + f.message);
      }
      cfg.preflight = { fatal: pf.fatal.length, warnings: pf.nonFatal.length };
    }
  } catch (e) {
    console.error("[dsh-forge] FATAL FORGE-001 启动预检失败: " + String(e.message || e).split("\n")[0]);
    cfg.preflight = { fatal: 1, warnings: 0, error: String(e.message || e).split("\n")[0] };
  }
  for (const factory of ALL_TOOLS) {
    ctx.tools.register(defineTool(factory(cfg)));
  }
}
