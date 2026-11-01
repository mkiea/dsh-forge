# Changelog

## [Unreleased]

### 在线操作与连通器修复 · 实时通道与结构化结果

- **根因修复**（`web/dashboard-client.js`）：桌面壳层用 `srcDoc` 嵌入服务器 HTML，iframe 文档的 `location.protocol` 为 `about:`，所有相对 `/api/...` 请求都会解析到宿主应用源而静默失败——自动更新（SSE）、快照归档、模拟、升级与连通器扫描因此全部不可用。新增 `API_BASE` 探测：以 `http(s)` 提供页面时保持相对路径，非 http（srcDoc / `file:`）时固定到 `http://127.0.0.1:3060`（可用 `window.__DSH_API__` 覆盖），`fetch`、`EventSource` 与 `postJSON` 统一走 `api()`。
- **自动更新**：SSE 断开时明确提示并降级 15s 轮询；恢复可见时自动重连，失败原因写入状态行而不是静默。
- **版本通道**：由纯文本改为版本卡片（当前 → 最新、状态芯片、registry 来源），并解释非升级情形：`local-ahead`（本地领先）、registry 无 `latest` 标记（harness 仅发预发布版）、仓库不可达，避免出现无解释的 `→ ?`。
- **快照历史**：归档结果与失败原因写入独立输出块，成功后同步刷新历史表与趋势图。
- **组合模拟**：结果改为指标芯片（健康度流向、平均风险、风险增量、verdict）+ 新增/已解决冲突表 + 影响面（移除包、失去依赖、消失的 Service 提供者、中断的服务链、消失信号），并始终标注「假设推演 · 未执行」。
- **升级区**：`prompt/confirm` 改为内联表单（目标 / 版本 / 确认勾选）；「列出可升级包」输出 registry 摘要、每包阻断范围与安装命令；「预演依赖影响」输出安全/阻断结论、breaks 与建议范围；「执行升级」结构化输出命令、备份路径、退出码、耗时与 stdout/stderr 日志块。
- **连通器**：profile 表（行数/包数/harness/布局/真相源/缺 bundle）、桌面 `app.asar` 检测状态、每对 profile 的相似度进度条与 verdict、harness 漂移、口径不完整提示、版本漂移表、仅左/仅右包芯片列表；通道不可达时给出启动 `dsh-forge web` 的诊断提示。
- **样式**（`core/dashboard.js`）：新增 `.ops-metric`、`.ops-log`、`.chip.blocking`、`.vrow` 结构化版本行，沿用既有语义 token。

### 依赖图谱 · 按层收起/展开

- 每层独立成列，列顶新增**可点击层标题**（`▾ 层名 · N 个`）：点一下收起该层，节点与相关连线从画布消失、列宽收窄为 150px；再点展开复原。层内节点过多、卡片堆叠看不清时用它。
- 工具栏新增「折叠全部层 / 展开全部层」一键切换，按钮文案随实际折叠状态变化。
- 收起的层不参与连线绘制与 `fitView` 尺寸计算，画布宽度随之收缩，避免密集列把整张图挤成一团；选中节点所属层被收起时自动清除选中。
- 层标题有 hover 高亮与 `title` 提示，交互说明同步写入图谱页说明与工具栏 hint。

### 仪表盘 v2 · 控制室视觉与信息表达升级

- **视觉系统**（`core/skins.js`、`core/dashboard.js`）：在原有语义 token 之上补充 `shadowLg`/`surfaceSunken`/`borderStrong`/`accentWash`/`chartGrid`/`sheen`（明暗两套同步），并新增一层 v2 覆盖样式：画布径向光晕、发丝描边、三层表面（画布→面板→卡片）、8pt 间距节奏、150–220ms 过渡与 `prefers-reduced-motion` 兜底；导航激活项改为渐变左条，页面切换加入 `pageIn` 入场动画。
- **概览页信息重构**：健康度环形图 + 4 个关键统计的 hero 区；6 个带副标题的 KPI 磁贴；组件风险构成改为堆叠条 + 含百分比的图例；新增风险分五档直方图、高风险组件 Top 列表（带行内风险条）、运行时三态校准条、冲突类型柱图、按层分布条、面积式历史趋势图；元数据改为芯片条，开发者数据独立 `span2` 面板。旧通用 donut / 环形图 / 折线 helper 全部移除，避免图表语义重复。
- **全局视觉语言**：新增 `.chip`（含 `mono`/`accent` 变体）、`.meta-strip`、`.st` 状态点、`.sc-*` 行级风险色条、`.rn` 风险分与 `.riskbar` 迷你条；冲突/泄漏/共享/模式页统一改用统计芯片 + 空态卡片；组件表改为 sticky 表头、包名/版本两行、层与状态芯片、风险分 + 进度条；模拟页拆分为「添加 / 移除」两组带芯片标签的控件。
- **其余页面**：使用引导改为 hero + 三步卡片 + 级别色卡 + 术语表；混合验证体系改为 4 个 KPI 磁贴 + 不变量面板（ID 芯片化）；运维与连通器页改为面板头 + 副标题 + 状态芯片；图谱工具栏按「缩放 / 布局 / 提示」分组并加 `.gt-group` 分隔线。
- **外壳**：品牌标记换成内联 SVG 字母标，侧栏底部新增整体健康度卡片（窄屏自动隐藏）；13 个模块顺序、页面 id 与 `mod-guide` 数量保持不变。
- **测试**：`ui-test` 79、`graph-test` 41、`ui-plugin-test` 22 全绿，35 套件 1382 用例与文档一致性检查通过（本次无新增用例）。

### preset_compare 适配 0.2.x 预设布局与桌面 asar

- **双格式读取**（`core/presets.js`）：新增 0.2.x `<id>.patch.yml` 解析（从 `@deepseek-ai/dsh-agent-preset` 声明取 `config.id`/`config.order` 与 `config.plugins` 行集，嵌套 `cordis:group` 子行不越界），保留旧版 `<id>/agent.cordis.yml`；预设按自身 `order` 排序（standard → ptc → minimal → cordis）。
- **源发现**：`discoverPresetSources()` 依次探测磁盘 `@deepseek-ai/dsh-web-app/presets`、`@deepseek-ai/dsh-agent-presets`、旧版 `@deepseek-ai/dsh/config/agent-presets`，最后回落到桌面 `resources/app.asar` 内的同一目录（`core/asar.js` 新增 `listAsarDir`）；`preset_compare` 输出新增 `source` 字段说明实际数据源。
- **修复**：此前只查 `dsh/config/agent-presets`，在 0.2.x 环境里必然报 `agent-presets directory not found`。
- **测试**：新增 `test/presets.test.mjs` 23 项（双格式 / 嵌套 group / 磁盘优先于 asar 的源发现 / 工具面），自包含套件 34 → 35、用例 1359 → 1382。

### 环境修复（本机 profile）

- 重装全局 `@deepseek-ai/dsh@0.2.1-rc.3` 恢复 `~/.dsh/profiles/node_modules/@deepseek-ai` 下的 junction 目标；清理 17 个指向 0.1.x 旧包名/npx 缓存的悬空链接（0.2.1 已把 `dsh-agent-presets`→`dsh-agent-preset(-registry)`、`dsh-code-runtime*`→`dsh-ptc-runtime*`、`dsh-host-apiproxy`→`dsh-http-proxy` 等）。
- `check --profile web --dynamic`：219 个包入口运行期导入 **0 失败**，`dsh-damage-pulse` / `dsh-mnemon` 恢复可加载。

### 仪表盘重构为深色专业工作台

- **主题与设计系统**（`core/skins.js`、`core/dashboard.js`）：默认皮肤切为 `dark`（保留完整 `light` 皮肤与页头主题切换）；`skinCssVars()` 之外新增 `surfaceAlt`/`surfaceRaised`/`headerBg`/`navBg`/`canvasBg`/`canvasDot`/`canvasLine`/`accentStrong`/`accentSoft`/`ring`/`tableHead`/`rowStripe`/`shadow` 等语义 token，全部页面样式改为 token 驱动。
- **页头与导航**：品牌区（`brand-mark` + eyebrow + 标题 + 元信息行）、分组侧栏（开始/诊断/证据/实验/运维，13 个模块各带内联图标与计数徽标，冲突用 danger、泄漏/反馈用 warn，零计数不显示）、实时徽标改为圆点脉冲样式；模块顺序与 13 个页面 id 保持不变。
- **内容区**：KPI 卡片、panel、表格（吸顶表头 + 斑马纹 + 严重度行底色）、筛选工具栏、note/反馈分组、模拟与运维控件统一为圆角卡片与语义色；`<960px` 侧栏折叠为图标栏。
- **修复**：`GRAPH_STYLE` 之前未随 `STYLE` 一起输出，图谱页样式在重建后失效；改为独立 `<style>` 注入，并补齐 `.sim`、`.gp-restore`、反馈 note 变体（`.fb-fatal`/`.fb-error`/`.fb-warning`/`.fb-info`）等缺失规则。
- **测试**：`ui-test` 79、`graph-test` 41、`ui-plugin-test` 22 全绿（本轮新增 preset 套件后总用例 1382）。

### 依赖图谱改造为 ComfyUI 风格节点编辑器

- **图页面结构**（`core/dashboard.js`）：`graphPage()` 从「缩放按钮 + 画布 + 详情栏」扩展为「工具栏 + 左侧节点调色板 + 深色网格画布 + 右侧检查器」；`GRAPH_STYLE` 重写为深色 `#12151a` 网格（三层渐变）与 `#1b1f24` 调色板，工具按钮提供放大/缩小/适应视图/自动布局/隐藏外部库/清除选择；`MODULE_HELP["page-graph"]` 同步为节点编辑器说明。
- **节点交互**（`web/dashboard-client.js`）：节点可自由拖动，位置写入 `localStorage['dsh-graph-pos']`（`typeof localStorage` 守卫，无 storage 时降级为内存）；`layoutGraph` 在层网格上叠加用户覆盖坐标，并按所有节点包围盒扩展画布。调色板列出「已安装未组合」候选包，支持拖入画布与点击添加（统一进 `state.added`）；拖到左侧回收区或按 Delete 从画布移除（进 `state.removed`），调色板可一键恢复；`hiddenRow` 同时过滤节点与依赖边，`gExt` 可隐藏/显示外部库节点。连线保持不可手工创建，所有添加/移除都是推演，不改真实组合。
- **卡片与检查器**：`nodeMarkup` 改为 ComfyUI 卡片——19px 风险色标题条、`×N` 行数、包短名与左右端口圆点；`edgeMarkup` 采用深色画布配色（红色虚线＝不满足、蓝色＝选中、绿色＝入向），可视 path 与 11px 透明命中 path 都带 `data-edge`；`renderDetail` 对选中节点提供「从画布移除（推演）」，总览文案补充操作说明与隐藏行提示。
- **测试**（`test/graph-test.mjs` 23 → 41 项，用例合计 1359）：新增调色板渲染、节点拖动与位置持久化、拖动后不误选、调色板点击添加进入 `state.added`、Delete 移除进入 `state.removed`、调色板恢复、自动布局回到层级网格、外部库隐藏/显示、点连线看证据、清除选择。
- **文档同步**：README / README.en / ARCHITECTURE 更新为套件 34、用例 1359，并补充节点编辑器与「图谱＝交互投影」的语义说明。

### 因果投影与反事实影响（只读投影层）

- **新增 `core/causal.js`**：不新增扫描器，只复用 `runAnalysis` 已有的 graph / conflicts，投影出 plugin / service / outcome 节点与 depends_on / provides_service / requires_service / influences 边。每条边带证据层级（contract-source / static-suspect / heuristic / runtime-probe）、来源文本、置信度、`observed` 与 why/caveat；`explainEdge` 返回单条边的解释。`depends_on` 明确标注「清单声明依赖 ≠ 运行期调用」，外部库不作为因果节点，`influences` 只表示参与某条发现而不宣称归因；`*` / 空范围视为任意版本（与风险分、仪表盘口径一致，避免把 prerelease 的 wildcard 误读成 unsat）。
- **反事实影响**（`core/simulate.js`）：`simulateCombination` 顶层新增 `mode: "hypothetical"` 与 `impact`——移除包、失去依赖的插件（`dependents` + `via`）、消失的 Service 提供者、中断的服务调用链（`brokenServices` + 剩余消费方）、随之消失的风险信号（`disappearedSignals`），并附 `evidenceNote` 明示「静态推演、未执行」。`simulate_combination` 工具 schema 与文本渲染同步输出，避免把推演伪装成执行验证。
- **仪表盘交互**（`core/dashboard.js` / `web/dashboard-client.js`）：`window.__DSH__` 内嵌 `causal` 投影；图谱页支持点击任意连杆查看该关系的证据层级/置信度/来源/why/caveat（外部库边回退为清单声明说明），选中边时高亮并淡化其余元素；总览面板展示因果投影计数；假设模拟面板渲染结构性影响与 hypothetical 标签。
- **测试**（新增 `test/causal-projection.test.mjs` 37 项）：锁定依赖边证据、why/caveat、Service 边、finding→outcome、`explainEdge` 一致性、`*` 视为满足，以及移除推演的 dependents / brokenServices / disappearedSignals / 无操作与叶子插件不误报。
- **文档同步**：README / README.en / ARCHITECTURE 更新为套件 34、用例 1341、core 模块 36。

### 扫描准确性：依赖解析与风险分误报修复

- **按消费者解析依赖**（`core/composition.js` `resolveInstalled`）：改为 Node 解析语义——先查消费者自身 `node_modules`（含嵌套副本），asar 内消费者在归档内逐级向上查找，最后才回退到归档全局清单与生态级 `installed`。此前 `@deepseek-ai/*` 一律先读桌面 asar，web 插件 vendored 的旧副本（如 `atomic-write`、`ipaddr.js`、`fflate`、`undici`、`negotiator`）被顶层版本覆盖，仪表盘据此误报 unsat。
- **仪表盘数据前沿**（`core/dashboard.js` / `web/dashboard-client.js`）：`buildEmbedData` 的依赖版本改用 `resolveInstalled`，不再读顶层 `installed[dep]`；`*` / 空范围直接视为满足（harness 包均为 prerelease，npm 的 prerelease 排除规则会把每个 `*` 依赖判为 unsat）；`installed` 字段随依赖下发，客户端只在 `!installed` 时才计 `unmounted-peer-service`，alternate variant 的 +10 仍保留。
- **风险分对齐**（`core/analyze.js`）：`satisfied === false` 增加 wildcard 豁免；未组合 peer 先判 variant 再看是否已安装，已安装的运行期依赖不再当作「从未组合的服务」。组合不完整（`missingBundles` 非空，bundle 补丁无法解析）时不再对 peer 计分——此时看不到真实运行时，「从未组合」不可证；仪表盘同步嵌入 `partial` 并在客户端跳过 peer 信号。
- **组合块解析修复**（`core/composition.js`）：`config:` 块现在按真实 YAML 语义结束——零缩进注释不再截断块，块内嵌的 `- id:` 列表（本地模型定义、preset/group 的插件声明）保留在 `configText` 内，不再被误当成组合行。效果：web profile 的 `cordis.patch.yml` 可正常静态扫描（`contextWindow` / `dataDir` 不再报 `unsupported row key`），web 得到 17 行 / 9 个包；desktop 静态扫描为 198 行（此前 215 行里混入了 17 条 preset 内部声明），`tool-pwsh` / `persistent-pwsh` 的 20 分幻影重名随即消失。`bridge --static` 与 `sync` 现在能真正比较 web ↔ desktop。
- **真实生态复核**：`dsh-hmr`、`dsh-api-session-controller`、`dsh-host-webserver`、`dshmarket`、`dsh-mnemon`、`@zaofan/dsh-qqbot` 由 25–100 分降至 0；`dsh-damage-pulse` 仅剩 `dsh-client-ui-slots` 真实版本缺口（35/medium）；`dsh-qq-onebot-bridge` 保留 100/blocking（其范围上限为 0.2.0，不含已装的 0.2.1-rc.3）。
- **测试**（`test/scope-collision.test.mjs` 19 → 24 项，用例合计 1341）：新增「已装 wildcard peer 不判 unsat」「已装运行期 peer 不算未挂载服务」「真实缺失 peer 仍计 25」「不完整扫描不对 peer 计分」「风险图解析 vendored 副本而非顶层版本」。
- **文档同步**：README / README.en 更新为套件 34、用例 1341。

### 桌面版适配（Electron `app.asar`）

- **新增 `core/asar.js`**：零依赖读取 Electron asar 归档（pickle 头解析、条目随机读取、`.unpacked` 回退、UTF-8 BOM 容错），提供 `findDesktopAsar` / `listAsarPackages` / `readAsarManifest` / `readAsarSources`。
- **组合源发现**（`core/composition.js`）：`desktop` profile 的 bundle 补丁从 asar 读取（`dsh.bundle.patch`，含默认 `cordis.patch.yml`）；清单解析以归档为准，不再被其他安装目录（如 CLI 的 `~/.dsh/node_modules`）里的同名包遮蔽；依赖版本与 harness 版本同样优先取自归档（本机实测 desktop harness 为 `0.2.1-rc.3`，共 185 行 / 179 包）。
- **冲突扫描**（`core/conflicts.js`）：工具名/服务扫描改为统一的 `readPackageSources`，普通安装读磁盘、桌面版读 asar 条目，正则与作用域规则完全复用。
- **真相源降级**（`core/truth.js` / `src/tools/common.js`）：`desktop` profile 直接跳过会被桌面应用拒绝的 `--dump-config`，返回 `desktop: true` 并走 asar 增强的静态扫描；`truthSource` 仍为 `scan`（置信度上限不放宽），另以 `layout: "desktop-asar"` 标注来源，CLI 与 Markdown 报告同步展示。
- **动态扫描**（`core/dynamic.js`）：无法导入的归档内包列入 `notExecuted`，不再默默当作已探测；`simulate_combination` 可从归档解析仅存在于 asar 的包。
- **依赖范围**：`@deepseek-ai/dsh-tools` 放宽为 `^0.1.7-rc.2 || ^0.2.1-rc.3`，桌面版 harness 0.2.x 不再误报范围不满足。

### 动态组合：同名行按作用域全量处理

- **根因**：真实 dump 的 row id 只在作用域内唯一（`tool-bash` 等最多出现 4 次，分属不同 agent preset）；`applyOps` 的 remove/override 只命中第一条，导致 `remove: ['tool-bash']` 只删 1/4 行，模拟结果与真实组合不一致。
- **修复**（`core/simulate.js`）：`remove` 删除全部同名行并回报 `removedRows` / `removedScopes`；`override` 应用到全部同名行并回报 `matched`；`add` 遇到同名同包视为已组合，遇到同名统一包替换全部作用域行，遇到同名异包则明确记录歧义并追加新行。`simulate_combination` 输出与 CLI 摘要同步展示 id/行计数。

### Web 端自动更新 + 在线操作

- **新增 `core/auto-update.js`**（零依赖）：`buildWatchSet` 汇总 profile 四个组合文件、非 asar 的 layer 路径与快照文件；`watchSignature` 以 mtime+size 生成 FNV-1a 签名，`diffSignature` 给出 changed/added/removed；`assessVersion` 用 `parseVersion` + `compareVersions` 判定 outdated/current/local-ahead；`updateCommands` 分别给出 harness（npx/global/desktop）与 forge（plugin/npm/ui）命令；`runUpdate` 校验 target 白名单与版本正则，默认 `apply:false` 只返回计划，执行前备份 `package.json`。
- **SSE 推送**（`core/web-server.js`）：新增 `GET /api/events`（hello/ping/update/error），按 `DSH_FORGE_WATCH_INTERVAL`（默认 4s）比对签名，变更后重分析并按 `autoArchive` 归档；`GET /api/state` 提供轻量轮询快照（`?versions=1` 附带版本检查）。
- **在线操作端点**：`GET /api/conflicts`、`GET /api/history`、`POST /api/snapshot`、`POST /api/simulate`（`override` 兼容数组与 id→package 映射）、`GET /api/upgrade`、`POST /api/plan`、`POST /api/update`（loopback + `confirm="update-<target>"`）；`POST /api/report` 同步收紧为 loopback。
- **快照历史修正**（`core/history.js`）：新增 `historySeries` 合并仓库基线 `data/ecosystem.json` 与运行期 `data/history/*.json`，去重排序且基线不会被窗口挤出，同时间戳时归档优先；仪表盘与 `/api/history` 统一使用该序列，展示真实快照更新。
- **仪表盘「在线操作」页**（`core/dashboard.js`）：自动更新开关与状态、快照历史表与手工归档、组合模拟输入/差异摘要、升级预演与执行入口。
- **客户端**（`web/dashboard-client.js` / `ui-plugin/lib/client.template.js`）：SSE 优先、失败降级 15s 轮询，`visibilitychange` 暂停/恢复；刷新保留筛选与模拟状态；插件模态工具栏新增「自动更新」切换，签名变化时自动重载 iframe 并提示可用版本。

### Web × 桌面连通器 + 鲁棒性加固

- **新增 `core/bridge.js`**（零依赖）：`discoverProfiles` 扫描 `<home>/profiles/*` 并在存在桌面归档时补上 `desktop`；`profileSummary` 归一化行数/包数/harness/布局/来源；`compareProfiles` 输出共享包版本漂移、仅左/仅右包、harness 漂移、相似度与 `identical`/`drift`/`divergent` 裁决；`buildBridge` 组合全部结果。单端采集失败只记录 `error`，不影响另一端。
- **接入两端**：`GET /api/bridge`（60s 缓存，`?refresh=1` 强制）、CLI `dsh-forge bridge [--profiles web,desktop] [--root <dir>] [--static] [--json]`、仪表盘新增「Web × 桌面」页（profile 卡 + 漂移表 + 仅 Web / 仅桌面清单）。CLI/插件启动的 Web 面板与桌面端 ui-plugin 共用同一 `/api` 通道与引擎。
- **口径对齐**：Web 面板的 bridge 直接复用当前分析结果（dump-config 真相源）作为 web 端，CLI 的 `bridge` 对非 desktop profile 先尝试 `loadTruthEcosystem`（`--static` 可关闭）、`--root <dir>` 可指定 bundle 解析根；避免用 8 行静态扫描对比 294 行真相源而得出错误的 divergent 结论；`profileSummary`/`compareProfiles` 新增 `missingBundles`/`complete`/`missing`，部署不可达时明确标注「口径不完整」而不是假装两端差异巨大。
- **桌面 patch 兼容**（`core/composition.js`）：严格解析接受 harness 0.2.x 预设的结构性行键 `group: true` 与 `isolate:`（跳过其缩进映射块，不当作组合键），修复 `unsupported row key: group` 导致的桌面端采集失败。
- **请求层加固**（`core/web-server.js`）：请求体硬上限 256KB（413）、非对象/非法 JSON 400、未知 `/api/*` 返回 JSON 404（不再回退 HTML）、错误方法 405、`OPTIONS` 204、JSON 响应加 `x-content-type-options: nosniff`、畸形 URL 400。
- **并发与资源**：刷新单飞（SSE 循环 / `/api/refresh` / report / snapshot 共享一次扫描）；SSE 客户端上限（默认 8，超出 503）且断线回收槽位；`/api/simulate` 对 `add`/`remove`/`override` 做 200 条与 200 字符裁剪，丢弃畸形条目。

### 测试与文档

- **新增 `test/desktop-asar.test.mjs`**（套件 29 → 30，18 项）：合成 asar 归档的头解析/清单/BOM/源码读取、桌面生态采集与版本优先级、asar 源码冲突扫描、仅归档包模拟、动态探测 `notExecuted`、desktop profile 跳过 dump。
- **新增 `test/web-auto-update.test.mjs`**（28 项，套件 30 → 31）：覆盖签名/差异、版本评估与命令、受控执行守卫、快照序列合并去重、`/api/state`·`/api/conflicts`·`/api/history`·`/api/simulate`·`/api/snapshot`·`/api/update` 与 SSE hello。
- **新增 `test/web-robustness.test.mjs`**（41 项，套件 31 → 32）：非法/空/数组/超限请求体、未知端点与方法、OPTIONS·nosniff、刷新单飞、SSE 上限与断线回收、模拟载荷裁剪、`discoverProfiles`/`compareProfiles`/`buildBridge` 单元、未解析 bundle 的 partial 口径与 `/api/bridge` 端点。
- **`test/composition-strict.test.mjs`** 增加 2 项：`group: true` / `isolate:` 结构性行键可解析且嵌套 config 行仍独立成行，非布尔 `group` 值 fail-loud（8 → 10 项）。
- **`test/simulate-roots.test.mjs`** 增加 9 项同名行语义回归（全量删除、幂等、全量覆盖、统一/混合 id 添加）。
- **文档同步**：README / README.en / ARCHITECTURE 更新为模块 34、套件 32、用例 1249，并补充桌面版、Web 自动更新与 Web × 桌面连通器说明。

### 跨端插件/版本对齐（`sync`）

- **新增 `core/sync.js`**（零依赖，模块 34 → 35）：`planSync` 以 bridge 载荷为唯一输入，输出 web ← desktop 的安装计划；`applySync` 在有确认令牌时执行安装，并在结束后强制验证；`preflightSync` 先查 registry（404 = 不可安装，网络失败 = unknown 不阻塞）；`verifySync` 重新采集组合、读取 `node_modules` 清单并动态 `import()` 被触达的包。
- **安装闭环**：备份 `package.json` / `cordis.yml` / `cordis.patch.yml` / 锁文件 → 按 40 个/批执行 `dsh plugin add` → 校验精确版本（组合口径 + 直接读 manifest，区分 `notComposed`）→ 动态探针（`missing-export` / `module-not-found` 致命；`timeout` / `other` 仅告警）→ 任一失败恢复备份并给出 `plugin --profile <web> install` 恢复命令。
- **安全边界**：桌面端为 Electron 只读 `app.asar`，面向桌面的写入全部标 `blocked`；桌面 `@deepseek-ai/*` 属应用运行时，默认只记入 `desktopRuntime`，需 `includeRuntime` / `--include-runtime` 显式开启；`link:` / `git+` / 版本区间依赖不替换为 registry 版本；web profile 扫描失败时不生成猜测性安装动作。
- **扫描口径**：`composition.js` 支持 `disabled: !!js >-` / `|-` 块标量并记录 `disabledExpr`，loader 上下文表达式不再让整次扫描失败；`collectEcosystem` 新增 `declared`（profile `package.json` dependencies），bridge 透传该字段，组合口径不完整时降级为 `status: "partial"` + 明确警告，仅对齐已知插件版本。
- **接入**：CLI 新增 `sync [--apply --confirm sync-<profile>] [--reference desktop|web] [--packages a,b] [--include-runtime] [--no-preflight] [--no-probe] [--json]`；Web 新增 `GET/POST /api/sync`（POST 需 loopback + `allowUpdate`），安装成功后清空 bridge 缓存。
- **新增 `test/sync.test.mjs`**（61 项，套件 32 → 33，用例 1249 → 1257）：静态扫描与夹具逐项一致、动态探针捕获链接期失败、版本漂移对齐、桌面第三方插件补装、运行时不镜像、declared 精确版本对齐与 `link:`/`git+`/区间跳过、安装成功/错版本/坏导入/命令失败的回滚、预检 404 与离线降级、确认令牌、`--include-runtime` 与零依赖源码检查。
- **文档同步**：README / README.en / ARCHITECTURE 更新为模块 35、套件 33、用例 1257，并补充 `sync` 命令、`/api/sync` 与安全边界说明。

## [0.1.16] - 2026-10-27

### 静态扫描适配 harness 0.1.7 内嵌布局（清单 7 → 188）

- **根因**：0.1.7 把插件包内嵌在 dsh 包内（`<nm>/@deepseek-ai/dsh/node_modules/@deepseek-ai/*`）；旧扫描只探测 `<nm>/<pkg>` 与 profile 的 `node_modules`，294 行 dump 仅解析出 7 个 manifest，其余行被判为「无清单」。
- **修复**（`core/composition.js` / `core/index.js` / `core/truth.js`）：`collectManifests` 在探测到内嵌根（以 `@deepseek-ai/dsh-base` 存在为准）时将其加入解析根并返回 `roots`；`resolveNmRoot` 增加 profile/home/cwd/dsh bin 四组内嵌候选；`loadTruthEcosystem` 与 `collectEcosystem` 的 installed 版本解析改为遍历全部根。
- **效果**：真实生态 294 行（284 插件）/ 188 包 / 2258 条依赖边可被完整检视（此前 128 包为旧基线）。

### 动态扫描：运行期导入探测（核心模块 30 → 31）

- **新增 `core/dynamic.js`**：`buildProbeList` 按 `exports["."]`/`main` 解析每个包入口；`probeEcosystem` 用单个 node 子进程（`--input-type=module -e`，清单经临时文件传入）真实 `import()` 全部入口，NDJSON 回传、批超时硬终止，未完成项显式记为 `timeout`；`classifyProbeError` 归类 `missing-export` / `module-not-found` / `timeout` / `other`；`dynamicFindings` 产出 `severity: high`、`evidenceTier: runtime-probe`、`confidence: high` 的证据，`mergeDynamicFindings` 以**不可变**方式并入分析（缓存仍保持纯静态）。
- **CLI**：新增 `check --dynamic` 与 `--dynamic-timeout <ms>`（默认 30000）。动态 findings 在 gate 前合并，链接期失败可直接拦截 CI；失败明细打印到 stderr。
- **工具**：`verify_rows` 新增可选 `dynamic: boolean`，返回 `runtimeProbe.dynamic` 并把失败导入追加为 `dynamicImport` issue。
- **覆盖的盲区**：如 `dsh-tools@0.1.1-rc.2` 从新版 `dsh-llm` 导入已删除的 `CallId`，静态扫描无法发现，动态探测可精确捕获 `does not provide an export named 'CallId'`。

### 0.1.7 扫描重点（知识库）

- `KNOWN_LIBS` 补充 0.1.7 纯库 `@deepseek-ai/dsh-util-values`。
- 新增 `vendored-plugin-root` 提示：内嵌布局下自定义 `--root` 需指向 `<nm>/@deepseek-ai/dsh/node_modules`。
- 新增 `dsh-llm-callid-removed`：0.1.7 的 `dsh-llm` 已移除 `CallId` 等导出，仍在导入的插件装载即失败。
- 新增 `dsh-tools-pre-0.1.7` 高优告警：harness ≥ 0.1.7 且已装 `dsh-tools < 0.1.7` 时提示升级到 `^0.1.7-rc.2`。

### 组合模拟适配内嵌布局（`simulate_combination`）

- **根因**：`applyOps` 只按 `eco.nmRoot` 解析待添加包，0.1.7 内嵌布局下已安装的 `@deepseek-ai/dsh-bash-local` 被误判为「not installed anywhere」，生成 `0.0.0-hypothetical` 合成清单并把风险增量算成 `+0.2`。
- **修复**（`core/simulate.js` / `core/composition.js` / `core/truth.js`）：生态对象暴露 `roots`；`applyOps` 遍历全部根解析包目录与依赖版本，命中真实 manifest 时保留 `synthetic: false` 与真实 `dir`；兼容无 `layers` 的历史行。
- **修复**（`core/conflicts.js`）：`row-override` 检查容忍缺失 `layers` 的行，避免组合模拟基线评估抛错。
- **效果**：同一包的模拟结果为 `0.1.7-rc.2`、`synthetic: false`、无 `unknownDeps`，风险增量由错误的 `+0.2` 修正为 `-0.1`。

### 冲突误报修复（作用域感知 / 启用行 / `disabled: !!js` / 死代码 / 通配范围）

- **作用域感知**（`core/truth.js` / `core/conflicts.js`）：dump-config 的 agent preset 与 cordis group 会形成嵌套的隔离子上下文；此前所有行被拍平成同一全局作用域，导致 `preset-standard` 与 `preset-minimal` 各自挂载同名 `bash`/`pwsh` 被判为 `FORGE-006 tool-collision`。现在解析 `- id:` 缩进生成 `scope` 路径，**仅在同作用域内**比较工具/服务重名。
- **启用行过滤**：工具/服务扫描只考虑已挂载且 `disabled !== true` 的包；未挂载的已安装包不再参与碰撞。
- **按平台求值 `disabled: !!js`**：dump-config 输出的是未求值表达式，Windows 上 `!!js process.platform === 'win32'` 曾被当作启用，制造幻影碰撞；现在用与扫描路径相同的 vm 沙箱求值。
- **死代码服务过滤**（`core/conflicts.js`）：打包器会把依赖代码内联进插件入口（如 `dsh-repeat-tool-reminder` 内未使用的 `LlmRuntime` IIFE），静态正则曾误报其提供 `llm` 服务；现在 `super(ctx, "svc")` 仅在类被声明后仍可达（另有引用/导出）时计为提供者。
- **通配范围**：依赖声明 `*` 表示任意版本；npm 语义下 prerelease 不满足 `*`，但 harness 全为 rc 版本，`dsh-qqbot` 的 `*` 因此产生 2 条 `FORGE-005` 噪声。版本冲突检测现在跳过 `*`/`x`/空范围，其余真实偏斜（如 `dsh-web-app` 要求 `dsh-client-ui-settings 0.1.7-rc.2`、实装 `0.1.7-rc.1`）仍保留。
- **依赖按消费者解析**（`core/composition.js`）：`resolveInstalled` 原来只查消费者自身 `node_modules`，随后回退到「首个解析根」的版本；内嵌的 `dsh-web-app` 因此读到 profile 里 hoist 的 `dsh-client-ui-settings@0.1.7-rc.1`，而它实际从内嵌根加载 `0.1.7-rc.2`，产生 2 条误报的 high 版本冲突。现在按 Node 解析顺序从消费目录逐级向上查找 `node_modules`，误报消除；真实偏斜（如 `dshmarket` 的 `dsh-settings` 范围、`dsh-damage-pulse` 的 `dsh-client-ui-slots` rc.1）仍会上报。
- **效果**：真实部署 `check` 由 166 冲突 / 3 high 变为 144 冲突 / 1 high（剩余为第三方插件的真实范围不满足）；`bash`、`pwsh` 工具重名与 `llm` 服务重名误报全部消失。

### 测试与文档

- **新增 `test/dynamic-probe.test.mjs`**（自包含套件 26 → 27，31 项）：错误分类、NDJSON 解析、入口解析、临时包端到端探测（正常/缺失导出/缺依赖）、findings 形状与不可变合并。
- **新增 `test/simulate-roots.test.mjs`**（套件 27 → 28，14 项）：内嵌根与主根解析、依赖版本解析、缺失包/显式愿望的合成清单、remove/override/重复 id、无 layers 行、源生态不可变与确定性。
- **新增 `test/scope-collision.test.mjs`**（套件 28 → 29，19 项）：dump 嵌套 scope、同域重名仍报错、兄弟 preset 合法、禁用/未挂载排除、`*` 范围、死代码服务过滤、依赖按消费者解析、服务同域规则。
- **文档同步**：README / README.en / ARCHITECTURE `0.1.16`、模块数 31、套件 29、用例 1137、真实生态规模（294 行 / 188 包 / 2258+ 边）。

## [0.1.15] - 2026-10-27

### 修复 dsh 0.1.7 兼容性（插件 `failed to import`，`dsh web` 无法加载 forge）

- **根因**：插件自带的 `@deepseek-ai/dsh-tools@0.1.1-rc.2` 在 `lib/index.js` 从 `@deepseek-ai/dsh-llm` 导入 `CallId`；harness 0.1.7 的 `dsh-llm` 已移除该导出，ESM 链接阶段直接抛 `SyntaxError: The requested module '@deepseek-ai/dsh-llm' does not provide an export named 'CallId'`，表现为 `forge (dsh-forge): failed to import`，14 个工具全部不可用。
- **依赖升级**（`package.json`）：`@deepseek-ai/dsh-tools` `^0.1.1-rc.2` → `^0.1.7-rc.2`。新版 `dsh-tools` 只从 `dsh-llm` 导入 `HarnessError` / `createUserMessage`，其余能力改走 `dsh-util-values` / `dsh-brand` / `dsh-sandbox`。
- **供应链排除项同步**（`pnpm-workspace.yaml`）：`minimumReleaseAgeExclude` 全部基线升到 `0.1.7-rc.2`（cordis `4.0.5`、schemastery `3.18.5`），并新增 `@deepseek-ai/dsh-util-values@0.1.7-rc.2`；`pnpm-lock.yaml` 同步（Packages +20 −13）。
- **知识图谱版本门控更新**（`core/knowledge.js`）：`PATTERNS_HARNESS_VERSION` `0.1.1-rc.2` → `0.1.7-rc.2`，消除 `knowledge-version-drift` 对新部署的误告警。
- **文档同步**：README / README.en 顶行 `harnessVersion`、ARCHITECTURE「harnessVersion 绑定」同步为 `0.1.7-rc.2`；`plan` 示例版本号更新为 `0.1.7-rc.2`。
- **验证**：`import('@deepseek-ai/dsh-tools')` 正常导出；`dsh web --port 0 --no-open` 输出 `[dsh-forge] ✓ forge 启动成功 · 14 个工具已注册`；`doc:check` 全过，26 个自包含套件 0 失败。

## [0.1.14] - 2026-09-03

### 真相源统一走 dump-config 优先的异步路径（truthSource 稳定化）

- **新增 `runAnalysisAsync()`**（`core/index.js`）：异步分析入口，优先经 `loadTruthEcosystem` 取 `dsh --dump-config` 真实快照（dump-config），不可用时才回退 `collectEcosystem` 源码扫描——与工具路径偏好一致，`check`/`plan`/`web` 不再在可取得 dump 时静默降级到 `scan`。
- **CLI 接入**（`cli/dsh-forge.mjs`）：新增 `loadAnalysisAsync()` 装载器，`main()` 与 web `refresh` 由同步 `runAnalysis` 切换到异步入口，同样保持 dump-config 优先。
- **插件壳接入**（`src/index.js`）：auto-web 的 `refresh` 改用 `runAnalysisAsync`，与 CLI 路径行为对齐。
- **Web 服务端 async 化**（`core/web-server.js`）：`createWebHandler` 改 async handler，`readAnalysis()` 统一 `await` 可能返回 Promise 的分析对象；路由错误处理收敛到单一 try/catch。
- **导出补齐**：`core/index.js` 转发 `loadTruthEcosystem` / `resolveDshHome`，供 CLI/插件壳复用同一真相源解析。

## [0.1.13] - 2026-09-03
### CLI `plan` 命令（方向 1 S3）

- **`dsh-forge plan --to <pkg@ver,...>`**（`cli/dsh-forge.mjs`）：离线升级路径预演，复用 `simulateUpgrade`/`proposeUpgradeCandidates`，平铺输出 before/after 健康、`riskDelta`、新增/解决冲突、`verdict`/`doSteps`；`--json` 机器可读；缺 `--to` 时报错并 exit 2。纯咨询，永不 gate-exit（与 `check` 区分）。

- HELP 增加 `plan` 用法与 `--to` 选项。


### 组合升级推演 `core/plan.js`（方向 1 S1）

- **新增 `core/plan.js`**（核心模块 28→29）：`proposeUpgradeCandidates()` 纯函数给定目标版本 wish，离线算出每个升级候选的确定性结果——哪些 consumer 的声明范围拒收新版本（`breaks`）、是否安全、建议范围；`proposeUpgrade()` 包装层可注入 `fetch`，从仓库解析「最新」目标后委托纯函数，同样确定性可测。只读、不写盘、不碰 harness 状态、不参与 gate 拦截语义（咨询而非闸门）。
- **`core/index.js` 转发** `proposeUpgrade` / `proposeUpgradeCandidates`。
- **S2 `simulateUpgrade` 编排器**（`core/plan.js`）：把版本上移表达为纯克隆覆盖（`cloneWithVersion`，`applyOps` 的 override 表达不了版本），复用 `buildGraph`/`checkConflicts`/`assess` 对基线 vs 目标各算一版，产出 before/after 健康、`riskDelta`、新增/解决的冲突、`installCmd`/`doSteps` 一句结论与可执行下一步。只读、确定性、不参与 gate。`core/index.js` 转发 `simulateUpgrade` / `cloneWithVersion`。
- **新增 `test/plan-upgrade.test.mjs`**（自包含套件 23→24；S1+S2 共用该文件，39 项）：兼容/破坏性/未移动/未知包/混合 wish/仓库解析/目标覆盖/纯克隆/破坏性与安全升级编排/未装包兜底共 11 组。
- **文档同步**：README / README.en / ARCHITECTURE 模块数 28→29、自包含套件 23→24。

### harness 工具 plan_upgrade（方向 1 S4）

- **`plan_upgrade` 工具**（`src/tools/plan.js`，第 14 个）：harness 侧暴露升级路径预演。显式 `targets`（`pkg@ver`）完全离线，直接经 `simulateUpgrade`；含 `@latest` 目标时才经注入 fetch 的 `proposeUpgrade` 走仓库解析。只读、不改组合、不碰 harness 状态。

- **注册**：`src/tools/index.js` + `src/index.js`（`ALL_TOOLS` 13→14）；纳入 `test/tools-snapshot-smoke.test.mjs` 快照半集成（pre-CI 覆盖 schema/output 漂移）。

- **文档同步**：README / README.en / ARCHITECTURE 工具数 13→14；工具表新增 `plan_upgrade` 行。

### 可配置闸门策略 core/gate.js（方向 4 选项 C）

- **`computeGate(findings, policy)` 可选 policy**：`--policy <file.json>`（或 `buildCheckReport(analysis,{policy})`）显式 opt-in 才改变裁决。无 policy 走冻结路径（逐字节兼容，`gate-lever`/`check-report-schema` 不破）。

- **策略结构** `{ severity?, tier?, confidence? }`，值 `block|warn|allow`；每条 finding `baseline = severity[finalSeverity]`（缺省 blocking/high→block，否则 allow），`tier`/`confidence` 只收紧（`stricter`，block>warn>allow）——降级用 `severity`、权威证据用 `tier` 钉死。

- **修复方向 4 误标**：契约冲突在 scan cap 下即使置信被压成 medium/capped，`policy.tier["contract-source":"block"]` 仍判定 block（不再被误标 degraded）。

- **pass 语义**：有 policy 时 `gate.pass = 无 block 裁决`（`gate.blocked` 仍为冻结 severity 计数，报告保留原始红灯）；无 policy 时 pass 保持「任何 blocking/high 即 fail」。

- **新增导出/入口**：`validatePolicy`/`resolveVerdict`/`stricter`；CLI `check --policy file.json`（校验失败 exit 2）；report `gate.policyApplied` 标记。

- **新增 `test/gate-policy.test.mjs`**（自包含套件 25→26，11 项）：validatePolicy 校验、resolveVerdict baseline+tier 收紧、契约冲突 scan cap 下仍 block、severity 降级放行、policy/冻结 pass 差异、buildCheckReport 集成。

- **文档同步**：README / README.en 自包含套件 25→26；ARCHITECTURE `gate.js` 行扩为「闸门裁决」、新增 `3.5.1 可配置闸门策略` 小节与 gate-policy 测试表行。

### 闸门杠杆与置信分层 core/gate.js（方向 4）

- **新增 `core/gate.js`**（核心模块 29→30）：`computeGate(findings)` 在冻结的 `gate.pass`/`blocked` 语义（任何 blocking/high 即 fail，与置信无关，由 check-report-schema 守护）之外追加透明层——`lever`（block/degraded/advisory）、`blockedBy[]`（「因哪条规则拦了谁」装载级明细含 finding_id/rule/finalSeverity/confidence/evidenceTier/capped）、`degraded[]`（scan cap 或低/中置信却达阻断级别，建议 dump-config 复核）；`gateFromFindings`/`severityBlocks` 一并导出。

- **接线（追加式，report@1 不破）**：`buildCheckReport` 的 `gate` 增加 `blockedBy`/`degraded`/`lever`；`projectFinding` 追加 `capped`/`rule` 字段；`report.js::gates` 改委托 `computeGate`（单一实现）。

- **展示**：`check` BLOCKED 时文本打印 lever 与前 8 条阻断明细（rule#id (confidence[/capped])）；report.md 在闸被触发时输出「闸门明细（blockedBy）」置信分层表与降级提示。

- **新增 `test/gate-lever.test.mjs`**（自包含套件 24→25，12 项）：lever 三态、blockedBy/degraded 明细、capped 与低/中置信降级、冻结 pass 语义保持、buildCheckReport 集成、规则兜底。

- **文档同步**：README / README.en / ARCHITECTURE 模块 29→30、自包含套件 24→25；ARCHITECTURE 模块表加 `gate.js` 行 + 新增 `3.5 闸门杠杆与置信分层` 小节。

### 方向 1 文档收口（S5）

- **README**：CLI 段补 `dsh-forge plan --to <pkg@ver,...>` 示例（含 `--json`）+ 方向 1「升级路径预演」概述段（离线、只读、永不 gate-exit，`core/plan.js` 定位）。

- **README.en**：工具表补 `plan_upgrade` 行（S4 曾漏，本轮补上）。

- **ARCHITECTURE**：core 模块表加 `plan.js` 行（`proposeUpgrade`/`simulateUpgrade`/`cloneWithVersion`）；新增 `3.4 升级路径预演` 小节（含调用树、@latest 网络路径、单调 `satisfies` 复用）。

### DSH_HOME 自动探测（truthSource 稳定性修复）

- **自动探测 DSH_HOME**（`core/truth.js` / `src/tools/common.js`）：新增 `resolveDshHome()`，当 harness 未注入 `DSH_HOME`/`DSH_BIN` 时自动探测 `~/.dsh` 部署根，使 `truthSource=auto` 优先走 `dump-config` 而非静默降级 `scan`。此前插件进程缺少 `DSH_HOME` 时 `findDshBin` 返回 null，导致每次打开插件都落到 `scan`。

### 修复 plan_upgrade 工具 schema 编译（harness 启动阻塞）

- **修复 `plan_upgrade` 输出 schema**（`src/tools/plan.js`）：`registry`/`registrySource`/`networkFailures` 由 `required: false` 改为 `required: true`。`dsh-tools@0.1.1-rc.2` 的 `defineTool` schema 编译器要求属性一旦声明 `required` 就必须为 `true`，否则 `dsh web`/harness 加载插件树时在 `defineTool` 阶段抛 `UNSUPPORTED_SCHEMA`（`schema.properties.registry.required must be true when present`），插件无法启动。改为与其余 13 个工具一致的 `required: true` 约定后正常编译。

- **离线路径 `registry` 兜底为字符串**：无 `@latest` 目标时 `registry` 不再返回 `undefined`，回退到 `args.registry || config.registry`，兜底 `"offline"`，保证必填 string 字段恒有值。

- **验证**：`defineTool(planTool())` 编译通过；`plan-upgrade` 套件 39 项全过。

## [0.1.12] - 2026-08-21

### v0.1.12 补丁 — 依赖图谱交互增强 + 图谱专项测试

- **依赖图谱交互增强**（`web/dashboard-client.js` / `core/dashboard.js`）：总览仅渲染主要关系线（`importantEdge`）减少初始卡顿，点击节点展示完整前置/后置依赖；合成边可视化 `forge-ui → forge`（淡灰）修复两组件在图谱不连通；固定画布布局 + 右侧详情面板；边数过多自动降密度渲染。
- **文本渲染修复**：SVG 节点文本截断（`fitText`）+ `clipPath` 裁切，修复长名称溢出与文字消失。
- **图谱专项测试**：新增 `test/graph-test.mjs`（23 用例，自包含套件 22→23，用例总数 952→975），覆盖总览渲染、节点点击详情、以及『添加组件后图谱正确显示』场景。

# [0.1.11] - 2026-08-21

### v0.1.11 补丁 — harness 基线同步到 0.1.1-rc.2（依赖升级 + 知识图谱更新）

- **依赖基线升级**（`package.json`）：`@deepseek-ai/dsh-tools` `^0.1.0-rc.6` → `^0.1.1-rc.2`，`defineTool` API 兼容；`pnpm-workspace.yaml` `minimumReleaseAgeExclude` 13 条排除同步升到 `0.1.1-rc.2`。
- **知识图谱版本门控更新**（`core/knowledge.js`）：`PATTERNS_HARNESS_VERSION` `0.1.0-rc.6` → `0.1.1-rc.2`，消除 `knowledge-version-drift` 对最新部署的误告警，知识库模式结论以此版本为验证基线。
- **文档同步**：README / README.en 顶行 `harnessVersion`、ARCHITECTURE「harnessVersion 绑定」同步为 `0.1.1-rc.2`。

## [0.1.10] - 2026-08-20

### v0.1.10 补丁 — Web 面板共享化 + 后端自动拉起 + 弹窗新窗口

- **`core/web-server.js` 共享模块**：将 CLI 的 HTTP 路由/CORS/端口探测/浏览器打开抽为可复用模块（纯 Node 内置 API），CLI 与 harness 插件壳 `src/index.js` 复用同一 3060 数据通道，核心模块 27→28。
- **后端自动拉起 Web 面板**：`apply(ctx, config)` 注册工具后 `void startAutoWeb(cfg)` 同步启动 3060 服务（best-effort，失败/端口占用自动降级并显式提示），弹窗仪表盘无需手动 `dsh-forge web` 即可实时读取。
- **弹窗「新窗口」按钮**（`ui-plugin/lib/client.template.js`）：头部新增按钮，`window.open(SERVER + "/", "_blank")` 在独立浏览器窗口打开仪表盘。

## [0.1.9] - 2026-08-20

### v0.1.9 正式版 — 文案纠偏 / 实时依赖明示 / 构建与文档同步 / 写盘 API 收紧

- **P0 泄漏文案纠偏**（`core/report.js`）：统一为「副作用泄漏（非可逆副作用）」，移除「Token / 密钥」误导标题；空态改为「未检出可疑的非可逆副作用泄漏」。
- **history 失败可见**（`core/report.js` `writeReport`）：历史归档 catch 由静默改显式，返回 `historyError`，由 `POST /api/report` 透出并在弹窗提示（history 已归档 / history 失败: <原因>）。
- **报告/历史路径可配置**：新增 `DSH_FORGE_REPORTS_DIR` / `DSH_FORGE_HISTORY_DIR` 环境变量覆盖 `reports/` 与 `data/history/` 落盘位置。
- **API 方法校验 + 非本机写保护**（`cli/dsh-forge.mjs`）：`/api/report` 仅允许 POST（否则 405），`/api/refresh`、`/api/history` 仅允许 GET；绑定非 loopback 主机时拒绝写盘（403）并启动大字警告。
- **本地开发 CORS**（`cli/dsh-forge.mjs`）：`/api/*` 与首页回显 `Access-Control-Allow-Origin` + `Vary: Origin`，消除 harness 源跨域拉取 3060 的拦截。
- **弹窗实时/快照状态明示**（`ui-plugin/lib/client.template.js`）：副标题固定展示「实时 · 3060 已连接」/「快照 · 请先运行 dsh-forge web」，避免把快照误当实时。
- **文档同步**：ARCHITECTURE 设计原则改为「分析只读；报告/历史为可选落盘」；核心模块表纳入 `core/report.js`（26→27，doc-consistency MODULE_COUNT 改为按 `core/` 目录程序化计数）；src 流程 `createCalibration` → `createRuntimeCalibration`。


## [0.1.9-beta] - 2026-08-20

### UI 三端信息补全 + 皮肤系统 + 图表增强 + 端口 3060

- **三端融合详情补齐**：Web/弹窗（`core/dashboard.js`）与 TUI（`cli/dsh-forge.mjs`）统一展示 `finalSeverity`/`evidenceTag`/`runtimeState`/`finding_id`；conflicts 表与 leaks 表同步补全「原始级别/最终级别/证据标签/运行时状态」列，旧数据安全回退（`finalSeverity → severity`、缺失标 `—`）。
- **图表增强**：概览页新增「运行时校准三态分布」环形图、「冲突类型分布」柱图与「快照历史趋势（行数）」折线图，全部零依赖 SVG 并用 CSS 变量适配主题。
- **皮肤系统**：新增 `core/skins.js`（light/dark 双主题 token + `skinCssVars`）；`dashboard.js` 样式表全面 CSS 变量化（`var(--dsh-*)`），页头新增主题切换按钮并 localStorage 持久化；弹窗与 Web 复用同一套 HTML/CSS/JS，替换 `:root` 变量即可换肤。
- **端口调整**：Web 默认端口 8080 → 3060（`cli/dsh-forge.mjs` `DEFAULT_WEB_PORT`、`--port` 帮助文本与 README/README.en 示例同步）。
- **文档同步**：core 纯逻辑模块数 25→26（新增 `skins.js`），ARCHITECTURE 模块表纳入 `skins.js`，doc-consistency `MODULE_COUNT` 同步。
- **弹窗直连 3060**：ui-plugin 弹窗打开时经 iframe `fetch http://localhost:3060/` 拉取实时网页仪表盘，与 Web 端同一数据源；3060 不可用时回退内嵌快照。
- **开发者数据面板**：概览页新增「开发者数据 · 扫描概览」——真相源/置信度上限/harness 版本/组合行数/包数/依赖边/配置层数/快照时间 KPI + 分层分布柱图；如实注明 dsh-forge 为静态依赖分析器、不产生 LLM token 用量，故不展示伪造的 token 指标。

### 实时集成进弹窗 + 生成报告 + 开发者面板 + 快照历史

- **弹窗承载实时功能**：插件弹窗成为主界面——打开即经 3060 数据通道 fetch 最新仪表盘（live 徽标），3060 不可用自动回退内嵌快照（snapshot 徽标）；文案由「只读 · 模拟不落盘」改为如实反映「实时分析 · 动态刷新 · 报告可生成」。
- **弹窗操作按钮**：弹窗页头新增「生成报告」+「快照历史」+「刷新」三按钮——生成报告经 `POST /api/report` 返回落盘路径并归档快照；快照历史经 `GET /api/history` 返回归档条数；刷新重新拉取最新仪表盘。
- **报告生成 core 能力**（新增 `core/report.js`）：`buildMarkdownReport` 把 `runAnalysis()` 结果渲染为 Markdown（总览/冲突明细/泄露明细/高风险 Top/脆弱链路/开发者数据），`writeReport` 写入 `reports/report-*.md` 并归档快照到 `data/history/`；`core/index.js` 同步导出，零依赖。
- **3060 数据通道协议**：`cli/dsh-forge.mjs` Web 服务新增 `GET /api/refresh`（重分析并附带报告）、`POST /api/report`（生成报告+归档）、`GET /api/history`（历史归档列表），连同既有 `/healthz` 供弹窗消费。
- **TUI 报告视图**：TUI 新增 `G` 一键生成报告并进入可上下滑动长文本视图（↑/↓/PgUp/PgDn/space/b，`Q`/Esc 返回），`V` 手动打开，`R` 在报告视图中重新生成，底部滚动条显示行号区间与文件 basename；无浏览器/服务器的系统可直接在终端浏览长报告。
- **TUI 开发者面板**：`D` 键切换开发者面板（组合行数/唯一包数/依赖边/配置层数/真相源/置信度上限/harness/收集时间/冲突/泄露/平均与最大风险/校验结果）。
- **模块计数同步**：ARCHITECTURE 模块表与 doc-consistency MODULE_COUNT 纳入 `core/report.js`，全量 20+ 自包含测试套件 + 组合契约均通过。
## [0.1.8] - 2026-08-20

### v0.1.8 正式版：live 混合验证打通 + 复数感知校准统一

- **引擎注入点**（`core/index.js` `runAnalysis`）：新增可选 `opts.runtimeCalibration`；live 注入时绕缓存（观测依赖挂载期事件窗，非复现基线），缺省仍 `staticRuntimeCalibration()`（诚实 not-executed），CLI/离线/CI 零变化且可复现。
- **live 校准统一（v0.1.8 续）**：插件壳 src/index.js 移除旧 createCalibration，仅保留 createRuntimeCalibration 单一路径；桥接下沉为 core/runtime-calibration.js 的 `connectHarnessEvents`（可离线纯函数）——按 RUNTIME_LIFECYCLE_EVENTS 事件名契约精确订阅，direct 顶层事件 + session/event 包装回退，按实际送达去重（仅收到过 direct 才压制 wrapped，wrapped-only 主机仍能喂入）；无总线时 honest 降级 not-executed。新增 test/live-cal-unify.test.mjs（15 用例；套件 20→21，总用例 937→952）。
- **壳总线适配**（`src/index.js`）：新增 `buildHarnessRuntimeCalibration`，把 harness 的 `session/event` 总线经虚拟 ctx 转发为运行时校准器订阅的 top-level 事件并 `start()`；无总线可绑定时 `dispose()` 返回 `null`，回退离线源。
- **工具层 fuse 接线**（`src/tools/conflicts.js`）：`check_conflicts` 先 `fuse` 再输出，findings 携带 `finalSeverity`/`evidenceTag`/`runtimeState`/`finding_id`，顶层附 `runtimeCalibration` 快照；schema 补齐声明。无 live 时 fuse static 基线，输出与 CLI 引擎一致（not-executed，诚实未观测，不视为干净）。
- **复数感知校准（正式版收口）**：`core/runtime-calibration.js` `observeState` 现支持 plural 载体 `f.packages[]`（conflicts finding 携带数组而非 `package`），多包 finding 任一包被真实生命周期事件激活即观测（executed-clean），任一包残留信号即 executed-residual；离线 stub 仍诚实 not-executed。live-cal-unify 补 3 条（12→15）；文中证据：裸 timer/listener、动态工具名仍是可疑级，非形式化证明。
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
