// dsh-forge/src/tools/verify.js
// Tool 9: verify_rows.
"use strict";
import { verifyRows } from "../../core/index.js";
import { SOURCES_PARAMS, selectEco } from "./common.js";

export function verifyTool(config) {
  return {
    name: "verify_rows",
    description: "Row-level mount preflight: package resolvable, dsh.client declaration present, client bundle built. Detects rows that would fail to mount. Read-only.",
    parameters: SOURCES_PARAMS,
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          summary: { type: "object", required: true, additionalProperties: true },
          issues: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          checked: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          runtimeProbe: { type: "object", additionalProperties: true }
        }
      },
      render(_a, v) {
        const s = v.summary;
        const lines = ["## 装载预检: " + s.rows + " 行, " + s.ok + " OK, " + s.issues + " 问题"];
        if (v.runtimeProbe) {
          lines.push("运行期服务: 提供 " + v.runtimeProbe.found.length + " / " + (v.runtimeProbe.found.length + v.runtimeProbe.missing.length) + " (缺失: " + (v.runtimeProbe.missing.join(", ") || "无") + ")");
        }
        for (const i of v.issues) lines.push("- [" + i.severity + "] " + i.row + ": " + i.message + " (" + i.check + ")");
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      const result = verifyRows(eco, { profile: config.profile || "web" });
      if (config.runtimeProbe) result.runtimeProbe = config.runtimeProbe;
      return result;
    },
    presentCall: (args) => ({ card: "generic", title: "Verify composition rows", kind: "other", rawInput: args })
  };
}
