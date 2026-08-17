// dsh-forge/src/tools/history.js
// Tool 7: snapshot_history.
"use strict";
import { listHistory, loadHistory } from "../../core/index.js";
import { SOURCES_PARAMS } from "./common.js";

export function historyTool(config) {
  return {
    name: "snapshot_history",
    description: "List archived ecosystem snapshots (auto-archived analyses) with timestamps and row counts; pass file to load one snapshot's summary. Read-only.",
    parameters: {
      ...SOURCES_PARAMS,
      file: { type: "string", description: "Optional snapshot filename to load and summarize." }
    },
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          count: { type: "integer", required: true },
          snapshots: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          loaded: { type: "object", additionalProperties: true }
        }
      },
      render(_a, v) {
        const lines = ["## 快照历史: " + v.count + " 个"];
        for (const s of v.snapshots.slice(0, 15)) lines.push("- " + s.file + "  rows=" + s.rows + (s.rows === 0 ? "  [empty]" : "") + (s.health ? "  health=" + s.health : ""));
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const list = listHistory();
      const out = { count: list.length, snapshots: list };
      if (args.file) {
        const snap = loadHistory(args.file);
        out.loaded = { file: args.file, rows: snap.rows.length, packages: Object.keys(snap.packages).length, collectedAt: snap.collectedAt };
      }
      return out;
    },
    presentCall: (args) => ({ card: "generic", title: "List snapshot history", kind: "other", rawInput: args })
  };
}
