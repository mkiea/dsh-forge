// dsh-forge/core/upgrade.js
// Check the npm registry for newer versions of composed @deepseek-ai
// packages and predict the impact of upgrading (range satisfaction).
//
// v0.2.3 落地性/可靠性/独立性优化：
//  - 固定并发池 + 独立超时（原串行 6s x N 最坏 240s）
//  - registry 镜像自动降级（主 registry 连续失败切备选，如 npmmirror）
//  - 网络失败单独上报（不再静默吞掉）
//  - candidate 附可直接执行的安装命令（dsh plugin add ...）
"use strict";
import { satisfies, parseVersion, compareVersions } from "./semver.js";

const DEFAULT_REGISTRY = "https://registry.npmjs.org/";
const DEFAULT_FALLBACK_REGISTRY = "https://registry.npmmirror.com/";
const DEFAULT_TIMEOUT_MS = 3500;
const DEFAULT_CONCURRENCY = 6;
// 主 registry 连续失败次数达到该阈值才切镜像（避免偶发抖动误切）
const FAILOVER_THRESHOLD = 2;

// Resolve latest version of a single package.
// Returns { version: string|null } on HTTP 200/404 (no failover needed),
// or { error: true } on network failure / timeout / 5xx (triggers failover).
async function latestVersion(pkg, registry, timeoutMs, fetchImpl) {
  const url = registry + encodeURIComponent(pkg).replace(/%2F/g, "/") + "/latest";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (res.status === 404) return { version: null };
    if (!res.ok) return { error: true };
    const j = await res.json();
    return { version: j.version || null };
  } catch {
    return { error: true };
  } finally {
    clearTimeout(timer);
  }
}

// Compare installed version vs registry latest; predict what breaks among
// consumers whose declared ranges would reject the newer version.
export async function checkUpgrades(eco, opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const primary = opts.registry || DEFAULT_REGISTRY;
  const registryList = [primary, ...(opts.registries || [DEFAULT_FALLBACK_REGISTRY]).filter((r) => r && r !== primary)];
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const pkgs = opts.packages || Object.keys(eco.packages || {});
  const todo = pkgs.filter((p) => p.startsWith("@deepseek-ai/")).slice(0, opts.limit || 40);
  const t0 = Date.now();

  // Active registry index only moves forward once failover kicks in.
  let activeIdx = 0;
  let failStreak = 0;
  const failedNetwork = new Set();

  async function query(p) {
    for (let i = 0; i < registryList.length; i++) {
      const reg = registryList[activeIdx];
      const r = await latestVersion(p, reg, timeoutMs, fetchImpl);
      if (!r.error) return { p, registry: reg, latest: r.version };
      failedNetwork.add(p);
      failStreak++;
      if (failStreak >= FAILOVER_THRESHOLD && activeIdx < registryList.length - 1) {
        activeIdx++;
        failStreak = 0;
      }
    }
    return { p, registry: registryList[activeIdx], latest: null };
  }

  // Batched concurrency: min(concurrency, remaining) in flight at once.
  const results = [];
  for (let i = 0; i < todo.length; i += concurrency) {
    const batch = todo.slice(i, i + concurrency);
    results.push(...(await Promise.all(batch.map(query))));
  }

  const candidates = [];
  for (const { p, registry: usedReg, latest } of results) {
    const manifest = (eco.packages || {})[p];
    if (!latest || !manifest) continue;
    if (latest === manifest.version) continue;
    const lv = parseVersion(latest);
    const iv = parseVersion(manifest.version);
    if (!lv || !iv || compareVersions(lv, iv) <= 0) continue; // registry latest not actually newer
    // predict consumers: which rows' ranges would reject the latest
    const blockers = [];
    for (const row of eco.rows || []) {
      const m = (eco.packages || {})[row.name];
      if (!m) continue;
      const range = m.dependencies?.[p] || m.peerDependencies?.[p];
      if (range && satisfies(latest, range) === false) {
        blockers.push({ row: row.id, range });
      }
    }
    candidates.push({
      package: p,
      installed: manifest.version,
      latest,
      blockers,
      registry: usedReg,
      installCmd: "dsh plugin add " + p + "@" + latest
    });
  }

  const registry = registryList[activeIdx];
  const elapsedMs = Date.now() - t0;
  return {
    registry,
    registrySource: activeIdx === 0 ? "primary" : "fallback",
    checked: todo.length,
    elapsedMs,
    networkFailures: [...failedNetwork],
    candidates,
    summary: {
      upgradable: candidates.length,
      blockingUpgrades: candidates.filter((c) => c.blockers.length > 0).length,
      registry,
      registrySource: activeIdx === 0 ? "primary" : "fallback",
      elapsedMs
    }
  };
}