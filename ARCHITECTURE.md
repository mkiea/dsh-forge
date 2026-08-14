# dsh-forge 架构文档

> 版本：0.1.0 · 最后更新：2026-08-14

## 1. 总览

dsh-forge 是 DeepSeek Harness（dsh）的**插件组合分析**插件。它以只读方式检视 harness 的插件组合树，
输出依赖关系、冲突检测、风险评估、可视化与升级建议，辅助开发者做出安全的组合变更决策。

### 设计原则

- **零副作用**：所有工具只读；`simulate_combination` 操作虚拟副本，`archive_snapshot` 仅写 data/history 快照。
- **零依赖引擎**：`core/` 仅使用 Node.js 内置 API（fs / path / module），不依赖任何第三方包。
- **诚实声明**：静态扫描结果标注 `confidence` / `evidenceTier`，未校准数据标 `calibrated: false` + 免责声明。
- **三层分离**：分析引擎（core）↔ 插件壳（src）↔ 客户端 UI（ui-plugin）职责清晰，可独立测试。

## 2. 三层架构

```
┌─────────────────────────────────────────────────────────┐
│                    Harness (dsh web)                      │
│  ┌───────────────────────┐  ┌──────────────────────────┐ │
│  │   dsh-forge (host)    │  │  dsh-forge-ui (client)   │ │
│  │   src/index.js        │  │  ui-plugin/lib/client.js │ │
│  │   ┌─────────────────┐ │  │  ┌────────────────────┐  │ │
│  │   │  13 tools       │ │  │  │ sidebar 入口       │  │ │
│  │   │  (defineTool)   │ │  │  │ modal + iframe     │  │ │
│  │   └────────┬────────┘ │  │  │ dashboard.html     │  │ │
│  │            │          │  │  └────────────────────┘  │ │
│  │   ┌────────▼────────┐ │  └──────────────────────────┘ │
│  │   │  core/ (引擎)   │ │                               │
│  │   │  20 个纯逻辑模块 │ │                               │
│  │   └─────────────────┘ │                               │
│  └───────────────────────┘                               │
└─────────────────────────────────────────────────────────┘
```

### 2.1 core/ — 分析引擎

零依赖纯逻辑层，可脱离 harness 独立运行（`node --input-type=module -e "..."`）。

| 模块 | 职责 | 关键导出 |
| --- | --- | --- |
| `composition.js` | 组合源发现 + YAML 解析 + 生态收集 | `collectEcosystem`, `discoverSources`, `mergeRows` |
| `truth.js` | dump-config 真相源（三态降级） | `loadTruthEcosystem` |
| `analyze.js` | 依赖图构建 + 风险评估 | `buildGraph`, `assess`, `riskScore` |
| `conflicts.js` | 冲突检测引擎 | `checkConflicts`, `scanToolNames`, `scanServices` |
| `scope.js` | 作用域感知（global vs per-agent） | `scanScopeHints` |
| `calibration.js` | 运行期事件校准 | `createCalibration`, `staticCalibration` |
| `leaks.js` | 非可逆副作用泄漏扫描 | `scanLeaks` |
| `semver.js` | SemVer 解析 + 区间满足性 | `satisfies`, `parseVersion`, `compareVersions` |
| `upgrade.js` | npm registry 升级检查 | `checkUpgrades` |
| `audit.js` | 逐行配置审计 | `auditConfiguration` |
| `diff.js` | 快照差异对比 | `diffCombinations` |
| `simulate.js` | 组合模拟 | `simulateCombination`, `applyOps` |
| `visualize.js` | 多格式可视化 | `html`, `mermaid`, `asciiTree` |
| `dashboard.js` | 交互仪表盘数据构建 | `dashboard`, `buildEmbedData` |
| `history.js` | 快照存档与加载 | `archiveSnapshot`, `listHistory`, `loadHistory` |
| `stats.js` | 历史趋势统计 | `historyStats` |
| `presets.js` | 预设对比 | `comparePresets`, `readPreset` |
| `verify.js` | 行级装载预检 | `verifyRows` |
| `suggest.js` | 补丁建议生成 | `suggestPatch` |
| `knowledge.js` | 知识库 + 已知模式 + 废弃扫描 | `knownPatterns`, `scanDeprecations` |

`core/index.js` 是门面模块，统一 re-export 全部公共 API，并提供 `runAnalysis()` 一站式管线和 `saveSnapshot()` / `loadSnapshot()` 快照序列化。

### 2.2 src/ — 插件壳

| 文件 | 职责 |
| --- | --- |
| `src/index.js` | cordis 插件入口：`apply(ctx, config)` → 创建 calibration → 遍历 13 个工具工厂 → `defineTool` 注册 |
| `src/tools.js` | 13 个工具定义：name / description / parameters(JSON Schema) / output.schema / execute / render |

工具注册流程：
```
apply(ctx, config)
  → createCalibration(ctx)          // 运行期事件订阅 or 静态降级
  → probeRuntime(ctx)               // 探测 22 个 harness 服务
  → for each factory in ALL_TOOLS:
      ctx.tools.register(defineTool(factory(cfg)))
```

每个工具的 `execute` 方法通过 `selectEco(args, config)` 获取生态数据，再委托 `core/` 对应模块计算。

### 2.3 ui-plugin/ — 客户端插件

| 文件 | 职责 |
| --- | --- |
| `ui-plugin/index.js` | cordis 客户端插件入口 |
| `ui-plugin/lib/client.template.js` | 源模板：3 个 slot 注册 + modal 组件 |
| `ui-plugin/lib/client.js` | 构建产物（`scripts/build-ui.mjs` 打包，内嵌 dashboard.html） |

3 个 UI 入口 slot：
- `sidebar.footer.action` — sidebar 底部「▦ 插件仪表盘」按钮
- `conversation.session.header.actions` — 会话头按钮
- `conversation.chat.turnTail` — 对话流引导卡片

子 slot 注册通过 `ctx.slots.inject(parent, fn)` 等待父 slot 声明后再注册，避免抢跑。

## 3. 数据流

### 3.1 生态数据收集（selectEco）

```
用户调用工具 execute(args)
  │
  ├─ args.dataset?  ──→ loadSnapshot(file)          // 离线快照模式
  │
  └─ truthSource = auto | dump-config | scan
       │
       ├─ dump-config (首选)
       │    → loadTruthEcosystem({ home, profile })
       │    → dsh --dump-config → 解析生效组合树（含 provenance）
       │    → 成功: 返回 ecosystem + truthSource="dump-config"
       │    → 失败: auto 模式降级到 scan
       │
       └─ scan (回退)
            → collectEcosystem(opts)
            → discoverSources() → 解析 cordis.yml + bundle 补丁 + patch.yml
            → 扫描 node_modules 包清单
            → 返回 ecosystem + truthSource="scan" + warnings
```

### 3.2 冲突检测（check_conflicts）

```
check_conflicts execute
  │
  ├─ selectEco() → eco
  ├─ buildGraph(eco) → graph
  ├─ checkConflicts(eco, { graph })
  │    ├─ 版本冲突: satisfies() 检查依赖 range
  │    ├─ 工具重名: scanToolNames() + scope.js 作用域分级
  │    │    ├─ 全部 scoped → tool-name-scoped-variant (heuristic/info)
  │    │    └─ 含全局 → tool-collision (contract/high)
  │    ├─ 服务覆盖: scanServices() → provide 重复 (impact: "待实证")
  │    └─ 泄漏扫描: scanLeaks() → apply 路径对账 + 知识库排除
  ├─ calibration.snapshot() → 运行期行为基线 (或 null)
  └─ 返回 { conflicts, leaks, calibration, inputScope, truthSource, disclaimer }
```

### 3.3 升级检查（check_upgrades）

```
check_upgrades execute(args)
  │
  ├─ selectEco() → eco
  └─ checkUpgrades(eco, { limit, registry, timeoutMs, concurrency })
       ├─ 筛选 @deepseek-ai/* 包 (limit 默认 40)
       ├─ 并发池 (默认 6) 查询 npm registry /latest
       │    ├─ 主 registry (npmjs.org) 连续失败 ≥2 → 切镜像 (npmmirror)
       │    ├─ 独立超时 (默认 3.5s) → 失败包入 networkFailures
       │    └─ 404 → 该包无 latest (跳过)
       ├─ 比对 installed vs latest → 过滤非升级
       ├─ 阻断预测: satisfies(latest, consumerRange) === false → blockers
       └─ 返回 { candidates: [{ package, installed, latest, blockers, installCmd }], networkFailures, elapsedMs, ... }
```

## 4. 真相源三态设计（truthSource）

| 模式 | 数据来源 | 精度 | 降级 |
| --- | --- | --- | --- |
| `dump-config` | `dsh --dump-config` 官方输出 | 精确（harness 实际装载树） | 不可用则报错 |
| `auto`（默认） | 优先 dump-config | 精确 | 失败自动降级 scan + warning |
| `scan` | 源码扫描重建 | 近似（可能偏离） | — |

`core/truth.js` 的 `findDshBin()` 从 8 层候选路径查找 dsh 可执行文件，超时 20s 兜底。

## 5. 测试架构

全部自包含、零本机依赖（mock fetch / mock ctx / DOM-mock / VM bundle）。

| 套件 | 文件 | 项数 | 覆盖 |
| --- | --- | --- | --- |
| 仪表盘结构+交互 | `test/ui-test.mjs` | 36 | 搜索/筛选/排序/toggle/增删候选 + health badge + 133 行数据 |
| 客户端插件 VM 执行 | `test/ui-plugin-test.mjs` | 22 | 3 slot 注册 + locale + 模态开关 + wide/collapsed 渲染 |
| SemVer 一致性 | `test/semver-consistency.mjs` | 30 | core/semver.js vs dashboard.js 内嵌镜像，22 种区间 |
| 作用域/校准/泄漏 | `test/review-fixes.test.mjs` | 15 | scope 三态 + mock 事件校准 + 泄漏切片 |
| 升级检查优化 | `test/upgrade-opt.test.mjs` | 16 | 并发池 + 超时 + 镜像降级 + 安装命令 + 独立性 + 阻断预测 |

测试策略：
- **跨实现一致性**：semver-consistency 对比两份独立 SemVer 实现
- **VM 真实执行**：ui-plugin-test 用 `vm.createContext` 执行 client.js bundle
- **DOM-mock**：ui-test 用 mock React createElement 模拟仪表盘交互
- **mock fetch**：upgrade-opt.test 用 mock fetch 验证网络逻辑，零真实网络依赖

## 6. 工程资产

| 路径 | 说明 |
| --- | --- |
| `.github/workflows/ci.yml` | CI 模板（Node 20+，运行全量测试） |
| `scripts/build-ui.mjs` | 构建客户端 bundle（内嵌 dashboard.html 到 client.js） |
| `scripts/mount-ui.mjs` | 挂载脚本（env 化：DSH_HOME / DSH_DEPLOY_NM） |
| `scripts/mount-ui.ps1` | Windows PowerShell 挂载脚本 |
| `pnpm-workspace.yaml` | pnpm workspace 配置 |
| `data/ecosystem.json` | 离线生态快照（`dsh-forge-ecosystem@1` 格式） |
| `data/history/` | 历史快照存档 |

## 7. 版本策略

- 遵循三位 SemVer（X.Y.Z），使用 prerelease 后缀标识开发阶段（如 `alpha-v0.1.0`）
- hotfix/patch 使用 prerelease 后缀（如 `alpha-v0.1.0-patch.1`），不使用第四位版本号
- harnessVersion 绑定：`0.1.0-rc.6`
- 知识库模式声明验证版本，版本漂移输出 `knowledge-version-drift` 告警