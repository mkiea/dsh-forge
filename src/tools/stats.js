// dsh-forge/src/tools/stats.js
// Tool 12: history_stats.
"use strict";
import { buildGraph, assess, historyStats } from "../../core/index.js";

export function statsTool(config) {
  return {
    name: "history_stats",
    description: "Trend statistics over archived snapshots: row/package/health evolution over time. Read-only.",
    parameters: {
      historyDir: { type: "string", description: "Optional history directory (defaults to dsh-forge/data/history)." }
    },
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          count: { type: "integer", required: true },
          series: { type: "array", required: true, items: { type: "object", additionalProperties: true } }
        }
      },
      render(_a, v) {
        const lines = ["## 历史趋势: " + v.count + " 个快照"];
        for (const s of v.series.slice(-10)) lines.push("- " + s.collectedAt.slice(0, 19) + "  rows=" + s.rows + "  health=" + s.health);
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    execute() {
      return historyStats({ buildGraph, assess });
    },
    presentCall: (args) => ({ card: "generic", title: "Snapshot trend statistics", kind: "other", rawInput: args })
  };
}
