// dsh-forge/src/tools/simulate.js
// Tool 4: simulate_combination.
"use strict";
import { simulateCombination } from "../../core/index.js";
import { SOURCES_PARAMS, selectEco } from "./common.js";

export function simulateTool(config) {
  return {
    name: "simulate_combination",
    description: "Simulate loading a hypothetical plugin combination (add rows, remove rows, override configs) and predict the outcome: which conflicts would newly appear, which would be resolved, the overall health delta, and a verdict. Packages not installed can be simulated with explicit versions/dependencies; installed-but-unmounted packages are resolved from the deployment. NEVER writes to the real composition. Read-only.",
    parameters: {
      ...SOURCES_PARAMS,
      add: {
        type: "array",
        description: "Rows to add: [{id?, package, version?, dependencies?, peerDependencies?, configText?}]. package must be a full package name; id defaults to the package short name.",
        items: { type: "object", additionalProperties: true }
      },
      remove: {
        type: "array",
        description: "Row ids to remove.",
        items: { type: "string" }
      },
      override: {
        type: "array",
        description: "Row overrides: [{id, package?, configText?}].",
        items: { type: "object", additionalProperties: true }
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ops: { type: "object", required: true, additionalProperties: true },
          unknownDeps: { type: "array", required: true, items: { type: "string" } },
          baseline: { type: "object", required: true, additionalProperties: true },
          merged: { type: "object", required: true, additionalProperties: true },
          newConflicts: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          resolvedConflicts: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          riskDelta: { type: "number", required: true },
          verdict: { type: "string", required: true }
        }
      },
      render(_args, v) {
        const lines = [
          "## 组合模拟",
          "操作: add " + v.ops.add.length + " · remove " + v.ops.remove.length + " · override " + v.ops.override.length,
          "基线: health " + v.baseline.health + " (avg " + v.baseline.avgScore + ", " + v.baseline.conflicts.total + " 冲突)",
          "合并后: health " + v.merged.health + " (avg " + v.merged.avgScore + ", " + v.merged.conflicts.total + " 冲突, " + v.merged.pluginCount + " 行)",
          "风险增量: " + (v.riskDelta > 0 ? "+" : "") + v.riskDelta,
          "判定: " + v.verdict
        ];
        for (const c of v.newConflicts) lines.push("- 新增[" + c.severity + "] " + c.message + " (" + c.confidence + ")");
        for (const c of v.resolvedConflicts) lines.push("- 解除: " + c.message);
        for (const u of v.unknownDeps) lines.push("- 注意: " + u);
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      return simulateCombination(eco, {
        add: args.add || [],
        remove: args.remove || [],
        override: args.override || []
      });
    },
    presentCall: (args) => ({ card: "generic", title: "Simulate plugin combination", kind: "other", rawInput: args })
  };
}
