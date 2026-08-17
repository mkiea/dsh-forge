// dsh-forge/src/tools/diff.js
// Tool 6: diff_combinations.
"use strict";
import { diffCombinations } from "../../core/index.js";
import { SOURCES_PARAMS, selectEco, loadSnapshotRef } from "./common.js";

export function diffTool(config) {
  return {
    name: "diff_combinations",
    description: "Compare two plugin combinations (two dataset/snapshot paths or data/history file names, or one snapshot vs the live combination): added/removed/changed rows with config differences. Read-only.",
    parameters: {
      ...SOURCES_PARAMS,
      datasetA: { type: "string", description: "First combination: dataset snapshot path or data/history file name (or omit to use the live combination)." },
      datasetB: { type: "string", description: "Second combination: dataset snapshot path or data/history file name (required when comparing two snapshots)." }
    },
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          summary: { type: "object", required: true, additionalProperties: true },
          added: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          removed: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          changed: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          riskDelta: { type: "number" }
        }
      },
      render(_a, v) {
        const lines = ["## 组合对比: +" + v.summary.added + " / -" + v.summary.removed + " / ~" + v.summary.changed];
        for (const r of v.added) lines.push("- 新增: " + r.id + " (" + r.name + ")");
        for (const r of v.removed) lines.push("- 移除: " + r.id + " (" + r.name + ")");
        for (const r of v.changed.slice(0, 20)) lines.push("- 变更: " + r.id + (r.configChanged ? " [config]" : "") + (r.disabledChanged ? " [disabled]" : "") + (r.nameChanged ? " [name]" : ""));
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      let ecoA, ecoB;
      if (args.datasetB) {
        const aRef = args.datasetA || args.dataset;
        if (!aRef) throw new Error("diff_combinations needs datasetA (or dataset) when datasetB is provided");
        ecoA = loadSnapshotRef(aRef);
        ecoB = loadSnapshotRef(args.datasetB);
      } else if (args.datasetA || args.dataset) {
        ecoA = eco;
        ecoB = loadSnapshotRef(args.datasetA || args.dataset);
      } else {
        throw new Error("diff_combinations needs datasetB (two snapshots) or datasetA (live vs snapshot)");
      }
      return diffCombinations(ecoA, ecoB);
    },
    presentCall: (args) => ({ card: "generic", title: "Diff plugin combinations", kind: "other", rawInput: args })
  };
}
