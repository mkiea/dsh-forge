// dsh-forge/src/tools/suggest.js
// Tool 10: suggest_patch.
"use strict";
import { buildGraph, checkConflicts, suggestPatch } from "../../core/index.js";
import { SOURCES_PARAMS, selectEco } from "./common.js";

export function suggestTool(config) {
  return {
    name: "suggest_patch",
    description: "Generate a cordis.patch.yml snippet from current conflict findings. Output is text only: the composition is never modified. Read-only.",
    parameters: SOURCES_PARAMS,
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          patch: { type: "string", required: true },
          notes: { type: "array", required: true, items: { type: "string" } }
        }
      },
      render(_a, v) { return [{ type: "text", text: v.patch }]; }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      const graph = buildGraph(eco);
      const conflicts = checkConflicts(eco, { graph });
      return { patch: suggestPatch(conflicts), notes: ["suggest_patch 只生成文本，不写盘；应用前请人工审查"] };
    },
    presentCall: (args) => ({ card: "generic", title: "Suggest composition patch", kind: "other", rawInput: args })
  };
}
