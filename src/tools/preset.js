// dsh-forge/src/tools/preset.js
// Tool 8: preset_compare.
"use strict";
import * as fs from "node:fs";
import { resolveNmRoot, comparePresets } from "../../core/index.js";

export function presetTool(config) {
  return {
    name: "preset_compare",
    description: "Compare the shipped agent presets (standard / code / minimal / cordis) by row set and tool surface: presence matrix plus per-preset row counts. Read-only.",
    parameters: {
      agentPresetsDir: { type: "string", description: "Optional path to the agent-presets directory (defaults to auto-discovery)." }
    },
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          presets: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          matrix: { type: "array", required: true, items: { type: "object", additionalProperties: true } }
        }
      },
      render(_a, v) {
        const lines = ["## 预设对比"];
        for (const p of v.presets) lines.push("- " + p.id + ": " + p.rowCount + " 行" + (p.meta && p.meta.name ? " (" + p.meta.name + ")" : ""));
        lines.push("### 差异行（非全预设一致）");
        for (const m of v.matrix) {
          const entries = Object.entries(m).filter(([k]) => k !== "id");
          const vals = entries.map(([k, v2]) => k + "=" + (v2 || "-"));
          if (new Set(entries.map(([, v2]) => v2)).size > 1) lines.push("- " + m.id + ": " + vals.join(" | "));
        }
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const nmRoot = resolveNmRoot(config.profile || "web");
      const dir = args.agentPresetsDir || (nmRoot ? nmRoot + "/@deepseek-ai/dsh/config/agent-presets" : null);
      if (!dir || !fs.existsSync(dir)) {
        throw new Error("agent-presets directory not found; pass agentPresetsDir explicitly");
      }
      return comparePresets(dir);
    },
    presentCall: (args) => ({ card: "generic", title: "Compare agent presets", kind: "other", rawInput: args })
  };
}
