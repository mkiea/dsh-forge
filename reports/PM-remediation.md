# 评审整改说明（R0–R5 逐条落实）

> **快照标注**：本报告是**历史审计快照**，基于当时版本，不代表当前代码状态；现状以 README / ARCHITECTURE / CHANGELOG 与实时测试为准。

> 依据：《dsh-forge 项目经理评审（第三版）》——以验收标准为准绳。
> 结论：P0/P1/P2 全部落实；R0 从"源码重建"升级为"消费 harness 官方 dump-config 生效树"。

## R0 接地真相 —— 已落实（dump-config 真相源）

- 新增 `core/truth.js`：定位 dsh CLI（profile 目录探测，跨环境稳定）→ 执行
  `dsh --profile <p> --dump-config`（官方组合树渲染，含 `# == 来源, patched by …` 层溯源）→ 解析为行集。
- 实测：dump 131 行 = scan 131 行，行集完全一致（onlyScan/onlyDump 均空），且 dump 附带 provenance（15 行带 patchedBy）。
- 工具参数 `truthSource: auto|dump-config|scan`：**auto（默认）优先 dump-config**，失败回退 scan 并输出回退警告；
  强制 dump-config 失败则报错。analyze 输出 `truthSource` 字段标注数据来源。
- 保留 scan 的互补价值：dump 不求值 `!!js`，scan 求值平台切换；两者行集一致已实证。

## R1 校准诚实 —— 已落实

- 所有风险分/健康度输出 `calibrated: false` + 免责声明（"未校准启发式…不代表故障概率"），
  assess/analyze 均带 `disclaimer` 字段，render 展示。
- 冲突条目分级 `kind: contract|heuristic`：
  - **contract**（harness 契约确定行为）：tool-collision（注册拒绝）、service-collision（后注册者胜出）、row-override、disabled-row；
  - **heuristic**（未校准信号）：version-conflict、missing-provider、provider-indirection、unmounted-peer、skew、deprecated。
- 报告/仪表盘不再出现 "blocking(72)" 式伪精确；健康度明确标注非上线放行依据。

## R2 版本绑定 —— 已落实

- `harnessVersion`（0.1.0-rc.6）记录于 collectEcosystem / truth 生态 / 快照（含持久化）。
- 知识库模式声明 `PATTERNS_HARNESS_VERSION = "0.1.0-rc.6"`；当前版本 ≠ 验证版本时输出
  `knowledge-version-drift` 告警。
- analyze/check 输出 `harnessVersion` 字段；diff/history 可对比版本漂移。

## R3 健全性（无漏报）—— 已落实（新增泄漏扫描）

- 新增 `core/leaks.js`：非可逆副作用泄漏扫描（Cordis 论文点名的静默故障）——
  裸 `setInterval/setTimeout/process.on/document.addEventListener/window.addEventListener` 注册 vs 清理配对，
  注册 > 清理即 leak-suspect（low confidence 标注）。已纳入 `check_conflicts` 输出（`leaks` 字段）。
- 实测：官方包 0 泄漏（干净），扫描器有效。
- 运行期服务探测（`runtimeProbe`，verify_rows）继续提供 R3 的运行期证据。

## R4 精确性（无虚警）—— 已落实（分级与局限声明）

- 冲突条目增加 `evidenceTier: static-suspect|contract-source`：
  静态正则扫描一律标 `static-suspect`（疑似清单，非 harness 实际拒绝的确认）；
  patch 语义/禁用行为标 `contract-source`。
- 工具名扫描扩展：多模式（defineTool / registerTool / toolName config）+ 动态注册检测
  （`__dynamicRegistrationHint`，命中即提示扫描局限）。
- check_conflicts 输出 `disclaimer` 明确"疑似清单 vs harness 实际拒绝"的边界。
- 把 harness 启动期硬错（工具/服务重名=注册拒绝）归为 `contract` 类确定行为，不再当作概率风险打分。

## R5 可行动 —— 保持（既有强项）

- 证据链（evidence/impact/advice/confidence）、dashboard、simulate、suggest_patch、verify_rows 保留。

## P2 工程化 —— 已落实

- semver 部分版本号支持（`^1.2` / `~1.2` / `1.x` / `1.2.x` / `1.2` / 部分比较器，22/22 用例）；
- 两份 semver 实现一致性测试 30/30（**顺带修复** dashboard 内联 prerelease 比较缺陷：相等标识符缺 continue）；
- 挂载脚本 env 化（DSH_HOME / DSH_DEPLOY_NM），去除硬编码路径；
- CI 模板（.github/workflows/ci.yml）+ CHANGELOG.md。

## 测试状态

| 套件 | 结果 |
| --- | --- |
| ui-test.mjs（仪表盘） | 36/36 |
| ui-plugin-test.mjs（客户端） | 22/22 |
| semver-consistency.mjs（双实现） | 30/30 |
| 工具实跑（analyze/check，auto=truth） | dump-config 131 行 / contract 51 + heuristic 29 / leaks 0 |

## 遗留限制（诚实声明）

1. 静态扫描（TOOL_RE 等）仍无法覆盖变量名/模板串注册——已标 `static-suspect` + 动态 hint，不再宣称权威。
2. dump-config 不求值 `!!js`（官方设计）；平台切换行以 scan 求值为准（两者行集一致已实证）。
3. 泄漏扫描为启发式（注册/清理计数配对），low confidence。
4. 无事故数据集，所有风险分保持"未校准启发式"定位。


---

## 补充：审视报告（PM-review-v4）P0/P1 修复落实

### P0-1 作用域感知冲突判定（E3）
- 新增 `core/scope.js`：`scanScopeHints` 扫描每包源码的作用域标记（agent.ctx / agentCtx / scoped / per-agent / scopeOf），
  产出 `global | scoped | scoped-context-present` 提示；`classifyCollision` 按作用域分级：
  - 全部 scoped → `tool-name-scoped-variant`（heuristic/info：合法 per-agent 变体）
  - 含全局 → `tool-collision`（contract/high：注册拒绝硬错，静态疑似）
- check_conflicts 输出带 scope hints 证据；自包含测试覆盖三态分类。

### P0-2 事件流校准（E6）
- 新增 `core/calibration.js`：`createCalibration(ctx)` 订阅 `session/event`（tool/call、tool/result、turn/end），
  统计调用数/失败数/失败率/TOP 工具；`staticCalibration` 离线诚实返回无基线。
- src/index.js apply 时创建校准（无事件流自动降级）；check_conflicts 输出 `calibration` 字段。
- 独立于本机：数据只来自运行期 ctx 事件，无路径依赖；测试用 mock 事件验证。

### P1 泄漏扫描 apply 路径切片 + provide 语义中性化
- `scanLeaks` 按 apply 文件切片：注册/清理仅在 apply 路径内对账（`leak-suspect`），
  非 apply 文件注册降为 `leak-context`（info）；输出带文件位置证据。
- service-collision impact 文本改为"待实证"（cordis fiber 作用域注册，同 scope 重复 provide 语义源码未见分支）。
- **顺带修复真实缺陷**：模板字面量转义把 `\b` 写成退格字符（0x08），导致 BARE_REG 的
  setInterval/setTimeout/addEventListener 规则静默失效——已全局修复并加验证。
- 知识库新增 client-runner-timer-redirect 模式（客户端定时器重定向为可逆设计，泄漏误报排除）。

### 测试
- `test/review-fixes.test.mjs`：15/15（作用域三态、mock 校准统计、泄漏切片含位置证据、清理后无泄漏）——自包含、零本机依赖。
- 全量回归：ui-test 36/36 · ui-plugin-test 22/22 · semver-consistency 30/30。
- 真实组合：conflicts 82（contract 53 + heuristic 29）、leaks 12（4 medium 候选 + 8 info；已知误报模式已入知识库）。


---

## 三点确认（审视者复核）的修复记录

### 1. "排除误报"落地到输出层 ✅
- 修复 knowledge 循环 break bug（原只记录第一个匹配包，与泄漏候选不对应）。
- 在 `core/leaks.js` 输出层内置已知安全过滤（KNOWN_SAFE_TIMER_PACKAGES + KNOWN_SAFE_TIMER_RULES）：
  匹配包+规则 → kind 降级为 `leak-known-safe`（info，evidence 注明源码核实的可逆重定向设计）。
- 实测（scan 实时组合）：leak-suspect **4 → 2**；client-runner 的 setInterval/setTimeout 已降级为 leak-known-safe。
- 剩余 2 个 suspect（dsh-client-connection、dsh-client-ui-trajectory）为真实候选，保持 low confidence 待人工核对。

### 2. conflicts 82 vs 63 差异归因 ✅（非 bug，输入集不同）
- scan 实时（131 行，无 preset 层）：provider-indirection 29 + row-override 27 + disabled-row 26 = **82**。
- 快照（138 行，含 preset:standard 层）：29 + 27 + **7** = **63**。
- 差异 = disabled-row（26 vs 7，差 19）：preset:standard 重新启用了 19 个被 web-app 禁用的行——合理语义。
- 输出已带 `inputScope` 字段（rows/packages/layers/disabledRows/truthSource），任何环境可复现与归因；
  harness 挂载环境的最终数字以 inputScope 为准。

### 3. 小瑕疵清理 ✅
- review-fixes.test.mjs：清除 DBG3/DEBUG 残留与内联复现块；`.tmp-tests` 硬编码路径改为
  `import.meta` 推导的项目相对路径（ROOT/.tmp-tests），测试结束清理。
- smoke13.mjs：`require("node:fs")` 改为 ESM `import * as fs`；实测 13 工具全部 OK。
- 全量回归：36/36 + 22/22 + 30/30 + 15/15。

---

## 统一错误反馈体系（错误提示 / 终端 / 仪表盘）

### 设计
- `core/errors.js`：`normalizeFeedback` 把任何发现归一为
  {code, severity, message, detail, guidance, source, recoverable}；
  `buildFeedback` 从 conflicts/leaks/patterns/verified 聚合；
  `preflight` 做启动预检（组合解析、包缺失）；`renderFeedback` 终端/渲染文本。
- 错误码：FORGE-001 预检失败 · 002 组合解析失败 · 003 包缺失 · 005 版本范围不满足 ·
  006 工具重名 · 007 服务覆盖 · 008 泄漏嫌疑 · 010 版本漂移 · 011/012 其他 contract/heuristic · 013 运行时验证 · 014 校准声明。
- 分级：fatal（启动/加载失败）> error（功能受损）> warning（冲突但不崩溃）> info。

### 落地
1. **仪表盘**：新增"错误与反馈"面板（错误优先分组、错误码、详情、建议、来源），
   嵌入 dashboard.html 并随 client.js 内嵌进弹窗。
2. **终端（启动崩溃场景）**：src/index.js apply 时运行 preflight，
   致命问题以 [dsh-forge] FATAL <code> <消息>/<详情>/<建议> 输出到启动 harness 的终端 stderr——
   即使后续行挂载失败/进程崩溃，终端已有完整诊断；非致命输出 WARN。
3. **工具输出**：check_conflicts 输出 `feedback` 字段（render 优先展示），
   并按 severity 排序（fatal→error→warning→info）。
4. **入口调整**：保留网页侧边栏（sidebar.footer.action）的仪表盘入口；
   删除会话头入口（conversation.session.header.actions），仅保留对话流提示卡片（turnTail）。

### 测试
- ui-plugin-test 22/22（含 sidebar 入口正常渲染、header 入口已移除断言）。
- 全量回归：ui-test 36/36 · ui-plugin-test 22/22 · review-fixes 15/15 · semver 30/30 · smoke13 13/13。