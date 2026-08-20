# Changelog
## [Unreleased]

## [0.1.8] - 2026-08-20

### v0.1.8 预览：live 混合验证打通（harness 内真实生命周期 → 融合）

- **引擎注入点**（`core/index.js` `runAnalysis`）：新增可选 `opts.runtimeCalibration`；live 注入时绕缓存（观测依赖挂载期事件窗，非复现基线），缺省仍 `staticRuntimeCalibration()`（诚实 not-executed），CLI/离线/CI 零变化且可复现。
- **壳总线适配**（`src/index.js`）：新增 `buildHarnessRuntimeCalibration`，把 harness 的 `session/event` 总线经虚拟 ctx 转发为运行时校准器订阅的 top-level 事件并 `start()`；无总线可绑定时 `dispose()` 返回 `null`，回退离线源。
- **工具层 fuse 接线**（`src/tools/conflicts.js`）：`check_conflicts` 先 `fuse` 再输出，findings 携带 `finalSeverity`/`evidenceTag`/`runtimeState`/`finding_id`，顶层附 `runtimeCalibration` 快照；schema 补齐声明。无 live 时 fuse static 基线，输出与 CLI 引擎一致（not-executed，诚实未观测，不视为干净）。
- 说明：harness 壳真机执行依赖 harness 运行时（本环境不可直测），总线→top-level 适配语义经等价单测验证。启发式检测（裸 timer/listener、动态工具名）仍止于可疑级，非形式化证明。

## [0.1.7] - 2026-08-19

### 三展示面融合字段补渲染（弹窗/网页/TUI 一致性）

- **网页/弹窗冲突明细表新增融合列**（`core/dashboard.js`）：`buildEmbedData` 将 v0.1.6 证据融合产物 `finalSeverity` / `evidenceTag` / `runtimeState` 一并注入 embed；`conflictsPage` 冲突明细表由「类型/级别/内容/影响/建议/置信度」扩展为「类型/原始级别/最终级别/证据标签/运行时状态/内容/影响/建议/置信度」。旧数据（无融合字段）安全回退 `finalSeverity → severity`、缺失标 `—`；page-conflicts 引导文案同步。

- **TUI 冲突列表改用最终级别**（`cli/dsh-forge.mjs`）：`renderTui` 冲突筛选与徽章渲染统一使用 `finalSeverity`，与 summary.bySeverity（融合计数）同源一致，不再与原始 severity 混用。

- 说明：融合字段自 v0.1.6 已在 `check --json` 报告 findings 中暴露，本版补齐网页/弹窗/TUI 三条 UI 链路的可视化，收敛三面展示一致性。无新增测试，用例总数保持 921。


## [0.1.6] - 2026-08-19

### 8 项断裂点修复（审计）

- **基数上限溢出可观测（不再静默丢弃）**：`runtime-calibration.js` 击穿 cardinalityCap 时累计 overflowDropped，经 counters()/snapshot() 暴露，攻击性填满 slot 导致关键事件丢失时可被察觉。
- **单调时钟（防时钟回拨误判）**：事件时间戳与默认 startBoundary 改用 process.hrtime（单调），NTP 回拨不再把所有事件判为“start 之前”。
- **dispose 释放引用**：dispose() 清空环形缓冲与 counters/lifecycle 各映射，外部闭包句柄不再残留活快照。
- **融合矩阵补全（INV-3 只降权）**：`evidence-fusion.js` 抽取 resolveFusion 覆盖全 (severity×tier×state)；high+heuristic 等默认分支不再跳过 clean 降级/未观测保持规则。
- **解除 confidence→tier 混淆**：inferTier 仅认 evidenceTier（缺失默认 heuristic），不再把高置信度升格为 static-suspect。
- **next_action 文案集中**：默认 zh-CN 引导/复现文案收敛到 ACTION_NEXT/REPRODUCE_DEFAULT，留 i18n 改造缝。
- **finding_id 哈希扩为 64 位（FNV-1a BigInt）**：16 位 hex，4000+ 插件碰撞概率降至可忽略。
- **capConfidence 改纯函数**：不再突变入参，返回新数组（仅 cap 项拷贝）；index.js 调用方适配返回值。
- 测试：evidence-fusion 23（18→23）、runtime-calibration 25（21→25）、truth-source 17（12→17）；用例总数 883→897。

### P0-4 CI 门禁 + P0-5 锁版本 artifact 复现报告

- **P0-4 CI 门禁**（`ci.yml` 新增 `composition-gate` job）：组合变更 PR 自动跑只读组合契约审计（`check --json --dataset data/ecosystem.json` 离线快照），CLI 在 `gate.pass===false` 时 exit 1，作业失败即拦截 PR；报告上传 artifact 供排障。
- **P0-5 锁版本复现报告**（`core/index.js` 新增 `pkgVersion()`）：报告补 `version`（工具版本，动态读 package.json）/ `reproduce`（精确复现命令，带 `--dataset`）/ `inputs.dataset`（数据集指纹），配合既有 `schemaVersion` / `inputs.rows` / `truthSource` / `harnessVersion` 冻结触发采样的完整输入环境，存档报告可精确追溯复现。
- **CLI 传递复现字段**（`cli/dsh-forge.mjs`）：`jsonSummary` 转发 `--dataset` 与复现命令到 `buildCheckReport`，`inputs.dataset` 不再恒为 null。
- **报告校准**：`finalSeverity` 未设置时回退 `severity`（P0-3 schema 契约默认）；清除恢复脚本引入的重复导出。
- **CI 版本锁守卫**：`Validate schema + version lock + gate` 断言报告 `version === package.json` 且 `schemaVersion === dsh-forge/report@1`，杜绝存档报告相对触发源码的工具版本漂移。

### P0-1/P0-2 默认路径证据融合接线（审计锁定断点）

- **主链路 fuse 接线**（`core/index.js` `runAnalysis`）：对 conflicts/leaks findings 调用 `fuse()` + `staticRuntimeCalibration().evidence()`（离线诚实 not-executed 基线），每条 finding 产出 `finalSeverity` / `evidenceTag` / `runtimeState`，与 `buildCheckReport` / `projectFinding` 投影契约一致——修复「证据融合模块已建、主链路未接线」断点，`check --json` 报告的 findings 携带融合字段。
- **只读注入**：`fuse()` 返回新副本，不改动源 conflict/leak 对象；INV-3 未观测只降权绝不清除，A-1 未观测三态，非运行时观测不视为干净；缓存命中结果保持只读契约。
- **回归锁定**：新增 `test/main-path-fusion.test.mjs`（8 项，占 921 项之一）：锁默认路径 63/63 finding 均 fused、runtimeState / evidenceTag / finalSeverity 齐全、offline 诚实 not-executed、INV-3 主链路无丢失。

### TUI 增强（审计 F1/F2 修复）

- R 键刷新失败不再退出进程：保留旧帧，底部内联红字显示 `refresh failed: ...`（对齐仪表盘 /api/refresh 失败保留旧态的行为）。
- renderTui 新增混合验证元数据行：truthSource（dump-config/auto/scan/snapshot 大写）+ confCap + leaks 计数 + findingsValid（ok / N violation(s)）。
- 版本升级 0.1.5 → 0.1.6（root + ui-plugin 对齐），仪表盘页头与文档版本同步。

### 仪表盘：入门引导 + 名词解释（面向小白）

- 新增「使用引导」默认首页：三步怎么看报告 + 全站统一的级别颜色说明（blocking/high/medium/low/disabled · 致命/错误/警告/信息）。
- 新增名词解释表，覆盖整体健康度/依赖边/版本冲突/工具重名/服务覆盖/真相源/置信度上限/泄漏发现/级别/置信度/假设模拟等术语。
- 任意带虚线下划线的术语（.tip）鼠标悬停即弹出白话解释；关键指标（整体健康度、truthSource、confidenceCap、findingsValid、泄漏发现）均已挂载悬停提示。
- 规范错误/级别中文标签：统一经 SEV_LABELS 输出，消除各表面（错误反馈 / 级别 / 引导页）措辞不一致。
- ui-test 新增引导页/名词解释/工具提示/规范标签 8 项断言（62 → 70）。
- 旧模块（10 个）顶部新增「本页说明」引导条：MODULE_HELP 数据驱动，dashboard() 统一注入，替代逐页手写。
- 抽取 sevBadge() 统一级别徽章渲染，消除错误反馈/冲突/泄漏/模式 4 处重复；tip() 支持「短标签 + 长解释」双参数。
- 扩展名词解释（层 layer / 风险分 risk score / 信号 signal / 状态 active-disabled）；组件状态表表头加悬停详释。
- ui-test 断言扩至 77（70 → 77）。


## [0.1.5] - 2026-08-19

### 静态-运行时混合验证体系（v0.1.5 P0+P1）

- **P1-1 运行时校准**（`core/runtime-calibration.js`）：注入式 ctx（不 import），订阅 Cordis 生命周期事件（plugin/apply、plugin/dispose、tool/call、tool/result、turn/end）；A-4 滑动窗口（N=256）+ 事件基数上限（512）+ 超限丢帧计数优先策略；INV-2 仅观测 start() 之后行为不回溯初始化；A-2 每条 finding 生成稳定 finding_id 绑定运行时证据；dispose() 全量 off 保证可逆性；无 ctx 离线降级诚实 not-executed。
- **P1-2 证据融合引擎**（`core/evidence-fusion.js`）：A-1 未观测三态（not-executed / executed-clean / executed-residual，禁止 absence-of-evidence 当作 evidence-of-absence）；覆盖 7 行融合矩阵（static-suspect/heuristic × residual/clean/not-executed + contract-source）；A-3 升级或 runtime-confirmed 的 high 告警随附 next_action + reproduce_hint；INV-3 未观测仅降级绝不清除。
- **A-2 证据元数据**（`core/evidence.js`）：稳定 finding_id（作用域+名称+类别+位置 FNV 哈希，可复现）；INV-4 置信度上限 capConfidence（只降不升，scan 全局 medium）；INV-6 schema 校验 validateFindings 强制 confidence/evidence 无默认值。
- **P0-1 真相源三态降级**：`core/index.js` runAnalysis 根据 truthSource（dump-config/auto/scan/snapshot）计算有效真相源，scan 全局降级，输出 truthSource + confidenceCap 元数据。
- **P1-3 scanLeaks 联动接线**：`core/index.js` 对 conflicts/leaks findings 统一 attachFindingIds + 按真相源 capConfidence，输出 findingsValid 校验结果；泄漏发现已带 confidence/evidence。
- **P0-3 node:vm 沙箱加固**（`core/composition.js`）：`evalJsExpr` 使用 null 原型隔离全局 + 冻结 process 投影 + 可配置超时（原生），内存限制如实标注非 node:vm 原生能力（尽力近似）。
- **新增测试套件**：evidence-fusion（18 项）、runtime-calibration（21 项）、truth-source-degradation（12 项）；自包含套件 13 → 16，用例总数 832 → 883。
- **仪表盘混合架构补全**（`core/dashboard.js`）：新增「混合验证体系」页（INV-1~6 不变量表 + truthSource / confidenceCap / findingsValid / 泄漏计数 KPI）与「副作用泄漏」页（泄漏表含 finding_id / package）；嵌入数据扩充 truthSource / confidenceCap / findingsValid / mixedNote，conflicts 与 leaks 条目携带 finding_id；workspace 模块导航 8 → 10；该条目经混合架构测试补全——结构（混合页/INV 表/嵌入字段/finding_id/leakSummary）+ 交互（page-inv/page-leaks 切换激活），ui-test 模块标签断言 8 → 10 且新增 14 项混合回归断言，48 → 62。
- **文档同步**：ARCHITECTURE 纳入 25 个模块（+evidence/evidence-fusion/runtime-calibration）+ 8 章设计不变量 INV-1~6 + 3 个新套件清单；README/README.en 同步套件数与用例数；doc-consistency 模块数 22→25、用例总数 832→883。

### 审视后续修复（审计 P2）

- P2-1 版本文案：0.1.4 段 "ui-plugin/package.json bump 0.1.3" 补全为 "bump 0.1.3 → 0.1.4"。
- P2-3 inline comment：strict 解析器对 `name` / `disabled` 标量剥离引号外 `#` 注释（config 块标量保留原样），新增回归用例 composition-strict 5 → 6 项、自包含用例总数 822 → 823。
- P2-4 代码清理：物理删除历史单片 `src/tools.js`（已被 `src/tools/index.js` + 13 模块取代），同步 ARCHITECTURE / src/tools/index.js 注释。

### 仪表盘动态化（混合审查，静态 + 动态）

- 仪表盘改为混合架构：Web 形态每次请求用当前分析结果新鲜渲染（静态层），页头新增 `↻ 刷新` 按钮调用 `GET /api/refresh` 清除分析缓存并重新分析（动态层），客户端脚本无刷新更新嵌入数据，如实反馈组合变更。
- core/dashboard.js 支持 `extra.live` 动态模式：嵌入数据带 `live` 标记与 `sourceLabel`，live 模式渲染页头工具区（实时徽标 + 刷新按钮），静态快照优雅降级隐藏控件。
- cli/dsh-forge.mjs Web 服务改为每请求新鲜渲染，新增 `/api/refresh` 端点（clearAnalysisCache → 重新 runAnalysis → buildEmbedData live）。
- web/dashboard-client.js 暴露 `window.__DSH_APP__.refresh()`，绑定刷新按钮，处理加载 / 错误（stale 徽标）状态。
- ui-test 新增 live 模式回归块（刷新按钮 / live 徽标 / live:true 嵌入 / 静态优雅降级 / 客户端 refresh 暴露），41 → 48 项；自包含用例总数 823 → 830。

### P0 修复：strict 解析器支持 cordis inject 行键

- 严格解析器（parseCompositionTextStrict）误把 cordis bundle 补丁（dsh-web-app 等）合法的结构化行键 `inject`（声明注入的子插件，支持嵌套 `- id:` 列表与内联 `inject: [a, b]` 形式）当作未知行键拒绝，导致启动预检 FATAL FORGE-001。现识别 `inject` 为合法行键，其嵌套 `- id:` 条目按更深缩进自动作为独立插件行解析。
- 回归用例：composition-strict 新增 inject 嵌套行 / 内联列表 2 项，6 → 8 项；自包含用例总数 830 → 832。

## [0.1.4] - 2026-08-17

### 审视整改补丁（0.1.4）

- 版本对齐：ui-plugin/package.json bump 0.1.3 → 0.1.4；core/dashboard.js 页头版本改为动态读取 package.json（不再硬编码 0.1.2）；doc-consistency 增加 root/ui-plugin/docs/dashboard 版本一致性断言。
- 缓存补洞：discoverSources 层描述带 `path`；runAnalysis 缓存 key 纳入自动发现的 live 源文件（profile cordis.yml / package.json / cordis.patch.yml / bundle patch）mtime+size，配置改动自动失效；缓存结果标注只读契约。
- decideUiMode env 一致性：term/ci/desktop/scenario 统一使用 opts.env（默认 process.env），并新增 env-only 桌面检测测试（mode-decision 18 → 19 项）。
- diff_combinations 支持 history 文件名：datasetA/datasetB 先按 data/history 文件名解析，再按完整路径解析；datasetB 存在时缺失 datasetA 给出明确错误。
- CLI 边缘修复：web 端口占用/服务错误降级到 check 时尊重 --json；监听端口取 server.address().port（--port 0 不再显示 :0 URL）。
- render 增强：check_conflicts 展开前 20 条 info 级发现（超量提示查完整 JSON）；snapshot_history 对 rows=0 快照标 [empty]。
- 文档同步：README/README.en 测试套件 13 套 822 项（含 cache-behavior 7 项、mode-decision 19 项、tools-snapshot-smoke 13 项、composition-strict 5 项）；doc-consistency 增加套件计数 / cache-behavior 引用 / 总数断言。

### 审视 P0/P1/P2 整改

- P0 沙箱：core/composition.js `evalJsExpr` 由 `new Function` 改为 `node:vm` 隔离上下文（冻结 process 形状对象 + 禁用代码生成），strict 模式下求值失败显式抛错。
- P0 YAML fail-loud：新增 `parseCompositionTextStrict`（行号 + layer 报错），`collectEcosystem/mergeRows` 默认走严格解析；不支持的顶层条目 / 行键 / disabled 值 / block scalar 不再静默忽略。
- P1 仓库策略：`data/history/` 加入 .gitignore；npm `files` 由 `data` 收窄为 `data/ecosystem.json`；smoke13 默认快照改为 versioned `data/ecosystem.json`。
- P1 工具拆分：`src/tools/` 每工具一文件（13 个模块 + common.js + index.js 聚合），`src/index.js` 与 smoke13 改引 `src/tools/index.js`；旧 `src/tools.js` 保留为历史单片文件、不再被引用。
- P1 快照迁移：`loadSnapshot` 支持格式迁移链（`SNAPSHOT_FORMAT` / `registerSnapshotMigration` / legacy `unversioned`），不兼容格式给出可行动错误与 `migratedFrom` 标注。
- P2 CI 半集成 smoke：新增 `test/tools-snapshot-smoke.test.mjs`（snapshot 驱动 + output.schema 最小校验器，覆盖 13 工具）；ci.yml 语法检查覆盖 `src/tools/*.js`。
- P2 文档断言：doc-consistency 增加 ARCHITECTURE 与 CHANGELOG 版本断言。
- 运行时盲区落地：新增 `reports/runtime-verification-checklist.md`（A 生命周期 / B 事件竞态 / C Capability Seam / D Agent Loop / E 证据规范）；`core/knowledge.js` 导出 `RUNTIME_VERIFICATION_CHECKS` 并对 agent-loop 行输出 D1–D4 运行期验证提示；专家 prompt 增加“静态盲区与运行时验证”章节。

## [0.1.3] - 2026-08-16

### TUI / Web / check 三态入口

- 新增 `core/mode.js`：四层证据决策引擎（启动命令 → 运行环境 TTY/TERM/CI/桌面会话 → 用户场景 SSH/编辑器/自动化 → 插件数量复杂度），`decideUiMode` / `hasDesktop` / `scenarioHints` / `decideAfterPortProbe` 全部纯函数、零依赖。
- 新增 `cli/dsh-forge.mjs` 并注册为 package.json `bin.dsh-forge`：
  - `dsh-forge` 自动决策（真实终端默认 TUI）；
  - `dsh-forge tui` 强制 TUI（ANSI 渲染，`W` 一键开 Web、`R` 刷新、`Q` 退出）；
  - `dsh-forge web|serve` 强制 Web（node:http + 8 模块交互仪表盘，缺 web/dashboard-client.js 时回退自包含 SVG 拓扑页；自动打开浏览器，端口占用自动降级 TUI/check）；
  - `dsh-forge check|ci [--json]` 纯日志/机器输出，面向 CI/CD 与监控消费。
- TUI 与 Web 双壳复用同一 `core/` 分析引擎，未引入 ink/blessed/Express/ECharts 等第三方依赖。
- core/dashboard.js 页头数据源标签动态化：离线快照显示快照时间（可复现），实时组合显示 truthSource。
- 新增 `test/mode-decision.test.mjs`：四层决策 + 端口降级 + 场景启发共 18 项自包含测试。
### P0 修复

- 文档模块计数统一为 22（README / README.en / ARCHITECTURE），ARCHITECTURE 模块表补列 `core/errors.js`。
- 消除 SemVer 双实现：core/dashboard.js 移除内嵌 browser-mirror semver（浏览器端本无调用，属死代码），改为 `import { satisfies } from "./semver.js"` 单一事实源；semver-consistency 改为单一实现固定断言（30 用例）+ 防 dashboard 镜像回归。

### P1 修复 / 还债

- 分析缓存：core/index.js `runAnalysis` 新增基于输入参数 + 文件 mtime 的内存缓存（上限 16 条），重复分析相同组合直接命中，显著降低 TUI 下重复调用开销；提供 `clearAnalysisCache()` 强制刷新（TUI `R` 键、测试、配置变更后），缓存键含 dataset 指纹，文件改动自动失效。
- 代码卫生：清理 8 处无注释的空 catch 块（cli/dsh-forge.mjs ×3、src/index.js、core/simulate.js、core/upgrade.js、core/composition.js、core/verify.js），逐一标注吞错原因；移除 cli/dsh-forge.mjs 冗余变量 `HELP_TEXT = HELP`，直接使用 `HELP`。
- 测试命名统一：`test/semver-consistency.mjs`、`test/smoke13.mjs`、`test/exploratory-empty.mjs`、`test/exploratory-feedback.mjs` 统一为 `.test.mjs` 后缀；同步 ci.yml 的 smoke13 跳过模式、README / README.en / ARCHITECTURE 文件名引用。
- 工程加固（审视落地）：新增 `test/cache-behavior.test.mjs` 缓存守护（同参命中 / clear 失效 / 内容变更 / mtime-touch / 上限淘汰 / 快照，6 项）；`src/` 与 `core/` 双入口职责决策说明（ARCHITECTURE §2.2 + src/index.js 头注）；新增 `scripts/check-doc-consistency.mjs` 文档一致性 CI 断言（测试命名 / 模块计数 22 / smoke13 跳过 / Unreleased）并接入 ci.yml；历史审计报告（audit-v0.1.1 / PM-review-v4 / deep-verification / analysis-report / PM-remediation）标注「快照，不代表当前」；新增 `.githooks/pre-commit` 快速门禁（`git config core.hooksPath .githooks` 启用）+ package.json scripts（doc:check / precommit）+ .gitignore 忽略 reports/plugin-graph-live.html。

## [0.1.2] - 2026-08-16

### 仪表盘 workspace 布局（对齐 client.js）

- core/dashboard.js 的 dashboard() 重写为 workspace 结构：固定顶部 .ws-header + 左侧 .ws-nav 8 模块导航（错误与反馈 / 概览 / 组件状态表 / 依赖图谱 / 冲突与发现 / 共享依赖 / 已知模式与验证 / 假设模拟）+ 右侧 .ws-body 独立滚动，彻底对齐 ui-plugin/lib/client.js 嵌入布局。
- 修复 buildEmbedData 候选生成：allManifests 缺失（离线 / 生产路径）时回退为空依赖数组，恢复 32 个可添加候选（模拟"添加"功能可用）。
- 新增 scripts/generate-dashboard.mjs：离线快照 data/ecosystem.json → 用当前 dashboard.js 重新生成 reports/dashboard.html（可复现，不依赖 harness）。

### P0 schema 一致性

- check_conflicts 输出 schema 补全 kind / evidenceTier 字段。
- visualize_plugins 无 writePath 时省略 writtenTo（不再返回 null）；snapshot_history 未加载时省略 loaded；analyze_dependencies 省略空 harnessVersion；check_conflicts 省略空 calibration；verify_rows 省略空 runtimeProbe。

### P1 正确性

- core/analyze.js riskScore 信号 detail 回退链（c.message || c.evidence || c.type），消除对已移除字段的依赖。
- core/errors.js 已验证条目（FORGE-013）改为中文摘要 + 原始 note 进 detail；FORGE-014 标注 global。
- archive_snapshot 新增 dryRun 参数（不写盘，仅报告文件名与行数），smoke13 改用 dryRun。
- core/scope.js 作用域扫描扩展到 lib/ + src/ 双目录；core/verify.js verify_rows 支持 profile 参数。

### P2 可部署性

- scripts/mount-ui.mjs / mount-ui.ps1 移除硬编码 npx 缓存路径，自动探测部署 node_modules（支持 DSH_DEPLOY_NM / DSH_FORGE_ROOT / DSH_HOME / DSH_PROFILE_PATCH 覆盖）。
- test/smoke13.mjs 移除硬编码路径（HISTORY_DIR / SNAP / PRESETS 环境化）。

### 测试

- 全量回归：ui-test 41 + ui-plugin-test 22 + semver-consistency 30 + review-fixes 15 + upgrade-opt 16 + feedback-smoke 40 + empty-plugins 24 + exploratory-empty 27 + exploratory-feedback 563 = 778/778；smoke13 13/13 依赖本机 harness，不入 CI。

## [0.1.1] - 2026-08-15

### 统一错误反馈体系

- core/errors.js：反馈归一化（code/severity/detail/guidance/source/recoverable）+ 聚合 + 启动预检 + 渲染。
- 仪表盘"错误与反馈"面板（错误优先分组、错误码、建议、来源）。
- 启动预检输出到终端（[dsh-forge] FATAL/WARN + 完整诊断），覆盖崩溃场景。
- check_conflicts 输出 feedback 字段（render 优先展示）。
- 保留网页侧边栏仪表盘入口（sidebar.footer.action）；删除会话头入口（conversation.session.header.actions），仅保留对话流提示卡片（turnTail）。
- 测试：ui-plugin-test 22/22（更新断言）；全量回归全绿（ui-test 36/36 + ui-plugin-test 22/22 + semver 30/30 + review-fixes 15/15 + upgrade-opt 16/16 + feedback-smoke 40/40 + empty-plugins 24/24 + exploratory-empty 27/27 + exploratory-feedback 563/563 = 773/773；smoke13 13/13 依赖本机 harness，不入 CI）。

### 审计与 CI 工程化

- ci.yml：运行全部自包含测试套件（跳过依赖本机路径/真实 harness 的 smoke13.mjs），测试失败以非零退出码传播（node "$file" || exit 1）；保留语法检查与 core 模块加载检查。
- 测试退出码补全：ui-test.mjs / ui-plugin-test.mjs 末尾新增 process.exit(failed ? 1 : 0)；ui-plugin-test.mjs 移除重复断言（计数 23 -> 22）。
- 文档一致性修正：ARCHITECTURE.md / PM-remediation.md / README(.en).md 的 UI slot 描述、入口方向、测试项数全部对齐代码实现。
- 正式审计报告：reports/audit-v0.1.1.md（文档一致性 / CI 有效性 / 退出码完整性 / 重复断言 四项全 PASS，9 套件 773/773 通过）。

## [0.1.0] - 2026-08-14

### 评审整改（R0-R5 验收标准）

- **R0 接地真相**：新增 dump-config 真相源（truthSource: auto|dump-config|scan，默认 auto）：消费 harness 官方 dsh --dump-config 生效组合树（含层溯源 provenance），替代纯源码重建；scan 模式保留并标注可能偏离。
- **R1 校准诚实**：所有风险分/健康度声明 calibrated: false + 未校准免责声明；冲突条目分级 kind: contract|heuristic；移除伪精确表述。
- **R2 版本绑定**：快照记录 harnessVersion（0.1.0-rc.6）；知识库模式声明验证版本，版本漂移输出 knowledge-version-drift 告警。
- **R3 健全性**：新增非可逆副作用泄漏扫描（scanLeaks：裸 setInterval/process.on/addEventListener 注册 vs 清理配对），纳入 check_conflicts 输出。
- **R4 精确性**：冲突条目 evidenceTier: static-suspect|contract-source；工具名扫描扩展动态注册模式并输出 dynamic-registration hint；检测标注为疑似清单而非 harness 实际拒绝确认。
- **R5 可行动**：保留证据链/dashboard/模拟/补丁建议。
- semver 支持部分版本号（^1.2 / ~1.2 / 1.x / 1.2.x / 1.2 / 部分比较器）；两份实现一致性测试 30/30（修复内联 prerelease 比较缺陷）。
- 挂载脚本路径 env 化（DSH_HOME / DSH_DEPLOY_NM）；CI 模板（.github/workflows/ci.yml）。

### 审视报告（PM-review-v4）P0/P1 修复

- 作用域感知冲突判定（core/scope.js）：per-agent 变体合法，全局同名才是 contract 硬错（E3 实证）。
- 运行期事件校准（core/calibration.js）：订阅 session/event（tool/call、tool/result、turn/end），check_conflicts 输出行为基线；离线诚实标注无基线（E6 实证）。
- 泄漏扫描 apply 路径切片 + 文件位置证据；非 apply 注册降为 info。
- service-collision impact 中性化（provide 重复语义待实证）。
- 修复模板转义缺陷（\b 变为退格字符导致泄漏规则静默失效）。
- 知识库：client-runner-timer-redirect 已知模式（误报排除）。

### 审视者三点确认修复

- 泄漏误报排除落地到输出层：KNOWN_SAFE_TIMER_PACKAGES 过滤（leak-known-safe 降级），修复 knowledge break bug（附注包与泄漏候选不对应）。
- check_conflicts 输出 inputScope（rows/layers/disabledRows/truthSource）——82 vs 63 差异归因为输入集不同（preset 层重新启用 19 行），数字可复现。
- 清理测试调试残留与硬编码路径；smoke13.mjs require→import 修复（13 工具 smoke 全绿）。

### check_upgrades 落地性/可靠性/独立性优化

- 性能：固定并发池（默认 6，可配）+ 独立超时（默认 3.5s 快速失败，可配）；原串行 6s×N 最坏 240s，40 包最坏上界降至约 25s（实测 6 包 3s）。
- 可靠性：registry 镜像自动降级（npmjs 连续失败 ≥2 次切 npmmirror），候选标注实际来源；网络失败单独上报（networkFailures），不再静默吞掉。
- 独立性/落地性：支持显式 packages/registry/timeoutMs 参数（不依赖本机快照）；candidate 附可直接执行安装命令（dsh plugin add <pkg>@<latest>）；输出 elapsedMs 自报耗时。
- 工具参数与输出 schema 同步扩展（registry/timeoutMs / registrySource/elapsedMs/networkFailures）。

### 路径与 schema 修复

- src/index.js 修复 core 模块导入路径（./core → ../core）。
- core/index.js 门面补导出 createCalibration / staticCalibration。
- 所有 type:"object" schema 显式声明 additionalProperties（calibration / inputScope / check_upgrades 输出）。

### 测试

- 新增 test/review-fixes.test.mjs（作用域三态 / mock 事件校准 / 泄漏切片），15/15。
- 新增 test/upgrade-opt.test.mjs（mock fetch 自包含，零网络），16/16。
- 全量回归：review-fixes 15 + ui-test 36 + ui-plugin-test 22 + semver-consistency 30 + upgrade-opt 16 = 119/119。

### 架构说明（三层分离，详见 [ARCHITECTURE.md](./ARCHITECTURE.md)）

```
core/          零依赖分析引擎（22 个模块，仅 Node 内置 API）
  ├─ composition.js   组合源发现 + YAML 解析 + 生态收集
  ├─ truth.js         dump-config 真相源（auto/dump-config/scan 三态）
  ├─ analyze.js       依赖图构建 + 风险评估
  ├─ conflicts.js     冲突检测（版本/工具/服务/泄漏）
  ├─ scope.js         作用域感知（global vs per-agent 变体）
  ├─ calibration.js   运行期事件校准（行为基线）
  ├─ leaks.js         非可逆副作用泄漏扫描
  ├─ semver.js        SemVer 解析 + 区间满足性
  ├─ upgrade.js       npm registry 升级检查（并发池 + 镜像降级）
  └─ ...              audit / diff / simulate / visualize / dashboard / history / stats / presets / verify / suggest / knowledge
src/          cordis 插件壳（13 个工具的 schema 定义 + 注册）
ui-plugin/    浏览器端客户端插件（3 个 slot：sidebar / 会话头 / 对话流引导 + modal 仪表盘）
```

- **零副作用**：所有工具只读；`simulate_combination` 操作虚拟副本，`archive_snapshot` 仅写 data/history。
- **零依赖引擎**：core/ 仅用 Node 内置 API（fs / path / module）。
- **诚实声明**：静态扫描标注 `confidence` / `evidenceTier`；未校准数据标 `calibrated: false` + 免责声明。

数据流要点：
- **selectEco**：dump-config（首选，dsh --dump-config 消费生效组合树）→ 失败降级 scan（源码扫描重建）+ warnings；truthSource 显式标注。
- **check_conflicts**：buildGraph → checkConflicts（版本/工具作用域分级/服务/泄漏）→ calibration.snapshot() 运行期基线 → 输出 conflicts/leaks/calibration/inputScope/truthSource/disclaimer。
- **check_upgrades**：并发池（6）查 npm registry → 主源连续失败≥2 切镜像 → 独立超时（3.5s）→ 阻断预测 satisfies(latest, range) → 附 installCmd。

### 插件安装步骤（link 依赖持久化）

本插件由两个包组成，均通过 **link 依赖** 装入 dsh profile（symlink 指向源码，改代码即生效）：

- **dsh-forge**（host 插件）：13 个分析工具，在 HOST 平面运行
- **dsh-forge-ui**（client 插件）：GUI sidebar 底部「▦ 插件仪表盘」入口，弹窗显示 `reports/dashboard.html`

#### 前置条件

- Node.js ≥ 20（实测 v24.18.0）
- 已安装 DeepSeek Harness CLI：`npx @deepseek-ai/dsh --version` 可执行
- 已有目标 profile（默认 `web`，位于 `$HOME/.dsh/profiles/web/`）

#### 第 1 步：获取源码

```bash
git clone https://gitee.com/mkieaAG367/dsh-forge.git
cd dsh-forge
```

#### 第 2 步：持久化安装到 profile（link 依赖，推荐）

dsh 的 profile 本身是 pnpm 工作区，`dsh plugin` 是 **pnpm 透传封装**。用 `link:` 依赖链进 profile：

```bash
# host 插件（13 个分析工具）
npx @deepseek-ai/dsh plugin --profile web add "dsh-forge@link:C:/Users/<you>/DeepForge/dsh-forge"

# client 插件（GUI 仪表盘入口）
npx @deepseek-ai/dsh plugin --profile web add "dsh-forge-ui@link:C:/Users/<you>/DeepForge/dsh-forge/ui-plugin"
```

**等价手工方式**：编辑 `$HOME/.dsh/profiles/web/package.json` 的 `dependencies` 追加两行 `link:` 依赖，然后在 profile 目录执行 `pnpm install`。

完成后确认 symlink：

```powershell
Get-Item "$HOME\.dsh\profiles\web\node_modules\dsh-forge" | Select-Object -ExpandProperty Target
# -> C:\Users\<you>\DeepForge\dsh-forge
```

#### 第 3 步：配置组合补丁 cordis.patch.yml

编辑 `$HOME/.dsh/profiles/web/cordis.patch.yml`，**追加**两行 insert：

```yaml
- insert:
    - id: forge
      name: 'dsh-forge'
      config:
        profile: web
- insert:
    - id: forge-ui
      name: 'dsh-forge-ui'
```

> `config.profile` 告诉 host 插件从哪个 profile 发现组合；`forge-ui` 不需要 config。
> 已存在同名 insert 时不要重复追加（追加后 harness 会重复注册插件）。

**背景说明**：profile 根 `cordis.yml` 是空入口 `[]`，组合树完全由 patch 层构成：
`dsh.profile.bundles`（dsh-base / dsh-web-app）→ `cordis.patch.yml` → `--patch` 覆盖，
因此**只改 cordis.patch.yml，不改 cordis.yml**。每个 `- insert:` 是顶层 loader patch entry：
`id` 是行标识（幂等去重键），`name` 是包名（从 node_modules 解析），`config` 传给插件的 `apply(ctx, config)`。

#### 第 4 步：重启 harness

```bash
npx @deepseek-ai/dsh web
```

成功标志：启动日志无 `Cannot find module` / schema 校验（`JsonSchemaError`）报错，服务监听 `http://127.0.0.1:3080`。

#### 第 5 步：验证

1. 浏览器打开 `http://127.0.0.1:3080`，控制台无报错
2. sidebar 底部出现「▦ 插件仪表盘」按钮（点击弹窗显示仪表盘）
3. 对话中可调用 13 个工具
4. 离线快速自检：

```bash
cd dsh-forge && node --input-type=module -e "import('./src/index.js').then(m => console.log('plugin import OK:', m.name))"
```

#### 开发模式：改动生效机制

| 改动内容 | 生效方式 |
| --- | --- |
| host 插件代码（`core/`、`src/`） | **必须重启 harness**（模块已缓存，且 defineTool 在 apply 时编译 schema） |
| client 插件内容（`ui-plugin/lib/client.js`） | symlink 即时同步，但 manifest / 插件集合变更需重启 |
| 仪表盘内容（`web/`、`reports/dashboard.html`） | `node scripts/build-ui.mjs`（重新内嵌 dashboard.html 到 client.js）→ 重启 |
| 一键挂载（免手工复制） | `node scripts/mount-ui.mjs`（支持 `DSH_DEPLOY_NM` / `DSH_PROFILE_PATCH` 环境变量覆盖） |

#### 卸载

```bash
cd "$HOME/.dsh/profiles/web"
npx @deepseek-ai/dsh plugin --profile web remove dsh-forge dsh-forge-ui
```

并从 `cordis.patch.yml` 移除对应两行 insert，重启 harness。

#### 组合发现机制（host 插件运行时）

运行时从 `$DSH_HOME/profiles/<profile>` 自动发现组合：profile 根 `cordis.yml` →
**bundle 补丁（dsh-base / dsh-web-app，自动定位部署根）** → `cordis.patch.yml`；
包清单与已安装版本从部署 node_modules 读取（无需传 `root`）。也可传 `compositionSources` / `dataset` / `root` 覆盖。
## [0.1.0] - 2026-08-13

- 初始版本：4 个分析工具 + 仪表盘 + 快照 + 13 工具扩展（见 README）。