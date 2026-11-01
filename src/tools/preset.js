// dsh-forge/src/tools/preset.js
// Tool 8: preset_compare.
"use strict";
import {
  resolveNmRoot, comparePresets, discoverPresetSources, detectPresetSource
} from "../../core/index.js";

const NOT_FOUND = "agent-presets directory not found";

export function presetTool(config) {
  return {
    name: "preset_compare",
    description: "Compare the shipped agent presets (standard / ptc / minimal / cordis) by row set and tool surface: presence matrix plus per-preset row counts. Resolves the current <id>.patch.yml layout (on disk or inside the desktop app.asar) and the legacy <id>/agent.cordis.yml layout. Read-only.",
    parameters: {
      agentPresetsDir: { type: "string", description: "Optional path to an agent-presets directory (or an app.asar); defaults to auto-discovery." }
    },
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          source: { type: "object", additionalProperties: true },
          presets: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          matrix: { type: "array", required: true, items: { type: "object", additionalProperties: true } }
        }
      },
      render(_a, v) {
        const lines = ["## 预设对比"];
        if (v.source) lines.push("- 数据源: " + v.source.kind + " · " + v.source.path + (v.source.kind === "asar" ? " (" + v.source.dir + ")" : ""));
        for (const p of v.presets) {
          const meta = p.meta && p.meta.name && p.meta.name !== p.id ? " (" + p.meta.name + ")" : "";
          lines.push("- " + p.id + ": " + p.rowCount + " 行" + (p.order == null ? "" : " · order " + p.order) + meta);
        }
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
      if (args.agentPresetsDir) {
        const explicit = detectPresetSource(args.agentPresetsDir);
        if (!explicit) {
          throw new Error(NOT_FOUND + " at " + args.agentPresetsDir + " (expected <id>.patch.yml, <id>/agent.cordis.yml, or app.asar)");
        }
        return comparePresets(explicit);
      }
      const nmRoots = [];
      try {
        const root = resolveNmRoot(config.profile || "web");
        if (root) nmRoots.push(root);
      } catch { /* discovery falls back to the desktop archive */ }
      const sources = discoverPresetSources({ nmRoots });
      if (!sources.length) {
        throw new Error(NOT_FOUND + " (checked dsh-web-app/presets, dsh-agent-presets, dsh/config/agent-presets and the desktop app.asar); pass agentPresetsDir explicitly");
      }
      return comparePresets(sources[0]);
    },
    presentCall: (args) => ({ card: "generic", title: "Compare agent presets", kind: "other", rawInput: args })
  };
}
