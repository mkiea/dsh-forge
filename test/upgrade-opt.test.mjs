// dsh-forge/test/upgrade-opt.test.mjs
// 自包含测试：mock fetch，零网络依赖。
// 覆盖 v0.2.3 check_upgrades 优化：并发池 / 独立超时 / 镜像降级 / 安装命令 / 独立性。
import { checkUpgrades } from "../core/upgrade.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

// eco 构造：2 个 @deepseek-ai 包，1 个消费方行（声明了约束 range）
function makeEco(versions) {
  const packages = {};
  for (const [p, v] of Object.entries(versions)) packages[p] = { version: v };
  packages["@deepseek-ai/dsh-cordis-host"] = {
    version: "0.1.0",
    dependencies: { "@deepseek-ai/dsh-app-boot": "^0.1.0" },
    peerDependencies: {}
  };
  return {
    packages,
    rows: [{ id: "row-1", name: "@deepseek-ai/dsh-cordis-host" }]
  };
}

// ── T1 并发池：10 包 * 200ms 延迟，concurrency=5，总耗时应接近 2 批 ≈ 400ms 而非 2000ms
{
  const versions = {};
  for (let i = 0; i < 10; i++) versions["@deepseek-ai/p" + i] = "0.0.1";
  const eco = makeEco(versions);
  let inFlight = 0, peak = 0;
  const fetchImpl = async (url) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 120));
    const pkg = decodeURIComponent(url.split("/").slice(-2, -1)[0]);
    inFlight--;
    return { ok: true, status: 200, json: async () => ({ version: pkg.includes("0") ? "0.0.2" : "0.0.1" }) };
  };
  const t0 = Date.now();
  const out = await checkUpgrades(eco, { concurrency: 5, fetch: fetchImpl, timeoutMs: 2000 });
  const elapsed = Date.now() - t0;
  check("并发池生效（peak <= 5）", peak <= 5, "peak=" + peak);
  check("并发加速（elapsed 远小于串行 1200ms）", elapsed < 900, elapsed + "ms");
  check("11 包全部 checked", out.checked === 11, "checked=" + out.checked);
}

// ── T2 独立超时：永不 resolve 的 fetch，timeoutMs=100 → 快速失败，总耗时小
{
  const eco = makeEco({ "@deepseek-ai/slow": "0.0.1" });
  const never = (url, { signal } = {}) => new Promise((_, reject) => { if (signal) signal.addEventListener("abort", () => reject(new Error("aborted"))); });
  const t0 = Date.now();
  const out = await checkUpgrades(eco, { fetch: never, timeoutMs: 120 });
  const elapsed = Date.now() - t0;
  check("超时快速失败（elapsed < 1000ms）", elapsed < 1000, elapsed + "ms");
  check("网络失败被上报", out.networkFailures.includes("@deepseek-ai/slow"), out.networkFailures.join(","));
  check("超时包不产生候选", out.candidates.length === 0, "candidates=" + out.candidates.length);
}

// ── T3 镜像降级：主 registry 网络错误，fallback 正常 → 自动切换
{
  const eco = makeEco({ "@deepseek-ai/dsh-app-boot": "0.1.0" });
  let primaryHits = 0, fallbackHits = 0;
  const fetchImpl = async (url) => {
    if (url.startsWith("https://registry.npmjs.org/")) { primaryHits++; throw new Error("network down"); }
    fallbackHits++;
    return { ok: true, status: 200, json: async () => ({ version: "0.2.0" }) };
  };
  const out = await checkUpgrades(eco, {
    registry: "https://registry.npmjs.org/",
    registries: ["https://registry.npmmirror.com/"],
    fetch: fetchImpl, timeoutMs: 300
  });
  check("主源失败后切镜像", out.registrySource === "fallback", out.registrySource);
  check("镜像被访问", fallbackHits > 0, "fallbackHits=" + fallbackHits);
  check("主源失败包进入 networkFailures", out.networkFailures.includes("@deepseek-ai/dsh-app-boot"));
  check("降级后仍产出候选", out.candidates.length === 1, "candidates=" + out.candidates.length);
  check("候选标注实际来源 registry", out.candidates[0].registry === "https://registry.npmmirror.com/", out.candidates[0].registry);
}

// ── T4 安装命令：候选附可直接执行的 installCmd
{
  const eco = makeEco({ "@deepseek-ai/dsh-app-boot": "0.1.0" });
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => ({ version: "0.2.0" }) });
  const out = await checkUpgrades(eco, { fetch: fetchImpl });
  check("候选带 installCmd", out.candidates.length >= 1 && out.candidates.some((c) => c.installCmd === "dsh plugin add @deepseek-ai/dsh-app-boot@0.2.0"), out.candidates.map((c) => c.installCmd).join(","));
}

// ── T5 独立性：eco 无 rows / 无 @deepseek-ai 包 → 诚实 0，不崩
{
  const empty = { packages: { "lodash": { version: "4.0.0" } }, rows: [] };
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => ({ version: "5.0.0" }) });
  const out = await checkUpgrades(empty, { fetch: fetchImpl });
  check("无 @deepseek-ai 包诚实 checked=0", out.checked === 0, "checked=" + out.checked);
  check("无 rows 不崩且 blockers 安全", Array.isArray(out.candidates), "candidates=" + out.candidates.length);
}

// ── T6 阻断预测：消费方 range ^0.1.0 拒绝 0.2.0 → blockers 命中
{
  const eco = makeEco({ "@deepseek-ai/dsh-app-boot": "0.1.0" });
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => ({ version: "0.2.0" }) });
  const out = await checkUpgrades(eco, { fetch: fetchImpl });
  check("升级 0.1.0 -> 0.2.0 被 ^0.1.0 阻断", out.candidates[0].blockers.length === 1 && out.candidates[0].blockers[0].range === "^0.1.0", JSON.stringify(out.candidates[0].blockers));
  check("summary.blockingUpgrades 计数", out.summary.blockingUpgrades === 1, "=" + out.summary.blockingUpgrades);
}

console.log("# check_upgrades 优化测试\n");
console.log("## 结果：" + passed + " 通过 / " + failed + " 失败\n---");
for (const r of results) console.log(r);
console.log("---");
console.log("SUMMARY:", passed, "passed,", failed, "failed");
process.exit(failed ? 1 : 0);