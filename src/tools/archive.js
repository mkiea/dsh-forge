// dsh-forge/src/tools/archive.js
// Tool: archive_snapshot.
"use strict";
import { archiveSnapshot } from "../../core/index.js";
import { SOURCES_PARAMS, selectEco } from "./common.js";

export function archiveTool(config) {
  return {
    name: "archive_snapshot",
    description: "Archive the current combination as a snapshot file under data/history for later diff/trend analysis. Writes only inside the dsh-forge data directory; the composition itself is never modified. Read-only with respect to the composition.",
    parameters: {
      ...SOURCES_PARAMS,
      label: { type: "string", description: "Optional label for the archive entry." },
      dryRun: { type: "boolean", description: "When true, report the file name and row count without writing anything (for smoke tests)." }
    },
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          file: { type: "string", required: true },
          rows: { type: "integer", required: true }
        }
      },
      render(_a, v) { return [{ type: "text", text: "已存档: " + v.file + " (" + v.rows + " 行)" }]; }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      if (args.dryRun) {
        return { file: "(dry-run) not written", rows: eco.rows.length };
      }
      const file = archiveSnapshot(eco, { label: args.label || "manual" });
      return { file, rows: eco.rows.length };
    },
    presentCall: (args) => ({ card: "generic", title: "Archive combination snapshot", kind: "other", rawInput: args })
  };
}
