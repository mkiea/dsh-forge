// test/plan-upgrade.test.mjs —— core/plan.js 离线单测（方向 1 S1）
// 只测纯函数 proposeUpgradeCandidates + 注入 fetch 的 proposeUpgrade 包装；
// 不碰网络、不写盘、确定性可复现。

import { proposeUpgradeCandidates, proposeUpgrade } from "../core/plan.js";

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
    { id: "consumer", name: "@deepseek-ai/consumer" },
    { id: "lib", name: "@deepseek-ai/lib" },
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

console.log(`plan-upgrade: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;