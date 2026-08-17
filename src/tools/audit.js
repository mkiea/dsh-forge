// dsh-forge/src/tools/audit.js
// Tool 5: audit_configuration.
"use strict";
import { auditConfiguration } from "../../core/index.js";
import { SOURCES_PARAMS, selectEco } from "./common.js";

export function auditTool(config) {
  return {
    name: "audit_configuration",
    description: "Audit every composed row's config (configText) against evidence-based rules: risky key settings (openAt, telemetry mode, in-memory paths, fetch enabled), with severity, evidence and confidence. Read-only.",
    parameters: SOURCES_PARAMS,
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          summary: { type: "object", required: true, additionalProperties: true },
          findings: { type: "array", required: true, items: { type: "object", additionalProperties: true } }
        }
      },
      render(_a, v) {
        const lines = ["## 配置审计: " + v.summary.total + " 条发现"];
        for (const f of v.findings) lines.push("- [" + f.severity + "] " + f.row + " / " + f.key + ": " + f.message + " (" + f.evidence + ")");
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      return auditConfiguration(eco);
    },
    presentCall: (args) => ({ card: "generic", title: "Audit plugin configuration", kind: "other", rawInput: args })
  };
}
