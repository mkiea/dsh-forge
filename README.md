# dsh-forge

> [English](./README.en.md) | 中文

> 版本：0.1.16（正式版）· harnessVersion: 0.1.7-rc.2

DeepSeek Harness **插件组合分析**插件：依赖分析、冲突检测、风险评估（含预测）、可视化与组合模拟。

> **0.1.17（未发布）**：Web 端自动更新 + 在线操作 —— 仪表盘通过 SSE（`/api/events`）监听组合文件变更并自动重分析，不可用时降级 15s 轮询；新增「在线操作」页（自动更新开关、快照历史/归档、组合模拟、升级预演与执行）与 `/api/state`、`/api/history`、`/api/snapshot`、`/api/simulate`、`/api/conflicts`、`/api/upgrade`、`/api/plan`、`/api/update` 端点；版本检测支持 forge / dsh 双目标、镜像 failover、`confirm` 令牌与 `package.json` 备份。**Web × 桌面连通器**：`core/bridge.js` 用同一引擎采集 Web profile 与桌面 `app.asar`，`dsh-forge bridge` 与「Web × 桌面」页/`/api/bridge` 输出两端差异（仅 Web / 仅桌面 / 版本漂移 / harness 漂移）。**鲁棒性加固**：请求体 256KB 上限（413）、非法 JSON 400、未知 `/api` JSON 404、方法 405、SSE 客户端上限与断线回收、刷新单飞（并发请求共享一次扫描）、`/api/simulate` 载荷裁剪。同时包含桌面版适配 —— 自动定位 Electron `resources/app.asar`，从归档读取清单/组合补丁/源码与 harness 版本；`--profile desktop` 不再尝试会被桌面应用拒绝的 `--dump-config`，动态探测把 asar 内包诚实标记为未执行；`simulate_combination` 的同名行操作改为作用于全部作用域行。`core/` 34 个纯逻辑模块，32 个自包含套件全部通过。

> **v0.1.16**：静态扫描修复 harness 0.1.7 内嵌布局（插件位于 `<nm>/@deepseek-ai/dsh/node_modules`，采集清单 7 → 188）；新增运行期动态扫描 `check --dynamic` / `verify_rows dynamic:true`（子进程真实 `import()` 每个包入口，捕获 `does not provide an export named` 这类静态盲区），失败以 `runtime-probe` 证据并入 gate；知识库新增 0.1.7 扫描重点（内嵌布局、dsh-llm 移除 `CallId`、`dsh-tools<0.1.7` 告警）；`simulate_combination` 同步支持内嵌根，已安装包不再被误判为合成清单；冲突检测改为**作用域感知**（agent preset 子树内同名工具/服务合法）、仅扫描启用行、按平台求值 `disabled: !!js`，并过滤打包残留的死代码服务与 `*` 版本噪声。`core/` 31 个纯逻辑模块，29 个自包含套件全部通过。

> **v0.1.15 补丁**：harness 基线同步到 `0.1.7-rc.2` —— `@deepseek-ai/dsh-tools` `^0.1.1-rc.2` → `^0.1.7-rc.2`，修复 `dsh-tools@0.1.1-rc.2` 从新版 `dsh-llm` 导入已移除的 `CallId` 导致插件 `failed to import`（`dsh web` 无法加载 forge）；`pnpm-workspace.yaml` 排除项与知识图谱验证基线 `PATTERNS_HARNESS_VERSION` 同步。现有 14 个只读工具，`core/` 30 个纯逻辑模块零依赖，26 个自包含套件全部通过。

## 工具（14 个，全部只读；simulate\_combination / archive\_snapshot 不碰组合本体）

### 分析

| 工具                     | 说明                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `analyze_dependencies` | 组合依赖树 + 共享依赖摘要 + 范围满足性                                                                |
| `check_conflicts`      | 版本冲突 / 工具重名（**作用域感知**：per-agent 变体合法）/ 服务覆盖 / 缺失提供者 / 行覆盖 / 泄漏扫描 / **运行期行为校准**（事件流基线） |
| `visualize_plugins`    | HTML / Mermaid / ASCII / **dashboard**（workspace 交互仪表盘，10 模块）输出                       |
| `simulate_combination` | 假设组合模拟：新增/解除冲突、风险增量、判定                                                                |
| `audit_configuration`  | 逐行配置审计（openAt / telemetry mode / 内存路径 / fetch 等）                                      |
| `diff_combinations`    | 两个快照（或快照 vs 当前）的行增删改 + 风险增量                                                           |
| `preset_compare`       | standard / ptc / minimal / cordis 预设行集与工具面对比（支持 0.2.x `<id>.patch.yml`、旧版 `<id>/agent.cordis.yml` 与桌面 app.asar） |
| `verify_rows`          | 行级装载预检（包可解析 / dsh.client / client.js 构建）+ **运行期服务探测** + 可选**运行期导入探测**（`dynamic: true`） |

### 生命周期

| 工具                 | 说明                          |
| ------------------ | --------------------------- |
| `archive_snapshot` | 存档当前组合到 data/history（快照历史）  |
| `snapshot_history` | 列出/加载历史快照                   |
| `history_stats`    | 历史趋势统计（行数/健康度时间序列，仪表盘含趋势面板） |

### 决策支持

| 工具               | 说明                                                                     |
| ---------------- | ---------------------------------------------------------------------- |
| `suggest_patch`  | 冲突建议 → cordis.patch.yml 补丁文本（只输出，不写盘）                                  |
| `check_upgrades` | npm registry 最新版本检查 + 升级阻断预测（**并发池 + 独立超时 + 镜像自动降级 + 附安装命令**，网络失败单独上报） |
| `plan_upgrade`   | 升级路径预演：目标版本（或 latest）下 before/after 健康、风险增量、新增/解决冲突、具体下一步（只读）          |

## 架构

三层分离，详见 [ARCHITECTURE.md](./ARCHITECTURE.md)：

```
core/          零依赖分析引擎（36 个模块，Node 内置 API only）
  ├─ composition.js   组合源发现 + YAML 解析 + 生态收集
  ├─ truth.js         dump-config 真相源（auto/dump-config/scan 三态）
  ├─ analyze.js       依赖图构建 + 风险评估
  ├─ conflicts.js     冲突检测（版本/工具/服务/泄漏）
  ├─ scope.js         作用域感知（global vs per-agent 变体）
  ├─ calibration.js   运行期事件校准（行为基线）
  ├─ leaks.js         非可逆副作用泄漏扫描
  ├─ semver.js        SemVer 解析 + 区间满足性
  ├─ upgrade.js       npm registry 升级检查（并发池 + 镜像降级）
  └─ ...              audit / diff / simulate / visualize / dashboard / ...
src/          cordis 插件壳（src/tools/ 每工具一文件，14 个工具的 schema 定义 + 注册）
ui-plugin/    浏览器端客户端插件（sidebar 入口 + modal 仪表盘）
```

## 插件安装步骤

本插件由两个包组成，均通过 **link 依赖** 持久化装入 dsh profile（symlink 指向源码，改代码即生效）：

- **dsh-forge**（host 插件）：14 个分析工具，在 HOST 平面运行

- **dsh-forge-ui**（client 插件）：GUI 右侧 sidebar 底部「▦ 插件仪表盘」入口，点击弹窗显示 `reports/dashboard.html`（iframe 内嵌）

### 前置条件

- Node.js ≥ 20（实测 v24.18.0）

- 已安装 DeepSeek Harness CLI：`npx @deepseek-ai/dsh --version` 可执行

- 已有目标 profile（默认 `web`，位于 `$HOME/.dsh/profiles/web/`；`dsh` 目录即 `$DSH_HOME`）

### 第 1 步：获取源码

```bash
git clone https://gitee.com/mkieaAG367/dsh-forge.git # 从 Gitee 克隆
git clone https://github.com/mkiea/dsh-forge # 从 GitHub 克隆
cd dsh-forge
```

### 第 2 步：持久化安装到 profile（link 依赖，推荐）

dsh 的 profile 本身是一个 pnpm 工作区（`package.json` + `pnpm-workspace.yaml`），
`dsh plugin` 命令是 **pnpm 透传封装**（`npx @deepseek-ai/dsh plugin --profile web <pnpm 子命令>`）。
用 `link:` 依赖把插件链进 profile，`node_modules` 中出现指向源码的 symlink：

```bash
# host 插件（14 个分析工具）
npx @deepseek-ai/dsh plugin --profile web add "dsh-forge@link:C:/Users/<you>/DeepForge/dsh-forge"

# client 插件（GUI 仪表盘入口）
npx @deepseek-ai/dsh plugin --profile web add "dsh-forge-ui@link:C:/Users/<you>/DeepForge/dsh-forge/ui-plugin"
```

> 路径请使用 Windows 绝对路径（`C:/...` 正斜杠）。若插件名带 `link:` 前缀被 shell 转义，可在路径外加引号。

**等价手工方式**（不依赖 dsh plugin）：编辑 `$HOME/.dsh/profiles/web/package.json` 的 `dependencies` 追加两行：

```json
{
  "dependencies": {
    "dsh-forge": "link:C:/Users/<you>/DeepForge/dsh-forge",
    "dsh-forge-ui": "link:C:/Users/<you>/DeepForge/dsh-forge/ui-plugin"
  }
}
```

然后在 profile 目录执行 `pnpm install`（同 `npx @deepseek-ai/dsh plugin --profile web install`）。

完成后确认：

```powershell
Get-Item "$HOME\.dsh\profiles\web\node_modules\dsh-forge" | Select-Object -ExpandProperty Target
# -> C:\Users\<you>\DeepForge\dsh-forge
```

### 第 3 步：配置组合补丁 cordis.patch.yml

编辑 `$HOME/.dsh/profiles/web/cordis.patch.yml`，**追加**两行 insert（文件顶部注释说明了 patch 层语义）：

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

**背景说明**：

- profile 根 `cordis.yml` 是空入口 `[]`，组合树完全由 patch 层构成：
  `package.json` 的 `dsh.profile.bundles`（dsh-base / dsh-web-app）→ `cordis.patch.yml` → `--patch` 覆盖。
  因此**只改 cordis.patch.yml，不改 cordis.yml**。

- 每个 `- insert:` 是一个顶层 loader patch entry：`id` 是行标识（幂等去重键），
  `name` 是包名（从 profile 的 node\_modules 解析），`config` 传给插件的 `apply(ctx, config)`。
  patch 层还支持 id 定向的 config 覆盖、disables 与 `!!js` 表达式（见文件顶部注释）。

### 第 4 步：重启 harness

```bash
npx @deepseek-ai/dsh web
```

成功标志：启动日志无 `Cannot find module` / schema 校验（`JsonSchemaError`）报错，服务监听 `http://127.0.0.1:3080`。

### 第 5 步：验证

1. 浏览器打开 `http://127.0.0.1:3080`，控制台无报错
2. 右侧 sidebar 底部出现「▦ 插件仪表盘」按钮（点击弹窗显示仪表盘）
3. 对话中可调用 14 个工具（`analyze_dependencies` / `check_conflicts` / `visualize_plugins` / `simulate_combination` / ...）
4. 离线快速自检（不依赖 harness）：

```bash
cd dsh-forge && node --input-type=module -e "import('./src/index.js').then(m => console.log('plugin import OK:', m.name))"
```

### 开发模式：改动生效机制

| 改动内容                                   | 生效方式                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| host 插件代码（`core/`、`src/`）              | **必须重启 harness**（模块已在进程中缓存，且 `defineTool` 在 apply 时编译 schema）                                                                                |
| client 插件内容（`ui-plugin/lib/client.js`） | symlink 即时同步，但 manifest / 插件集合变更需重启                                                                                                          |
| 仪表盘内容（`web/`、`reports/dashboard.html`） | `node scripts/generate-dashboard.mjs`（用当前 dashboard.js 重新生成）→ `node scripts/build-ui.mjs`（内嵌进 client.js）→ 重启                                 |
| 一键挂载（免手工复制）                            | `node scripts/mount-ui.mjs`（自动探测部署 node\_modules 并复制 ui-plugin + 写 patch；支持 `DSH_DEPLOY_NM` / `DSH_FORGE_ROOT` / `DSH_PROFILE_PATCH` 环境变量覆盖） |

### 卸载

```bash
cd "$HOME/.dsh/profiles/web"
npx @deepseek-ai/dsh plugin --profile web remove dsh-forge dsh-forge-ui
```

并从 `cordis.patch.yml` 移除对应两行 insert，重启 harness。

### 组合发现机制（host 插件运行时）

插件运行时从 `$DSH_HOME/profiles/<profile>` 自动发现组合：
profile 根 `cordis.yml` → **bundle 补丁（dsh-base / dsh-web-app，自动定位部署根）** →
`cordis.patch.yml`；包清单与已安装版本从部署 node\_modules 读取（无需传 `root`）。
也可传 `compositionSources` / `dataset`（离线快照）/ `root` 覆盖。

## 离线快照

`data/ecosystem.json` 是分析时生成的快照（`format: dsh-forge-ecosystem@1`），
可用 `dataset` 参数复现同一份分析。

## 命令行复现（无插件运行时）

CLI / 插件壳 / Web 统一经 `runAnalysisAsync()` 装载分析（dump-config 优先，取不到才回退 scan，v0.1.14）：

```bash
node --input-type=module -e "
import { runAnalysisAsync } from './core/index.js';
const r = await runAnalysisAsync({ profile: 'web' });   // 优先 dsh --dump-config，回退源码扫描
console.log(JSON.stringify(r.assessment, null, 1));
"
```

离线快照复现（确定性、无 harness）用同步 `runAnalysis({ datasetPath })`；CLI 层 `loadAnalysisAsync()` 保持同一 dump-config 优先偏好。

## 独立 CLI：TUI / Web / check 三态（默认 TUI，按需 Web）

`dsh-forge` 提供独立命令行入口（`bin` 指向 `cli/dsh-forge.mjs`），
UI 形态不靠猜测，由 `core/mode.js` 按四层证据决策：

1. **启动入口**（硬判断）：`dsh-forge tui` 强制 TUI；`dsh-forge web|serve` 启动 Web 并打开浏览器；`dsh-forge check|ci` 纯日志/`--json`，无界面；`dsh-forge bridge` 对比 Web 与桌面两端组合；`dsh-forge sync` 把 Web 插件/版本对齐到桌面基线（默认只读推演，`--apply` 才安装并验证）。
2. **运行环境**（自动检测）：`stdout.isTTY` + `TERM != dumb` 才进 TUI；检测 `DISPLAY`/`WAYLAND_DISPLAY`/`SESSIONNAME` 桌面会话；无 TTY 但有桌面时自动 Web；端口被占用自动降级 TUI/check。
3. **用户场景**：CI 环境（`CI` 变量）与 `--json` 请求直接走 check，供监控/脚本消费。
4. **数据复杂度**（自适应兜底）：< 10 插件直接 TUI；> 30 插件提示 “建议 `dsh-forge web` 查看交互拓扑”，TUI 内按 `W` 一键切 Web。

```bash
node cli/dsh-forge.mjs               # 自动决策（终端内默认 TUI）
node cli/dsh-forge.mjs tui           # 强制 TUI（W=打开 Web，R=刷新，Q=退出）
node cli/dsh-forge.mjs web           # 强制 Web（--port 3060，--no-open 不自动开浏览器）
node cli/dsh-forge.mjs check --json  # CI/CD 机器输出
node cli/dsh-forge.mjs check --dynamic --json  # 额外运行期导入探测（捕获缺失导出等链接期错误，结果并入 gate）
node cli/dsh-forge.mjs plan --to @deepseek-ai/dsh-settings@0.1.7-rc.2   # 升级路径预演（纯咨询，永不 gate-exit）
node cli/dsh-forge.mjs plan --to @deepseek-ai/lib@latest --json          # 带 --json（@latest 经注入 fetch 走仓库解析）
node cli/dsh-forge.mjs sync --static                                     # 只读推演：web 需对齐到桌面基线的插件/版本
node cli/dsh-forge.mjs sync --apply --confirm sync-web                   # 真正安装，安装后校验版本 + 动态 import，失败回滚
```

`dsh-forge plan --to <pkg@ver,...>` 是**升级路径预演**（方向 1）：离线且确定性地预测「把指定包升到目标版本（或 `@latest`）后」，组合的 before/after 健康、风险增量、新增/解决冲突以及一句话结论与具体下一步。纯咨询命令——只读、不改组合、**永不触发** **`check`** **的 gate-exit**；`proposeUpgrade`（范围/阻断预判）+ `simulateUpgrade`（版本上移编排，复用 `applyOps`/`simulateCombination`/`diffCombinations`）都位于 `core/plan.js`，全离线可测。

`dsh-forge sync` 是**跨端对齐**：以桌面端为基线，把 web 端插件与版本补齐/校正。默认只输出计划；`--apply --confirm sync-web` 才执行，并强制闭环——registry 预检 → 备份 profile 文件 → 安装 → 重新采集组合 → 校验精确版本（含直接读取 `node_modules` 清单）→ 动态 import 探测 → 任一步失败则回滚并给出恢复命令。`link:` / `git+` / 版本区间依赖不会被替换；桌面端 `@deepseek-ai/*` 属于应用运行时，默认不镜像进 web（`--include-runtime` 显式开启）。桌面端是 Electron 管理的只读 `app.asar`，所有面向桌面的写操作都标为 blocked，需随桌面应用更新。

TUI 与 Web 双壳复用同一套 `core/` 分析引擎；TUI 为零依赖 ANSI 渲染器，
Web 为零依赖 `node:http` + 10 模块交互仪表盘（缺 `web/dashboard-client.js` 时
自动回退到自包含 SVG 拓扑页；不引入 Express/ECharts，保持 core 零依赖与可离线部署）。
Web 形态采用**混合审查**：每次请求用当前分析结果新鲜渲染（静态层），页头提供 `↻ 刷新`
按钮调用 `GET /api/refresh` 清除分析缓存并重新分析（动态层），无需刷新页面即可让仪表盘如实反映组合变更。

「依赖图谱」页是 ComfyUI 风格的**节点编辑器**：深色网格画布上每张卡片＝一个插件（卡片头颜色＝风险级别，红色虚线＝版本冲突），可自由拖动并记住位置（`localStorage`），滚轮缩放、拖空白平移。左侧调色板列出「已安装未组合」的候选包，可拖入画布或点击添加（写入假设模拟的 `state.added`）；把节点拖到左侧回收区或用 Delete＝从画布移除（写入 `state.removed`），调色板可一键恢复。**图谱只是既有分析数据的交互投影，不是第二套数据真相源**：连线不能手工创建，拖入/移除一律标注为推演（hypothetical），不修改真实组合。点节点看前置(→)/后置(←)依赖，点连线看该关系的证据层级、来源、置信度与 why/caveat。

## 验证状态

- `dsh web` 正常启动于 <http://127.0.0.1:3080，浏览器无报错，**13> 个工具\*\*注册成功

- `analyze_dependencies` 真实执行：4 层组合（profile 根 + dsh-base + dsh-web-app + patch），
  294 行（284 插件）/ 188 包 / 2258+ 依赖边

- 自动化测试（35 个自包含套件；smoke13 13/13 依赖本机 harness，不入 CI）：

  - `test/ui-test.mjs` — 仪表盘 workspace 结构与交互（79 项，含 v0.1.5 混合架构页/嵌入字段/finding\_id 语义与渲染断言，及 v0.1.6 引导页/名词解释/悬停提示/规范标签 + 旧模块引导条/表头详释）

  - `test/ui-plugin-test.mjs` — 客户端插件 VM 执行 + slot 注册 + 模态交互（22 项）

  - `test/semver-consistency.test.mjs` — SemVer 单一实现回归 + 防镜像回归（30 项）

  - `test/review-fixes.test.mjs` — 作用域三态 / 事件校准 / 泄漏切片（15 项）

  - `test/upgrade-opt.test.mjs` — 升级检查并发/超时/降级/安装命令（16 项）

  - `test/feedback-smoke.test.mjs` — 错误反馈冒烟（40 项）

  - `test/empty-plugins.test.mjs` — 空组合 / 泄漏规则（24 项）

  - `test/exploratory-empty.test.mjs` — 随机子集探索（27 项）

  - `test/exploratory-feedback.test.mjs` — 反馈深度探索（563 项）

  - `test/mode-decision.test.mjs` — TUI/Web/check 四层决策引擎（19 项）

    - `test/cache-behavior.test.mjs` — runAnalysis 缓存失效/淘汰/快照守护（7 项）

    - `test/tools-snapshot-smoke.test.mjs` — 14 工具快照半集成 + output.schema 校验（14 项）

    - `test/composition-strict.test.mjs` — YAML fail-loud + vm 沙箱逃逸回归（10 项，含 inline comment、cordis inject 与 `group`/`isolate` 行键）

  - `test/evidence-fusion.test.mjs` — 证据融合引擎（A-1 三态 + A-2 稳定 id + A-3 可行动 + 7 行矩阵 + INV-3 绝不清除，23 项）

  - `test/runtime-calibration.test.mjs` — 运行时校准（A-4 滑窗/基数上限 + INV-2 时序边界 + 可逆性，25 项）

  - `test/truth-source-degradation.test.mjs` — 真相源三态降级（INV-4 置信度上限，17 项）

  - `test/check-report-schema.test.mjs` — P0-3 冻结 check --json 报告 schema 与 gate 门禁（10 项）

- `test/gate-lever.test.mjs` — 方向 4 闸门杠杆（lever/blockedBy/degraded）与置信分层，冻结 gate.pass 语义保持（12 项）

  - `test/finding-id-uniqueness.test.mjs` — finding\_id 唯一性消重回归（服务/行/包维度区分 + A-2 稳定，6 项）

  - `test/main-path-fusion.test.mjs` — 主默认路径融合接线（runAnalysis 对 conflicts/leaks 调 fuse + 离线 not-executed 基线；finalSeverity/evidenceTag/runtimeState + INV-3，8 项）

  - `test/heuristic-detect.test.mjs` — 启发式检测收敛（句柄捕获感知泄漏 + 已知安全降级 + leak-context + 全部 BARE 规则；动态工具名按包追踪 + 显式扫描局限，16 项）

  - `test/live-cal-unify.test.mjs` — live 校准统一（RUNTIME\_LIFECYCLE\_EVENTS 事件名契约 + 双通道桥接去重 + 离线诚实降级，15 项）

  - `test/dynamic-probe.test.mjs` — 运行期导入探测（错误分类 / NDJSON 容错 / 入口解析 / 临时包端到端 / findings 形状与不可变合并，31 项）

  - `test/simulate-roots.test.mjs` — 组合模拟多根解析（内嵌根与主根 / 依赖版本 / 合成清单边界 / remove·override·重复 id / 无 layers 行 / 源生态不可变与确定性，23 项）

  - `test/desktop-asar.test.mjs` — 桌面版 asar 适配（合成归档头解析 / 清单与补丁读取 / 源码扫描 / harness 版本 / 组合收集与冲突检测，18 项）

  - `test/presets.test.mjs` — 预设对比双格式（0.2.x `<id>.patch.yml` 解析 / 嵌套 group 行不越界 / 旧版 `<id>/agent.cordis.yml` / 磁盘优先于 asar 的源发现 / 工具面，23 项）

  - `test/web-auto-update.test.mjs` — Web 自动更新与在线操作（签名/差异 / 版本评估与命令 / 受控执行守卫 / 快照序列合并去重 / state·conflicts·history·simulate·snapshot·update 端点 / SSE hello，28 项）

  - `test/web-robustness.test.mjs` — Web 鲁棒性与连通器（非法/空/数组/超限请求体 / 未知端点与方法 / OPTIONS·nosniff / 刷新单飞 / SSE 上限与回收 / 模拟载荷裁剪 / discoverProfiles·compareProfiles·buildBridge / 未解析 bundle 的 partial 口径 / `/api/bridge` 端点 / 桥接页，41 项）

  - `test/scope-collision.test.mjs` — 作用域感知冲突检测（dump 嵌套 scope / 同域仍报重名 / 兄弟 preset 合法 / 禁用与未挂载排除 / `*` 范围 / 死代码服务过滤 / 依赖按消费者解析（含 vendored 副本）/ 风险分不误报已安装 peer、`*` 范围与不完整扫描，24 项）

  - `test/sync.test.mjs` — 跨端对齐闭环（静态扫描与夹具逐项一致 / 动态探针捕获缺失导出与模块无法解析 / 版本漂移对齐 / `@deepseek-ai/*` 运行时不镜像 / `link:`·`git+`·区间依赖不替换 / 安装后版本+导入校验 / 失败回滚 / 预检 404·离线 / 确认令牌与零依赖源码检查，61 项）

  - `test/causal-projection.test.mjs` — 因果投影与反事实影响（依赖边=清单契约而非运行期调用 / Service 边来自源码扫描 / 发现→outcome 的 influences / 边证据层级·来源·置信度 / wildcard 视为满足 / 移除推演的结构性影响与 hypothetical 标注，37 项）

  - `test/graph-test.mjs` — 依赖图谱节点编辑器专项（总览过滤渲染 / 节点点击前置后置详情 / 合成边连通 / 添加组件后图谱正确显示 / 调色板拖入与点击添加（进 `state.added`）/ 节点拖动与位置持久化 / Delete 与拖出回收区移除（进 `state.removed`）/ 调色板恢复 / 自动布局回到层级网格 / 外部库显示开关 / 点连线看证据 / 清除选择，41 项）

## 错误反馈体系

- 统一错误码（FORGE-001\~014）+ 分级（fatal/error/warning/info）+ 建议 + 来源。

- 仪表盘"错误与反馈"面板；启动预检致命错误输出到终端 stderr（崩溃场景可诊断）。

- check\_conflicts 输出 `feedback` 字段。

- 仪表盘入口：sidebar 会话框下方/设置上方（sidebar.footer.action）+ 对话流提示卡片（turnTail）；会话头按钮已移除。

## 评审整改（R0–R5）

第三版项目经理评审的验收标准已逐条落实：dump-config 真相源（R0）、未校准声明 + contract/heuristic 分级（R1）、
harnessVersion 绑定与知识库版本门控（R2）、泄漏扫描（R3）、证据分级 static-suspect/contract-source（R4）。
详见 `reports/PM-remediation.md` 与 `CHANGELOG.md`。

## 已知限制（诚实声明）

| 限制                                 | 原因                                           | 缓解                                                                                   |
| ---------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| truthSource 落在 scan 而非 dump-config | 无 `DSH_HOME` 或 npx 安装树路径与 findDshBin 候选不完全匹配 | 自动探测 `~/.dsh`（`resolveDshHome`）减少该场景；仍失败则输出 `truthSource=scan` + warnings 显式标注       |
| 静态扫描覆盖率有限                          | 仅扫描 `lib/**/*.js`，单文件 >400KB 跳过              | findings 标 `confidence: "low"` + disclaimer                                          |
| 实时仪表盘（host.call 拉取）                | harness 仅存在于 cordis 动态插件沙箱，静态插件不可靠注入         | Web 混合审查：静态内嵌 + `/api/refresh` 动态重分析；离线 `generate-dashboard.mjs` → `build-ui.mjs` 重建 |
| 会话事件实时统计                           | 静态客户端插件无运行期事件订阅通道                            | `history_stats` 快照趋势替代                                                               |

## 目录

- `core/` — 零依赖分析引擎（semver / composition / truth / 图构建 / 冲突 / 模拟 / 可视化 / 知识库 / 校准 / 泄漏 / 升级 / mode 决策 / 跨端同步）

- `cli/` — 独立 TUI/Web/check 入口（四层证据决策，默认 TUI 按需 Web）

- `src/` — cordis 插件壳（src/tools/ 每工具一文件，14 个工具的 schema 定义 + 注册）

- `ui-plugin/` — 浏览器端客户端插件（sidebar 入口 + modal 仪表盘）

- `web/` — 仪表盘客户端脚本（生成时内嵌进 dashboard.html）

- `prompt/` — 专家 persona 提示词（含风险预测）

- `data/` — 生态快照（`ecosystem.json` versioned；`history/` 运行期生成，gitignored）

- `reports/` — 生成的分析报告与图谱

- `test/` — 自包含测试套件（35 套件 1382 项，零本机依赖）

- `scripts/` — 生成与构建脚本（generate-dashboard / build-ui / mount-ui）

