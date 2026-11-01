// dsh-forge/src/tools/verify.js
// Tool 9: verify_rows.
"use strict";
import { verifyRows, probeEcosystem } from "../../core/index.js";
import { SOURCES_PARAMS, selectEco } from "./common.js";

const VERIFY_PARAMS = {
  ...SOURCES_PARAMS,
  dynamic: {
    type: "boolean",
    description: "Also import each package entry in a child process (runtime probe). Catches link-time failures static checks cannot see, e.g. a plugin importing an export the installed dsh-llm no longer provides."
  }
};

export function verifyTool(config) {
  return {
    name: "verify_rows",
    description: "Row-level mount preflight: package resolvable, dsh.client declaration present, client bundle built. Detects rows that would fail to mount. With dynamic:true it also runtime-imports each package entry. Read-only.",
    parameters: VERIFY_PARAMS,
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
        const rp = v.runtimeProbe;
        if (rp && Array.isArray(rp.found) && Array.isArray(rp.missing)) {
          lines.push("运行期服务: 提供 " + rp.found.length + " / " + (rp.found.length + rp.missing.length) + " (缺失: " + (rp.missing.join(", ") || "无") + ")");
        }
        if (rp && rp.dynamic) {
          const d = rp.dynamic;
          lines.push("运行期导入: " + d.probed + " 包, " + d.failed.length + " 失败" + (d.timedOut ? " (批处理超时，未完成项计为未确认)" : ""));
          for (const f of d.failed) lines.push("- [" + f.category + "] " + f.package + ": " + String(f.error || "").slice(0, 160));
        }
        for (const i of v.issues) lines.push("- [" + i.severity + "] " + i.row + ": " + i.message + " (" + i.check + ")");
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      const result = verifyRows(eco, { profile: config.profile || "web" });
      if (config.runtimeProbe) result.runtimeProbe = { ...config.runtimeProbe };
      if (args.dynamic) {
        const probe = await probeEcosystem(eco, { timeoutMs: config.dynamicTimeoutMs });
        const failed = (probe.results || []).filter((r) => !r.ok);
        result.runtimeProbe = {
          ...(result.runtimeProbe || {}),
          dynamic: {
            probed: probe.probed,
            ok: (probe.results || []).filter((r) => r.ok).length,
            failed: failed.map((r) => ({ package: r.package, category: r.category, error: r.error })),
            timedOut: !!probe.timedOut,
            elapsedMs: probe.elapsedMs
          }
        };
        for (const r of failed) {
          result.issues.push({ row: r.package, severity: r.category === "timeout" ? "medium" : "high", check: "dynamicImport", message: "runtime import failed (" + r.category + ")", evidence: r.error || r.entry });
          result.summary.issues++;
          result.summary.bySeverity[r.category === "timeout" ? "medium" : "high"] = (result.summary.bySeverity[r.category === "timeout" ? "medium" : "high"] || 0) + 1;
        }
      }
      return result;
    },
    presentCall: (args) => ({ card: "generic", title: "Verify composition rows", kind: "other", rawInput: args })
  };
}
