// dsh-forge/src/tools/upgrade.js
// Tool 11: check_upgrades.
"use strict";
import { checkUpgrades } from "../../core/index.js";
import { SOURCES_PARAMS, selectEco } from "./common.js";

export function upgradeTool(config) {
  return {
    name: "check_upgrades",
    description: "Query the npm registry for newer versions of composed @deepseek-ai packages and predict which consumers' declared ranges would reject the upgrade (blocking upgrades). Network required; failures degrade gracefully. Read-only.",
    parameters: {
      ...SOURCES_PARAMS,
      limit: { type: "integer", description: "Max packages to check (default 40; 0 disables network checks)." },
      registry: { type: "string", description: "Primary npm registry. Defaults to registry.npmjs.org, falls back to npmmirror on repeated failures." },
      timeoutMs: { type: "integer", description: "Per-request timeout in ms (default 3500)." }
    },
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          checked: { type: "integer", required: true },
          registry: { type: "string", required: true },
          registrySource: { type: "string", required: true },
          elapsedMs: { type: "integer", required: true },
          networkFailures: { type: "array", required: true, items: { type: "string" } },
          candidates: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          summary: { type: "object", required: true, additionalProperties: true }
        }
      },
      render(_a, v) {
        const s = v.summary;
        const src = v.registrySource === "fallback" ? "镜像降级" : "主源";
        const lines = ["## 升级检查: " + v.checked + " 包, " + s.upgradable + " 可升级, " + s.blockingUpgrades + " 有阻断 (" + src + ", " + v.elapsedMs + "ms)"];
        if (v.networkFailures.length) lines.push("- 网络失败 " + v.networkFailures.length + " 包（已跳过）: " + v.networkFailures.slice(0, 5).join(", "));
        for (const c of v.candidates.slice(0, 12)) {
          lines.push("- " + c.package + ": " + c.installed + " -> " + c.latest + (c.blockers.length ? " [阻断: " + c.blockers.map((b) => b.row + "@" + b.range).join(", ") + "]" : ""));
          lines.push("  `" + c.installCmd + "`");
        }
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      return checkUpgrades(eco, {
        limit: args.limit ?? 40,
        registry: args.registry || config.registry,
        timeoutMs: args.timeoutMs || config.upgradeTimeoutMs,
        concurrency: config.upgradeConcurrency
      });
    },
    presentCall: (args) => ({ card: "generic", title: "Check plugin upgrades", kind: "other", rawInput: args })
  };
}
