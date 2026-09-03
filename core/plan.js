// plan.js —— 组合升级推演（方向 1）
//
// 纯函数层：proposeUpgradeCandidates() 给定目标版本 wish，离线算每个升级的兼容性
//   （哪些 consumer 的声明范围拒收新版本、建议范围、是否安全）。只读、确定性、可缓存。
// I/O 层   ：proposeUpgrade() 从仓库解析「最新目标版本」（可注入 fetch），再委托纯函数。
// 本模块不写盘、不碰 harness 状态、不参与 gate 拦截语义（方向 1 是咨询，不是闸门）。

import { satisfies } from "./semver.js";
import { checkUpgrades } from "./upgrade.js";

// 通用：给定目标版本，算该升级是否破坏声明了它的 consumer。
// 复用 upgrade.js 的 blocker 判定：range 拒收 version 即 satisfies(version, range) === false。
function collectBreaks(eco, pkg, to) {
  const breaks = [];
  const packages = eco.packages || {};
  const rows = eco.rows || [];
  for (const row of rows) {
    const m = packages[row.name];
    if (!m) continue;
    const range = m.dependencies?.[pkg] || m.peerDependencies?.[pkg];
    if (range && satisfies(to, range) === false) {
      breaks.push({ row: row.id, range });
    }
  }
  return breaks;
}

// 纯函数：targets = { [pkg]: 目标版本 }，返回每个包的一次升级候选 + 概要。
// 只计算显式给出的 targets；不做任何 I/O。幂等、确定性。
export function proposeUpgradeCandidates(eco, targets = {}) {
  const candidates = [];
  const packages = eco.packages || {};
  const installed = eco.installed || {};

  for (const [pkg, to] of Object.entries(targets)) {
    if (!to || typeof to !== "string") continue;
    if (!packages[pkg]) continue; // 组合里根本没有这个包
    const from = installed[pkg] || packages[pkg].version || null;
    if (from && to === from) continue; // 未移动

    const breaks = collectBreaks(eco, pkg, to);
    const safe = breaks.length === 0;
    candidates.push({
      package: pkg,
      from: from || "unknown",
      to,
      breaks,
      safe,
      suggestedRange: safe ? ">=" + to : null,
      note: safe
        ? `升级 ${from || "(未安装)"} → ${to}：不破坏任何声明该依赖的 consumer`
        : `${breaks.length} 个 consumer 的声明范围拒收 ${to}，需先对齐这些范围`,
    });
  }

  return {
    candidates,
    summary: {
      total: candidates.length,
      safe: candidates.filter((c) => c.safe).length,
      blocking: candidates.filter((c) => !c.safe).length,
    },
  };
}

// I/O 层：解析每个包的目标版本。
//   - opts.targets 已给的优先（离线可测；跳过仓库解析）
//   - 其余 scope 内包经 checkUpgrades 从仓库解析最新版（可注入 opts.fetch，保证确定性）
export async function proposeUpgrade(eco, opts = {}) {
  const targets = { ...(opts.targets || {}) };
  const scope = opts.packages || [];

  const up = await checkUpgrades(eco, {
    fetch: opts.fetch,
    registry: opts.registry,
    registries: opts.registries,
    timeoutMs: opts.timeoutMs,
    concurrency: opts.concurrency,
    limit: opts.limit,
    packages: scope,
  });

  // 未显式指定的 scope 内包，自动取仓库「最新」为目标
  for (const c of up.candidates) {
    if (!(c.package in targets)) targets[c.package] = c.latest;
  }

  const built = proposeUpgradeCandidates(eco, targets);
  return {
    ...built,
    registry: up.registry,
    registrySource: up.registrySource,
    networkFailures: up.networkFailures,
  };
}