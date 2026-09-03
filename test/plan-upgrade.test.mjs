// test/plan-upgrade.test.mjs —— core/plan.js 离线单测（方向 1 S1+S2）
// S1：proposeUpgradeCandidates 纯函数 + 注入 fetch 的 proposeUpgrade 包装；
// S2：simulateUpgrade 编排器 + cloneWithVersion 纯克隆。
// 不碰网络、不写盘、确定性可复现。

import { proposeUpgradeCandidates, proposeUpgrade, simulateUpgrade, cloneWithVersion } from "../core/plan.js";

let passed = 0;
let failed = 0;
const eq = (a, b, msg) => {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja === jb) {
    passed++;
  } else {
    failed++;
    console.log(`[FAIL] ${msg}\n   expect ${jb}\n   got    ${ja}`);
  }
  return ja === jb;
};

// ---- 夹具：一个 package 被一个 consumer 声明 ^1.0.0
const eco = {
  name: "bench-for-plan-upgrade",
  rows: [
    { id: "consumer", name: "@deepseek-ai/consumer", layers: ["base"] },
    { id: "lib", name: "@deepseek-ai/lib", layers: ["base"] },
  ],
  packages: {
    "@deepseek-ai/consumer": {
      version: "1.0.0",
      dependencies: { "@deepseek-ai/lib": "^1.0.0" },
      peerDependencies: {},
    },
    "@deepseek-ai/lib": { version: "1.0.0", dependencies: {}, peerDependencies: {} },
  },
  installed: { "@deepseek-ai/consumer": "1.0.0", "@deepseek-ai/lib": "1.0.0" },
};

// 1) 兼容升级：^1.0.0 接受 1.1.0 → safe，无 breaks，建议范围 >=1.1.0
{
  const r = proposeUpgradeCandidates(eco, { "@deepseek-ai/lib": "1.1.0" });
  eq(r.summary.total, 1, "1: total=1");
  eq(r.candidates[0].safe, true, "1: safe=true");
  eq(r.candidates[0].to, "1.1.0", "1: to=1.1.0");
  eq(r.candidates[0].breaks, [], "1: breaks=[]");
  eq(r.candidates[0].suggestedRange, ">=1.1.0", "1: suggestedRange");
}

// 2) 破坏性升级：^1.0.0 拒收 2.0.0 → safe=false，breaks 命中 consumer
{
  const r = proposeUpgradeCandidates(eco, { "@deepseek-ai/lib": "2.0.0" });
  eq(r.summary.blocking, 1, "2: blocking=1");
  eq(r.candidates[0].safe, false, "2: safe=false");
  eq(r.candidates[0].breaks, [{ row: "consumer", range: "^1.0.0" }], "2: breaks");
  eq(r.candidates[0].suggestedRange, null, "2: no suggestedRange when breaking");
  eq(r.summary.safe, 0, "2: summary.safe=0");
}

// 3) 目标 == 已装版本 → 跳过（未移动）
{
  const r = proposeUpgradeCandidates(eco, { "@deepseek-ai/lib": "1.0.0" });
  eq(r.summary.total, 0, "3: same version skipped");
}

// 4) 目标包不在组合中 → 跳过
{
  const r = proposeUpgradeCandidates(eco, { "@deepseek-ai/nonexistent": "2.0.0" });
  eq(r.summary.total, 0, "4: unknown package skipped");
}

// 5) 混合 wish：安全 + 破坏各一
{
  const r = proposeUpgradeCandidates(eco, {
    "@deepseek-ai/lib": "1.1.0", // safe
    "@deepseek-ai/consumer": "9.9.9", // 无 consumer 声明它 → safe（无依赖关系）
  });
  eq(r.summary.total, 2, "5: total=2");
  eq(r.summary.safe, 2, "5: both safe");
}

// 6) 注入 fetch 的 proposeUpgrade：从仓库解出 1.5.0（最新）→ candidate
{
  const stubFetch = async () => ({
    status: 200,
    ok: true,
    json: async () => ({ version: "1.5.0" }),
  });
  const r = await proposeUpgrade(eco, {
    packages: ["@deepseek-ai/lib"],
    fetch: stubFetch,
  });
  eq(r.candidates[0].package, "@deepseek-ai/lib", "6: pkg");
  eq(r.candidates[0].to, "1.5.0", "6: to=1.5.0");
  eq(r.candidates[0].safe, true, "6: safe=true");
  eq(r.candidates[0].suggestedRange, ">=1.5.0", "6: suggestedRange");
  eq(r.summary.total, 1, "6: total=1");
}

// 7) targets 显式覆盖优先于仓库解析（仍可注入 fetch）
{
  const stubFetch = async () => ({
    status: 200,
    ok: true,
    json: async () => ({ version: "1.5.0" }),
  });
  const r = await proposeUpgrade(eco, {
    targets: { "@deepseek-ai/lib": "2.1.0" },
    packages: ["@deepseek-ai/lib"],
    fetch: stubFetch,
  });
  eq(r.candidates[0].to, "2.1.0", "7: explicit target wins");
  eq(r.candidates[0].safe, false, "7: 2.1.0 breaks consumer");
}

// 8) cloneWithVersion 是纯克隆：不改原 eco，新 eco 版本/installed 被覆盖
{
  const before = eco.packages["@deepseek-ai/lib"].version;
  const clone = cloneWithVersion(eco, { "@deepseek-ai/lib": "2.0.0" });
  eq(eco.packages["@deepseek-ai/lib"].version, before, "8: clone 不改原 eco");
  eq(clone.packages["@deepseek-ai/lib"].version, "2.0.0", "8b: clone 版本覆盖");
  eq(clone.installed["@deepseek-ai/lib"], "2.0.0", "8c: clone installed 覆盖");
  eq(clone.rows, eco.rows, "8d: rows 引用保留(只读视图)");
}

// 9) simulateUpgrade 破坏性升级：breaks 命中、产生 version-conflict、verdict 告警、给安装命令
{
  const r = simulateUpgrade(eco, { "@deepseek-ai/lib": "2.0.0" });
  eq(r.upgraded.length, 1, "9: upgraded=1");
  eq(r.upgraded[0].safe, false, "9: safe=false");
  eq(r.upgraded[0].breaks.length, 1, "9: 1 break");
  eq(r.upgraded[0].installCmd, "dsh plugin add @deepseek-ai/lib@2.0.0", "9: installCmd");
  eq(r.before.pluginCount, r.after.pluginCount, "9: pluginCount 保留");
  eq(typeof r.riskDelta, "number", "9: riskDelta is number");
  eq(r.newConflicts.length >= 1, true, "9: 新增了冲突");
  eq(r.newConflicts.length ? r.newConflicts[0].type : "(none)", "version-conflict", "9b: 首个新增为 version-conflict");
  const verdictAlerts = r.verdict.indexOf("RISK") >= 0 || r.verdict.indexOf("阻止项") >= 0;
  eq(verdictAlerts, true, "9c: verdict 告警");
  eq(r.doSteps.length >= 1, true, "9d: doSteps 非空");
}

// 10) simulateUpgrade 安全升级：doSteps 给安装命令
{
  const r = simulateUpgrade(eco, { "@deepseek-ai/lib": "1.1.0" });
  eq(r.upgraded[0].safe, true, "10: 1.1.0 safe");
  eq(r.doSteps[0], "执行 " + r.upgraded[0].installCmd, "10: doSteps install");
}

// 11) simulateUpgrade 不把未知/未装配的 wish 当升级（交给 suggest 层）
{
  const r = simulateUpgrade(eco, { "@deepseek-ai/not-installed": "2.0.0" });
  eq(r.upgraded.length, 0, "11: 未装包不产生升级");
  eq(r.doSteps[0], "无需升级动作", "11: doSteps 兜底");
}

console.log(`plan-upgrade: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;