// dsh-forge/src/tools/plan.js
// Tool 14: plan_upgrade.
// 离线升级路径预演（方向 1 S4）：对给定的「目标版本 wish」模拟组合在版本上移后的
// before/after 健康、风险增量、新增/解决的冲突、一句话结论与可执行下一步。
// 只读：不写盘、不改组合、不触碰 harness 状态。目标用显式 "pkg@ver" 为离线确定性；
// 只有出现 "@latest" 时才经 proposeUpgrade 走仓库解析（可注入 fetch）。
"use strict";
import { proposeUpgrade, simulateUpgrade } from "../../core/index.js";
import { SOURCES_PARAMS, selectEco } from "./common.js";

function parseTargets(targets) {
  const wish = {};
  for (const spec of Array.isArray(targets) ? targets : String(targets || "").split(",")) {
    const m = /^(.+)@(\S+)$/.exec(String(spec).trim());
    if (m) wish[m[1].trim()] = m[2];
  }
  return wish;
}

export function planTool(config) {
  return {
    name: "plan_upgrade",
    description: "Predict what happens to the composed set when selected @deepseek-ai packages are upgraded to given (or latest) versions: before/after health, risk delta, newly-introduced vs resolved conflicts, and concrete next steps. Targets are 'pkg@version'. '@latest' resolves from the registry (network; injectable fetch). Read-only, never mutates the composition.",
    parameters: {
      ...SOURCES_PARAMS,
      targets: {
        type: "array",
        items: { type: "string", description: "e.g. '@deepseek-ai/dsh-settings@0.1.1-rc.2' or '@deepseek-ai/lib@latest'." },
        description: "Upgrade wishes as 'pkg@version'. Offline when all versions are explicit."
      },
      registry: { type: "string", description: "Primary npm registry (only used when a target is '@latest')." },
      timeoutMs: { type: "integer", description: "Per-request timeout in ms (only used with '@latest')." }
    },
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          upgraded: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          before: { type: "object", required: true, additionalProperties: true },
          after: { type: "object", required: true, additionalProperties: true },
          riskDelta: { type: "number", required: true },
          rowDiff: { type: "object", required: true, additionalProperties: true },
          newConflicts: { type: "array", required: true },
          resolvedConflicts: { type: "array", required: true },
          doSteps: { type: "array", required: true, items: { type: "string" } },
          verdict: { type: "string", required: true },
          registry: { type: "string", required: false },
          registrySource: { type: "string", required: false },
          networkFailures: { type: "array", required: false, items: { type: "string" } }
        }
      },
      render(_a, v) {
        const up = v.upgraded.length
          ? v.upgraded.map((u) => u.package + "@" + u.from + " -> " + u.to + (u.safe ? " (safe)" : " (breaks " + u.breaks.length + ")")).join(", ")
          : "(none)";
        const lines = [
          "## 升级预演: " + (v.registrySource === "fallback" ? "latest 走镜像降级" : v.registrySource === "network" ? "latest 走主源" : "offline"),
          "- 升级: " + up,
          "- before: " + v.before.health + " (avg " + v.before.avgScore + ", conflicts " + v.before.conflicts.total + ")",
          "- after : " + v.after.health + " (avg " + v.after.avgScore + ", conflicts " + v.after.conflicts.total + ")",
          "- riskDelta: " + (v.riskDelta > 0 ? "+" : "") + v.riskDelta + "  |  conflicts +" + v.newConflicts.length + " / -" + v.resolvedConflicts.length,
          "- verdict: " + v.verdict,
          "- steps:"
        ].concat(v.doSteps.map((s) => "  - " + s));
        if (v.networkFailures && v.networkFailures.length) lines.push("- 网络失败 " + v.networkFailures.length + " 包（latest 未解析）: " + v.networkFailures.slice(0, 5).join(", "));
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      const wish = parseTargets(args.targets);
      const latest = Object.keys(wish).filter((p) => wish[p] === "latest");

      // 仅在有 "@latest" 目标时才碰网络；全部显式版本时完全离线、确定性。
      let meta = { registry: undefined, registrySource: "offline", networkFailures: [] };
      if (latest.length) {
        const up = await proposeUpgrade(eco, {
          packages: latest,
          fetch: config.fetch,
          registry: args.registry || config.registry,
          timeoutMs: args.timeoutMs || config.upgradeTimeoutMs,
        });
        for (const c of up.candidates) {
          if (latest.includes(c.package)) wish[c.package] = c.to;
        }
        meta = { registry: up.registry, registrySource: up.registrySource, networkFailures: up.networkFailures };
      }

      const r = simulateUpgrade(eco, wish);
      return { ...r, ...meta };
    },
    presentCall: (args) => ({ card: "generic", title: "Plan plugin upgrades", kind: "other", rawInput: args })
  };
}