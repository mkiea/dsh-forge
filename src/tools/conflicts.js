// dsh-forge/src/tools/conflicts.js
// Tool 2: check_conflicts.
"use strict";
import { buildGraph, checkConflicts, scanLeaks, fuse, staticRuntimeCalibration } from "../../core/index.js";
import { SOURCES_PARAMS, selectEco, buildFeedback, renderFeedback } from "./common.js";

export function conflictsTool(config) {
  return {
    name: "check_conflicts",
    description: "Check the composed plugin ecosystem for conflicts: unsatisfied version ranges, tool-name collisions (two packages registering the same model tool), service-provider collisions (two packages providing the same service name), missing service providers, cross-layer row overrides, and disabled rows. Every finding carries severity, evidence, impact, advice, and confidence so the agent can reason (risk prediction) instead of just reporting. Read-only.",
    parameters: SOURCES_PARAMS,
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          summary: { type: "object", required: true, additionalProperties: true },
          conflicts: {
            type: "array", required: true,
            items: {
              type: "object", additionalProperties: false,
              properties: {
                type: { type: "string", required: true },
                kind: { type: "string" },
                evidenceTier: { type: "string" },
                severity: { type: "string", required: true },
                message: { type: "string", required: true },
                evidence: { type: "string", required: true },
                impact: { type: "string", required: true },
                advice: { type: "string", required: true },
                confidence: { type: "string", required: true },
                packages: { type: "array", items: { type: "string" } },
                service: { type: "string" },
                row: { type: "string" },
                finding_id: { type: "string" },
                finalSeverity: { type: "string" },
                evidenceTag: { type: "string" },
                runtimeState: { type: "string" },
                next_action: { type: "string" },
                reproduce_hint: { type: "string" }
              }
            }
          },
          serviceProviders: { type: "object", required: true, additionalProperties: true },
          leaks: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          calibration: { type: "object", additionalProperties: true },
          runtimeCalibration: { type: "object", additionalProperties: true },
          inputScope: { type: "object", additionalProperties: true },
          feedback: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          truthSource: { type: "string" },
          disclaimer: { type: "string" }
        }
      },
      render(_args, v) {
        const s = v.summary;
        const lines = [
          "## 冲突检查: " + s.total + " 条发现",
          "按类型: " + Object.entries(s.byType).map(([k, n]) => k + " x" + n).join(", "),
          "按级别: " + Object.entries(s.bySeverity).map(([k, n]) => k + " x" + n).join(", ")
        ];
        if (v.feedback && v.feedback.length) {
          lines.push("");
          lines.push(renderFeedback(v.feedback));
          lines.push("");
        }
        for (const c of v.conflicts.filter((c) => c.severity !== "info")) {
          lines.push("- [" + c.severity + "] " + c.message);
          lines.push("  影响: " + c.impact);
          lines.push("  建议: " + c.advice + " (置信度 " + c.confidence + ")");
        }
        const info = v.conflicts.filter((c) => c.severity === "info");
        if (info.length) {
          lines.push("");
          lines.push("### 信息级发现 (" + info.length + ")");
          for (const c of info.slice(0, 20)) lines.push("- " + c.type + ": " + c.message);
          if (info.length > 20) lines.push("- ... 其余 " + (info.length - 20) + " 条请读取完整 JSON 输出");
        }
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      const graph = buildGraph(eco);
      const result = checkConflicts(eco, { graph });
      const leaks = scanLeaks(eco.packages);
      // P0 read-only fusion: prefer a live calibrator fed by the harness bus;
      // otherwise the honest offline stub (all findings not-executed).
      const liveCal = (config.runtimeCalibration && typeof config.runtimeCalibration.evidence === "function") ? config.runtimeCalibration : null;
      const fusionCal = liveCal || staticRuntimeCalibration();
      const conflicts = fuse(result.conflicts, fusionCal.evidence(result.conflicts)).findings;
      const fusedLeaks = fuse(leaks.findings, fusionCal.evidence(leaks.findings)).findings;
      const calibration = config.calibration ? config.calibration.snapshot() : null;
      const runtimeSnapshot = (typeof fusionCal.snapshot === "function") ? fusionCal.snapshot() : null;
      return {
        summary: result.summary,
        conflicts,
        serviceProviders: Object.fromEntries(Object.entries(result.services.provides).map(([p, svcs]) => [p, svcs])),
        leaks: fusedLeaks,
        inputScope: { rows: eco.rows.length, packages: Object.keys(eco.packages).length, layers: eco.layers.map((l) => l.layer), disabledRows: eco.rows.filter((r) => r.disabled === true).length, truthSource: eco.truthSource || "scan" },
        feedback: buildFeedback({ conflicts: result, leaks: fusedLeaks, assessment: null, patterns: [], verified: [] }),
        ...(calibration ? { calibration } : {}),
        ...(runtimeSnapshot ? { runtimeCalibration: runtimeSnapshot } : {}),
        truthSource: eco.truthSource || "scan",
        disclaimer: "静态扫描为疑似清单（static-suspect），非 harness 实际拒绝的确认；kind=contract 表示 harness 契约确定行为。fused finalSeverity/runtimeState：无 live 事件流时为 not-executed（诚实未观测，不视为干净）。"
      };
    },
    presentCall: (args) => ({ card: "generic", title: "Check plugin conflicts", kind: "other", rawInput: args })
  };
}
