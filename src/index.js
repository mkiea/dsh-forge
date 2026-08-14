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
  const cfg = {
    profile: config.profile || "web",
    root: config.root,
    compositionSources: config.compositionSources,
    datasetPath: config.datasetPath,
    runtimeProbe: probeRuntime(ctx)
  };
  for (const factory of ALL_TOOLS) {
    ctx.tools.register(defineTool(factory(cfg)));
  }
}
