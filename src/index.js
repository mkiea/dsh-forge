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
import { analyzeTool, conflictsTool, visualizeTool, simulateTool } from "./tools.js";

export const name = "dsh-forge";
export const inject = ["tools"];

export const Config = z.object({
  profile: z.string().required(false),
  root: z.string().required(false),
  compositionSources: z.array(z.string()).required(false),
  datasetPath: z.string().required(false)
});

export function apply(ctx, config = {}) {
  const cfg = {
    profile: config.profile || "web",
    root: config.root,
    compositionSources: config.compositionSources,
    datasetPath: config.datasetPath
  };
  ctx.tools.register(defineTool(analyzeTool(cfg)));
  ctx.tools.register(defineTool(conflictsTool(cfg)));
  ctx.tools.register(defineTool(visualizeTool(cfg)));
  ctx.tools.register(defineTool(simulateTool(cfg)));
}
