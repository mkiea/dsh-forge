# DeepSeek Harness 插件组合分析报告

> **快照标注**：本报告是**历史审计快照**，基于当时版本，不代表当前代码状态；现状以 README / ARCHITECTURE / CHANGELOG 与实时测试为准。

> 工具：dsh-forge（analyze_dependencies / check_conflicts / visualize_plugins / simulate_combination）
> 分析时间：2026-08-13T18:24:52.668Z · 数据源：`data/ecosystem.json` 快照（离线可复现）
> 分析范围：Web profile（host 平面：profile 根 → `dsh-base` → `dsh-web-app` → `profile-patch`）+ **preset:standard**（本会话真实装载，经工具面反推确认）
> 深度验证：详见 `reports/deep-verification.md`（源码级取证，本报告数字已含修正）

## 一、组合概况

| 指标 | 值 |
| --- | --- |
| 组合行数 | **136**（Web profile 129 行 + preset:standard 独占 7 行；插件 131 个） |
| 唯一插件包 | **126**（全树扫描确认无双重实例） |
| 依赖边 | **1244**（插件间 549 · 外部 695，全部范围满足） |
| 运行时核心 | `@deepseek-ai/cordis@4.0.1` · `cosmokit@1.8.2` · `schemastery@3.18.1` · `dsh@0.1.0-rc.6` |
| 版本基线 | `0.1.0-rc.6`（124 包一致；仅 cordis 生态的 timer@1.1.3 / hmr@1.0.16 例外，属正常） |
| 平台切换行 | bash-sandbox / tool-bash / tool-pwsh / pwsh-sandbox（`!!js process.platform`） |
| 有意禁用行 | hmr、skill-badge、tool-str-replace-editor、tool-subagent-codex、tool-subagent-claude-code 等 7 行 |

**整体健康度：A**（avg 风险 0.1 / max 10；blocking 0 · high 0 · medium 0 · low 124 · disabled 7）

## 二、依赖树要点

- **全链可满足**：1244 条依赖边按 Node 语义（含嵌套 node_modules 逐消费方解析）**0 条不满足**。
- **共享依赖 TOP**：`cordis@4.0.1` x131 · `dsh-invariants` x129 · `schemastery@3.18.1` x73 · `react@18.3.1` x31 · `dsh-client-ui-slots` x30 · `zod@4.4.3` x18 · `dsh-settings`(基类) x15 · `dsh-scope`(库) x13。
- **同包多行**：`dsh-tool-subagent` 四行（subagent / subagent_fork / codex / claude-code，后两者禁用；`toolName` 由 config 驱动已取证）；`dsh-web-app` 的 `/startup` 子路径。
- **基类间接提供服务**：`dsh-settings-file`、`dsh-credentials-local` 等叶子行经共享基类注册服务（`super(ctx, 'settings')` 已取证）→ 名称推断补全（29 条 info）。

## 三、冲突清单（共 63 条，全部信息级）

**高 / 中 / 阻断：0 条**（0 版本冲突 · 0 工具重名 · 0 服务覆盖——经 host/client 平面分离 + 全树版本扫描双重校验）

- 27 × row-override：patch 语义"后层覆盖先层"（base 定义 → web-app 禁用 → preset 会话内重启用），预期行为。
- 29 × provider-indirection：服务经基类间接注册，host 静态扫描不可见（推断已用 `dsh-settings` 源码验证）。
- 7 × disabled-row：设计内禁用（含平台切换求值）。

> 语义确认：工具重名时注册表**响亮失败**（`tool "X" is already registered`），不存在静默覆盖——0 冲突意味着零注册失败。

## 四、风险评分（插件级，0–100）

| 插件行 | 包 | 分数 | 级别 | 信号 |
| --- | --- | --- | --- | --- |
| directory-picker | dsh-host-directory-picker-auto | **10** | low | 4× alternate-variant-peer（**已核实**：运行时 `ctx.loader.create` 动态装载，变体包全部已安装 → 预期可用） |
| 其余 123 个活动行 | — | 0 | low | 无信号 |

**最脆弱路径**：`directory-picker`（10）→ `@deepseek-ai/dsh-host-webserver`。残余风险：node_modules 裁剪变体包会使本行整体激活失败。

## 五、风险预测（深度验证后）

### P1 — 版本兼容性：cordis 锁 4.x，旧生态插件必失败 `[确证]` 置信度：高
- 证据：131 条 `cordis@^4.0.1` 边全部满足 + 全树无 cordis 3.x 副本；SIM2 实测：加 peer `cordis@^3.0.0` 的假设插件 → 新增 **high 版本冲突**。
- 预测：任何 cordis/koishi 3.x 时代第三方插件在本实例**加载即失败**；接入前先跑 `simulate_combination`。

### P2 — 目录选择器 `[确证]` 置信度：高（原"UI 降级"预测修正）
- 证据：`resolveDirectoryPickerBackend` + `ctx.loader.create` 源码（详见 deep-verification §2）。本实例 win32 + loopback → 预期 `native` 后端，4 变体包已安装。
- 预测：选择器预期可用；唯一风险是**包裁剪**导致本行激活失败。

### P3 — 平台切换：本实例（Windows）无 bash 工具链 `[确证]` 置信度：高
- 证据：`disabled: !!js process.platform === 'win32'` 求值为 true。
- 预测：bash 依赖型插件/技能不可用，pwsh 接管；换非 win32 部署或覆盖禁用可恢复。

### P4 — 遥测默认关闭 `[确证]` 置信度：高
- 证据：`mode: !!js process.env.DSH_TELEMETRY_MODE || 'DISABLED'`；源码含 `forceFlush()` / `shutdownTimeoutMillis`。
- 预测：默认零上报；开启且 collector 不可达时退出拖慢以 3s 为界。

### P5 — 会话全文搜索禁用 `[确证]` 置信度：高
- 证据：`openAt: never`；错误码 `SESSION_QUERY_SEARCH_DISABLED` 在请求前抛出（原文核对）。
- 预测：内容搜索调用失败；标题/工作区名匹配可用。需内容搜索时 patch 覆盖 `openAt: first-search` + 持久化 `path`（SIM4 已验证无新冲突）。

### P6 — pi-ai 休眠挂载 `[确证]` 置信度：高 · P7 — subagent 工具四行 `[确证]` 置信度：高（`toolName` config 驱动已取证）· P8 — 弃用标记扫描 0 条 `[确证]` 置信度：中

## 六、组合模拟记录（simulate_combination，均不落盘）

| 模拟 | 操作 | 结果 |
| --- | --- | --- |
| SIM1 | 挂载 directory-picker-browse + native 变体行 | 健康度不变（机制已核实为运行时装载，行级挂载非必需） |
| SIM2 | 加入假设插件 koishi-plugin-legacy-chat（peer cordis@^3.0.0） | 新增 **1 条 high 版本冲突**（cordis ^3.0.0 vs 4.0.1） |
| SIM3 | 移除 tool-web / web / web-search-deepseek | 中性，0 新增冲突（无静态消费者） |
| SIM4 | 覆盖 session-query-sqlite openAt=first-search | 中性，0 新增冲突 |

## 七、可视化与仪表盘

- 交互仪表盘（推荐）：`reports/dashboard.html` —— 组件状态表（搜索/筛选/排序/逐行禁用模拟）、KPI、风险分布环形图、分层柱状图、依赖图谱、冲突表、共享依赖、已知模式与运行时验证、**浏览器端假设模拟**（添加/移除行实时重算健康度）。界面已通过 36 项自动化测试（`reports/ui-test-results.md`）。
- 依赖图谱（静态 HTML）：`reports/plugin-graph.html` · Mermaid：`reports/plugin-graph.mmd` · ASCII 树：`reports/dependency-trees.txt`

## 八、深度验证与局限

- 深度验证全文：`reports/deep-verification.md`（全树版本扫描、机制取证、错误码核对、semver 单元测试、预设对比）。
- 局限：① 快照时效性（组合变更后需重新采集）；② provider-indirection 为名称推断；③ host/client 平面分离依赖文件命名约定；④ 会话平面以 cordis preset 为例。