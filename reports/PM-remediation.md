# 评审整改说明（R0–R5 逐条落实）

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
