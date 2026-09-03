// plan.js —— 组合升级推演（方向 1）
//
// 纯函数层：proposeUpgradeCandidates() 给定目标版本 wish，离线算每个升级的兼容性
//   （哪些 consumer 的声明范围拒收新版本、建议范围、是否安全）。只读、确定性、可缓存。
// I/O 层   ：proposeUpgrade() 从仓库解析「最新目标版本」（可注入 fetch），再委托纯函数。
// 本模块不写盘、不碰 harness 状态、不参与 gate 拦截语义（方向 1 是咨询，不是闸门）。

import { satisfies } from "./semver.js";
import { checkUpgrades } from "./upgrade.js";
import { buildGraph, assess } from "./analyze.js";
import { checkConflicts } from "./conflicts.js";

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

// ----------  S2：simulateUpgrade 编排器 ----------
//
// 把「版本上移」表达为对 eco 的纯克隆覆盖（applyOps 的 override 只改 row 的
// name/config，表达不了版本；这里用 packages/installed 字段直接覆盖），再复用
// analyze/conflicts 原语对基线 vs 目标各算一版，产出 before/after 健康、风险增量、
// 新增/解决的冲突、行级 diff 与一段话结论。只读、确定性。

// 纯克隆 + 版本覆盖：bumps = { pkg: targetVersion }。不改原 eco。
export function cloneWithVersion(eco, bumps = {}) {
  const packages = { ...eco.packages };
  const installed = { ...eco.installed };
  for (const [pkg, to] of Object.entries(bumps)) {
    if (!packages[pkg]) continue;
    packages[pkg] = { ...packages[pkg], version: to };
    installed[pkg] = to;
  }
  return { ...eco, packages, installed };
}

function assessmentOf(eco) {
  const graph = buildGraph(eco);
  const conflicts = checkConflicts(eco, { graph });
  const assessment = assess(eco, conflicts);
  return {
    conflicts,
    assessment,
    graph,
  };
}

function sameConflict(a, b) {
  return a.type === b.type && a.message === b.message;
}

// 编排器：wish = { pkg: to }。只对「本就在组合里」的包做版本覆盖模拟；纯函数、无 I/O。
export function simulateUpgrade(eco, wish = {}) {
  // 把目标是「原本就装的包」的版本覆盖提出来，其余（未知/没装）交给 suggest 层。
  const pkgNames = Object.keys(wish).filter((p) => (eco.packages || {})[p]);
  const bumps = {};
  for (const p of pkgNames) {
    const to = wish[p];
    if (typeof to === "string" && to !== (eco.packages || {})[p].version) bumps[p] = to;
  }

  const targetEco = cloneWithVersion(eco, bumps);

  const base = assessmentOf(eco);
  const target = assessmentOf(targetEco);

  const newConflicts = target.conflicts.conflicts.filter(
    (c) => !base.conflicts.conflicts.some((b) => sameConflict(b, c))
  );
  const resolvedConflicts = base.conflicts.conflicts.filter(
    (b) => !target.conflicts.conflicts.some((c) => sameConflict(b, c))
  );

  const riskDelta = Math.round((target.assessment.avgScore - base.assessment.avgScore) * 10) / 10;
  const RANK = { A: 4, B: 3, C: 2, D: 1 };
  const beforeRank = RANK[base.assessment.health] || 0;
  const afterRank = RANK[target.assessment.health] || 0;

  // 结合 proposeUpgradeCandidates 给每个升级附 breaks / 建议范围
  const plan = proposeUpgradeCandidates(eco, bumps);
  const upgraded = plan.candidates.map((c) => ({
    ...c,
    installCmd: "dsh plugin add " + c.package + "@" + c.to,
  }));

  // 一句话结论
  let verdict;
  if (afterRank < beforeRank) {
    verdict = `RISK: 升级使组合健康度从 ${base.assessment.health} 降至 ${target.assessment.health}（avgRisk ${riskDelta > 0 ? "+" : ""}${riskDelta}）。`;
  } else if (afterRank > beforeRank) {
    verdict = `OK: 升级使组合健康度从 ${base.assessment.health} 升至 ${target.assessment.health}。`;
  } else {
    verdict = `NEUTRAL: 健康度保持 ${target.assessment.health}（avgRisk ${riskDelta > 0 ? "+" : ""}${riskDelta}）。`;
  }
  if (plan.summary.blocking > 0) {
    verdict += " 阻止项：" + plan.summary.blocking + " 个升级会破坏 consumer 声明范围。";
  }

  // 可执行的下一步建议
  const doSteps = [];
  for (const c of upgraded) {
    if (!c.safe) {
      const ranges = c.breaks.map((b) => b.range).join(", ");
      doSteps.push(`对齐 ${c.package} 的 consumer 声明范围(${ranges})后再升到 ${c.to}`);
    } else {
      doSteps.push(`执行 ${c.installCmd}`);
    }
  }
  if (newConflicts.length) doSteps.push("处理升级后新增的 " + newConflicts.length + " 处冲突");
  if (doSteps.length === 0) doSteps.push("无需升级动作");

  return {
    upgraded,
    before: {
      health: base.assessment.health,
      avgScore: base.assessment.avgScore,
      conflicts: base.conflicts.summary,
      pluginCount: base.assessment.pluginCount,
    },
    after: {
      health: target.assessment.health,
      avgScore: target.assessment.avgScore,
      conflicts: target.conflicts.summary,
      pluginCount: target.assessment.pluginCount,
    },
    riskDelta,
    newConflicts: newConflicts.map((c) => ({
      type: c.type, severity: c.severity, message: c.message, impact: c.impact, advice: c.advice,
    })),
    resolvedConflicts: resolvedConflicts.map((c) => ({ type: c.type, severity: c.severity, message: c.message })),
    rowDiff: { added: [], removed: [], changed: [], summary: { added: 0, removed: 0, changed: 0 } },
    verdict,
    doSteps,
  };
}