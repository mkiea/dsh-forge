# dsh-forge 架构文档

> 版本：0.1.10（正式版）· 最后更新：2026-08-20

## 1. 总览

dsh-forge 是 DeepSeek Harness（dsh）的**插件组合分析**插件。它以只读方式检视 harness 的插件组合树，
输出依赖关系、冲突检测、风险评估、可视化与升级建议，辅助开发者做出安全的组合变更决策。

### 设计原则

- **分析只读**：所有分析计算只读；`simulate_combination` 操作虚拟副本；报告生成与历史归档为**可选落盘**（`writeReport` → `reports/`，`archive_snapshot` → `data/history/`），路径可经 `DSH_FORGE_REPORTS_DIR` / `DSH_FORGE_HISTORY_DIR` 覆盖。
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
│  │   │  28 个纯逻辑模块 │ │                               │
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
| `skins.js` | 仪表盘皮肤 token（light/dark 双主题，零依赖纯逻辑） | `SKINS`, `DEFAULT_SKIN`, `skinCssVars` |
| `history.js` | 快照存档与加载 | `archiveSnapshot`, `listHistory`, `loadHistory` |
| `report.js` | Markdown 报告生成 + 写入归档（报告/history 路径可配置，history 失败可见） | `buildMarkdownReport`, `writeReport`, `gates`, `reportsDir`, `historyDir`, `pkgVersion` |
| `stats.js` | 历史趋势统计 | `historyStats` |
| `presets.js` | 预设对比 | `comparePresets`, `readPreset` |
| `verify.js` | 行级装载预检 | `verifyRows` |
| `mode.js` | TUI/Web/check 四层证据决策（启动入口/环境/场景/复杂度） | `decideUiMode`, `hasDesktop`, `decideAfterPortProbe` |
| `suggest.js` | 补丁建议生成 | `suggestPatch` |
| `knowledge.js` | 知识库 + 已知模式 + 废弃扫描 | `knownPatterns`, `scanDeprecations` |
| `errors.js` | 统一错误反馈（归一化/聚合/预检/渲染） | `buildFeedback`, `normalizeFeedback`, `preflight`, `renderFeedback` |
| `evidence.js` | 证据元数据（INV-6/A-2）：稳定 finding_id + 置信度上限 + schema 校验 | `makeFindingId`, `attachFindingIds`, `capConfidence`, `validateFindings` |
| `evidence-fusion.js` | 证据融合（A-1 三态 + A-3 可行动 + INV-3 只降不清除） | `fuse` |
| `runtime-calibration.js` | 运行时校准（A-4 滑窗 + INV-2 时序边界 + A-2 关联键） | `createRuntimeCalibration`, `staticRuntimeCalibration` |
| `web-server.js` | Web 面板共享服务（CLI 与 harness 壳复用的 3060 数据通道 + CORS/端口探测/浏览器打开） | `createWebHandler`, `startWebServer`, `probePort`, `openBrowser` |

`core/index.js` 是门面模块，统一 re-export 全部公共 API，并提供 `runAnalysis()` 一站式管线和 `saveSnapshot()` / `loadSnapshot()` 快照序列化。

### 2.2 src/ — 插件壳

| 文件 | 职责 |
| --- | --- |
| `src/index.js` | cordis 插件入口：`apply(ctx, config)` → 创建 calibration → 遍历 13 个工具工厂 → `defineTool` 注册；注册后 `void startAutoWeb(cfg)` 同步拉起共享 Web 面板（3060，不自动开浏览器） |
| `src/tools/index.js` + `src/tools/*.js` | 13 个工具定义（每工具一文件，共享 `common.js`）：name / description / parameters(JSON Schema) / output.schema / execute / render |

工具注册流程：
```
apply(ctx, config)
  → createRuntimeCalibration(ctx)   // 运行期事件订阅 or 静态降级
  → probeRuntime(ctx)               // 探测 22 个 harness 服务
  → for each factory in ALL_TOOLS:
      ctx.tools.register(defineTool(factory(cfg)))
```

每个工具的 `execute` 方法通过 `selectEco(args, config)` 获取生态数据，再委托 `core/` 对应模块计算。

> **双入口职责（勿混淆）**：`src/index.js`（cordis 插件壳）只负责把 13 个工具注册进 harness，并持有运行期探测与启动预检；`core/index.js`（零依赖分析引擎门面）是 CLI 与全部测试的唯一事实源。新增分析能力一律进 `core/` 并在 `core/index.js` re-export；只有需要暴露给 harness 作为工具时才在 `src/tools/<tool>.js` 新增定义。CLI（cli/dsh-forge.mjs）与测试套件 import `core/`，不依赖 `src/`。

### 2.3 ui-plugin/ — 客户端插件

| 文件 | 职责 |
| --- | --- |
| `ui-plugin/index.js` | cordis 客户端插件入口 |
| `ui-plugin/lib/client.template.js` | 源模板：2 个 slot 注册 + modal 组件 |
| `ui-plugin/lib/client.js` | 构建产物（`scripts/build-ui.mjs` 打包，内嵌 dashboard.html） |

2 个 UI 入口 slot：
- `sidebar.footer.action` — sidebar 底部「▦ 插件仪表盘」按钮
- `conversation.chat.turnTail` — 对话流引导卡片

子 slot 注册通过 `ctx.slots.inject(parent, fn)` 等待父 slot 声明后再注册，避免抢跑。


### 2.4 cli/ — 独立双壳入口（默认 TUI，按需 Web）

`cli/dsh-forge.mjs`（package.json `bin.dsh-forge`）复用 `core/` 分析引擎，
按 `core/mode.js` 的四层证据选择形态：

| 命令 | 形态 |
| --- | --- |
| `dsh-forge` | 自动决策：终端内默认 TUI；无 TTY+桌面会话 → Web；CI/管道 → check |
| `dsh-forge tui` | 强制 TUI（零依赖 ANSI；`W` 一键开 Web，`R` 刷新，`Q` 退出） |
| `dsh-forge web` / `serve` | 强制 Web（`node:http` + 10 模块交互仪表盘；缺 client.js 回退自包含 SVG 拓扑；端口占用自动降级） |
| `dsh-forge check` / `ci` | 纯日志或 `--json`，无界面，面向脚本消费 |

TUI 壳与 Web 壳不引入第三方依赖：TUI 用 ANSI 渲染，Web 用 `node:http`
serve `core/dashboard.js` 生成的 10 模块交互仪表盘（缺 `web/dashboard-client.js`
时回退 `core/visualize.js` 的自包含 SVG 页面），保持 core 零依赖与离线可部署。
Web 形态为混合审查：每次请求用当前分析结果新鲜渲染（静态层），live 模式页头提供
`↻ 刷新` 按钮（`/api/refresh` 清除分析缓存后重新分析并返回新嵌入数据，动态层），
静态快照渲染则优雅隐藏该控件。

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
| 仪表盘结构+交互 | `test/ui-test.mjs` | 77 | workspace 结构 / 默认页（使用引导）/ 页切换 + 搜索/筛选/排序/toggle/增删候选 + 名词解释/悬停提示 + 旧模块引导条/表头详释 + 133 行数据 + live 动态标记回归 |
| 客户端插件 VM 执行 | `test/ui-plugin-test.mjs` | 22 | 2 slot 注册 + locale + 模态开关 + wide/collapsed 渲染 |
| SemVer 回归 | `test/semver-consistency.test.mjs` | 30 | core/semver.js 单一实现 30 用例固定断言 + 防 dashboard 镜像回归 |
| 作用域/校准/泄漏 | `test/review-fixes.test.mjs` | 15 | scope 三态 + mock 事件校准 + 泄漏切片 |
| 证据融合引擎 | `test/evidence-fusion.test.mjs` | 23 | A-1 三态 + A-2 稳定 id + A-3 可行动 + 完整融合矩阵 + tier/confidence 去混淆 + INV-3 绝不清除 |
| 运行时校准 | `test/runtime-calibration.test.mjs` | 25 | A-4 滑窗/基数上限/超限丢帧（可观测）+ INV-2 时序边界（单调时钟）+ 可逆性/dispose 释放引用 |
| 真相源三态降级 | `test/truth-source-degradation.test.mjs` | 17 | INV-4 置信度上限（只降不升、纯函数不突变）+ scan 全局降级 + 64 位 finding_id 哈希 |
| 升级检查优化 | `test/upgrade-opt.test.mjs` | 16 | 并发池 + 超时 + 镜像降级 + 安装命令 + 独立性 + 阻断预测 |
| 错误反馈冒烟 | `test/feedback-smoke.test.mjs` | 40 | FORGE 错误码 / 分级 / 聚合 / 渲染 |
| 空组合 / 泄漏规则 | `test/empty-plugins.test.mjs` | 24 | 空组合边界 + 泄漏规则 |
| 随机子集探索 | `test/exploratory-empty.test.mjs` | 27 | 随机插件池 + 多轮组合一致性 |
| 反馈深度探索 | `test/exploratory-feedback.test.mjs` | 563 | 反馈结构合法 / 分级计数 / 排序稳定 / 确定性 |
| TUI/Web/check 决策 | `test/mode-decision.test.mjs` | 19 | 四层证据决策（命令/环境/场景/复杂度）/ env 一致性 / 端口占用降级 / 场景启发 |
| 分析缓存守护 | `test/cache-behavior.test.mjs` | 7 | 同参命中 / clear 失效 / 文件变更 / live profile patch 变更 / 淘汰 / 快照 stamp |
| 主链路融合回归 | `test/main-path-fusion.test.mjs` | 8 | P0 主路径真正 fuse：runAnalysis 项带 runtimeState/finalSeverity/evidenceTag（离线 not-executed）+ INV-3 不清除 + severity 秩有效 |
| 启发式检测收敛 | `test/heuristic-detect.test.mjs` | 16 | 句柄捕获感知泄漏（已知安全降级 / leak-context / 全部 BARE 规则）+ 动态工具名按包追踪与显式扫描局限 |
| check --json schema 冻结 | `test/check-report-schema.test.mjs` | 10 | P0-3 冻结 check report schema（schemaVersion/inputs/findings[]/gate）+ gate 门禁（high/blocking 拦截）|
| finding_id 唯一性消重 | `test/finding-id-uniqueness.test.mjs` | 6 | makeFindingId 纳入 involved packages/service/row，区分同类别多条 finding；A-2 message 不变 id（0 碰撞回归）|
| 13 工具快照半集成 | `test/tools-snapshot-smoke.test.mjs` | 13 | 快照驱动调用 13 个工具 + output.schema 最小校验（防 schema/output 漂移），CI 可运行 |
| YAML fail-loud / vm 沙箱 | `test/composition-strict.test.mjs` | 8 | 严格解析接受合法 patch（含 config block scalar、cordis inject 行键）/ 未知行键与顶层条目抛错 / globalThis 逃逸被拒 / dshHomePath 可用 |

测试策略：
- **单一实现回归**：semver-consistency 固定断言 core/semver.js 行为，并守护 dashboard.js 不再内嵌镜像副本
- **VM 真实执行**：ui-plugin-test 用 `vm.createContext` 执行 client.js bundle
- **DOM-mock**：ui-test 用 mock React createElement 模拟仪表盘交互
- **mock fetch**：upgrade-opt.test 用 mock fetch 验证网络逻辑，零真实网络依赖

## 6. 工程资产

| 路径 | 说明 |
| --- | --- |
| `.github/workflows/ci.yml` | CI 模板（Node 22+，运行自包含测试套件；跳过依赖本机路径/真实 harness 的 smoke13.test.mjs） |
| `scripts/generate-dashboard.mjs` | 用当前 dashboard.js 从离线快照重新生成 reports/dashboard.html |
| `scripts/build-ui.mjs` | 构建客户端 bundle（内嵌 dashboard.html 到 client.js） |
| `scripts/mount-ui.mjs` | 挂载脚本（自动探测部署 node_modules；env：DSH_HOME / DSH_DEPLOY_NM / DSH_FORGE_ROOT / DSH_PROFILE_PATCH） |
| `scripts/mount-ui.ps1` | Windows PowerShell 挂载脚本 |
| `pnpm-workspace.yaml` | pnpm workspace 配置 |
| `data/ecosystem.json` | 离线生态快照（`dsh-forge-ecosystem@1` 格式） |
| `data/history/` | 历史快照存档（gitignored，运行期生成；`data/ecosystem.json` 为 versioned 基线） |
| `reports/runtime-verification-checklist.md` | 静态盲区的运行时沙箱验证清单（A 生命周期 / B 事件竞态 / C Seam / D Agent Loop / E 证据规范） |


## 8. 架构设计不变量（Design Invariants）

| 编号 | 不变量 | 违反后果 | 验证方式 |
|---|---|---|---|
| INV-1 | core 层保持离线零依赖，运行时观测逻辑只在 src 插件壳层 | core 无法独立运行，离线审计能力丧失 | CI：纯 Node.js 环境运行 core 测试套件 |
| INV-2 | 运行时校准只观测 dsh-forge 加载之后的事件，不回溯初始化 | 虚假承诺导致漏检，用户信任崩塌 | 文档显式声明 + 测试验证启动时序边界 |
| INV-3 | 运行时未观测到风险仅降级、绝不清除（且未观测三态化，absence≠evidence-of-absence） | 引入新漏检，违反保守性原则 | 单元测试覆盖全部融合降级 + 三态边界（A-1） |
| INV-4 | 真相源降级到 scan 后全局降低置信度上限 | 输出虚假高可靠结果，误导自动化决策 | 自动化测试：scan 模式输出校验 |
| INV-5 | vm 加固仅提升可信配置场景安全性，不用于对抗不可信输入 | 安全边界被突破，代码注入风险 | 安全文档声明 + 威胁模型评审 |
| INV-6 | 所有静态扫描输出必须携带置信度元数据（confidence/evidence），区分推测来源与事实证据 | 证据不可追溯，无法区分误报与真实风险 | Schema 校验：所有 findings 必须含 confidence 字段 |

## 7. 版本策略

- 遵循三位 SemVer（X.Y.Z），使用 prerelease 后缀标识开发阶段（如 `alpha-v0.1.0`）
- hotfix/patch 使用 prerelease 后缀（如 `alpha-v0.1.0-patch.1`），不使用第四位版本号
- harnessVersion 绑定：`0.1.0-rc.6`
- 知识库模式声明验证版本，版本漂移输出 `knowledge-version-drift` 告警