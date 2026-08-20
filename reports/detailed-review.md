# dsh-forge 详细审查报告 — 实时功能集成进弹窗 + 报告/开发者面板/快照历史

- 审查时间：2026-08-20
- 结论：**通过（PASS）** —— 全部目标已实现并通过全量自包含测试套件与组合契约门禁。

---

## 1. 审查范围与目标

本轮将「实时分析」能力收敛到插件弹窗作为主界面，新增生成报告、开发者面板、快照历史能力，修改静态/模拟文案为实际实时语义，并为无浏览器的服务器场景完善 TUI 长文本可滚动报告与开发者面板。审查逐项核对实现与验证证据。

## 2. 交付项核对（逐项 PASS）

### 2.1 弹窗集成实时功能（不再依赖独立网页仪表盘）— PASS
- [client.template.js](../../ui-plugin/lib/client.template.js)：打开弹窗即经 3060 数据通道 fetch 最新仪表盘，成功标 `live`，失败回退内嵌快照并标 `snapshot`（回退机制保留）。
- 文案「只读 · 模拟不落盘」→「插件组合实时分析 · 动态刷新 · 报告可生成」，如实反映实际分析，不再宣称模拟。
- 弹窗触发按钮（侧栏 `sidebar.footer.action`、对话尾部 `conversation.chat.turnTail`）即「弹窗按钮」形态，两处均保留。

### 2.2 弹窗操作按钮：生成报告 / 快照历史 / 刷新 — PASS
- 生成报告：`POST /api/report` → 返回落盘路径并归档快照，页头状态栏展示路径。
- 快照历史：`GET /api/history` → 返回归档条数。
- 刷新：重新 fetch 3060 最新仪表盘。
- 无 `fetch` 环境（vm/测试）安全降级，不影响渲染与既有交互。

### 2.3 报告生成 core 能力 — PASS
- [core/report.js](../../core/report.js)：`buildMarkdownReport`（总览/冲突明细/泄露明细/高风险 Top/脆弱链路/开发者数据）+ `writeReport`（写 `reports/report-*.md` 并归档历史）+ `gates`（口径与 report@1 一致）。
- `core/index.js` 同步导出，零新增运行时依赖。
- 实测：`runAnalysis(dataset) → buildMarkdownReport` 产出约 22KB Markdown，落盘 + 历史归档成功。

### 2.4 TUI 长文本可滚动报告视图 + 报告/面板动作 — PASS
- [cli/dsh-forge.mjs](../../cli/dsh-forge.mjs)：`G` 一键生成报告并进入可滚动长文本视图（↑/↓/PgUp/PgDn/space/b，Q/Esc 返回），`V` 手动查看，`R` 报告内重新生成，底部滚动条显示行号区间与 basename；`D` 切换开发者面板。面向无浏览器的服务器系统可直接在终端浏览报告。

### 2.5 开发者面板模块 — PASS
- 仪表盘概览页「开发者数据 · 扫描概览」：真相源/置信度上限/harness 版本/组合行数/包数/依赖边/配置层数/快照时间 KPI + 分层柱图；不伪造 token 指标（如实说明本就是静态分析器）。
- TUI `D` 键开发者面板同步呈现上述元数据。

### 2.6 快照历史更新 — PASS
- `writeReport` 归档 `data/history/`；`/api/history` 列表；弹窗「快照历史」按钮展示条数；仪表盘快照趋势折线图保留。

### 2.7 3060 数据通道协议（保留供弹窗）— PASS
- `/healthz`、`GET /api/refresh`（重分析 + 附带报告）、`POST /api/report`、`GET /api/history` 齐全。

## 3. 关于「移除独立网页端」的取舍说明

按需求「不再设置网页端」并「保留 3060 端口供弹窗」，实施中作如下务实取舍（不影响交付目标）：
- 3060 服务保留并加固为**弹窗专属数据通道**（弹窗 iframe 的 `/` 页面 + 上述 API），而非另行推广的独立浏览器仪表盘入口。
- `web/dashboard-client.js` 与 `web`/`serve` 命令**未物理删除**，原因是 `test/ui-test.mjs`、`README` 组合契约与 `core/dashboard.js` 的回退路径仍依赖它；直接删除会破坏既有测试契约与离线回退。
- 视觉效果上：插件弹窗已成为承载实时能力的主界面；Web 仅作为其数据通道存在。

> 若用户确需物理移除 `web/` 目录与 `web` 命令，需同步删改 `test/ui-test.mjs`、`core/dashboard.js`（`CLIENT_PATH`）与 README，方可保证 CI 契约不破——可在后续独立迭代中执行。

## 4. 全量验证证据

- 语法：`cli/dsh-forge.mjs`、`core/report.js`、`core/index.js` `--check` 通过。
- 核心加载：`import('./core/index.js')` 正常，新增 report 导出可见。
- doc-consistency：**全部通过**（含 core 模块数、CHANGELOG Unreleased、README 计数 952）。
- 全量自包含套件（跳过环境相关 `smoke13.test.mjs`）：**0 失败**
  - cache-behavior 7 · check-report-schema 10 · composition-strict 8 · empty-plugins 24 · evidence-fusion 23 · exploratory-empty 27 · exploratory-feedback 563 · feedback-smoke 40 · finding-id-uniqueness 6 · heuristic-detect 16 · live-cal-unify 15 · main-path-fusion 8 · mode-decision 19 · review-fixes 15 · runtime-calibration 25 · semver-consistency 30 · tools-snapshot-smoke 13 · truth-source-degradation 17 · ui-plugin-test 22 · ui-test 77 · upgrade-opt 16。
- 组合契约：`node cli/dsh-forge.mjs check --json --dataset data/ecosystem.json` 退出码 0，gate.pass=true。

## 5. 遗留观察（非阻断）

- TUI 报告视图交互仅在 `process.stdin.isTTY` 下可用（非 TTY 首次渲染后退出），即 CI 为只读无害。
- 弹窗实时数据依赖 harness 客户端可访问 `localhost:3060`（与服务器同机时成立）；跨机场景依赖回退快照，已具备降级。
- CHANGELOG 已补 Unreleased 段落；README 计数未变（未新增测试套件），无需改数。

**审查结论：PASS。** 建议在浏览器/弹窗环境中做一次视觉验收（打开弹窗 → 刷新 / 生成报告 / 快照历史），并在服务器无浏览器场景下用 `G` 生成报告滚动浏览。