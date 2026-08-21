# dsh-forge

> [English](./README.en.md) | 中文

> 版本：0.1.11（正式版）· harnessVersion: 0.1.1-rc.2

DeepSeek Harness **插件组合分析**插件：依赖分析、冲突检测、风险评估（含预测）、可视化与组合模拟。

> **v0.1.11 补丁**：harness 基线同步到最新 `0.1.1-rc.2` —— `@deepseek-ai/dsh-tools` `^0.1.0-rc.6` → `^0.1.1-rc.2`（`defineTool` API 兼容），`pnpm-workspace.yaml` 13 条 `minimumReleaseAgeExclude` 同步；知识图谱验证基线 `PATTERNS_HARNESS_VERSION` 同步更新，消除对最新部署的 `knowledge-version-drift` 误告警。现有 13 个只读工具，`core/` 28 个纯逻辑模块零依赖，22 个自包含套件全部通过。
## 工具（13 个，全部只读；simulate_combination / archive_snapshot 不碰组合本体）

### 分析
| 工具 | 说明 |
| --- | --- |
| `analyze_dependencies` | 组合依赖树 + 共享依赖摘要 + 范围满足性 |
| `check_conflicts` | 版本冲突 / 工具重名（**作用域感知**：per-agent 变体合法）/ 服务覆盖 / 缺失提供者 / 行覆盖 / 泄漏扫描 / **运行期行为校准**（事件流基线） |
| `visualize_plugins` | HTML / Mermaid / ASCII / **dashboard**（workspace 交互仪表盘，10 模块）输出 |
| `simulate_combination` | 假设组合模拟：新增/解除冲突、风险增量、判定 |
| `audit_configuration` | 逐行配置审计（openAt / telemetry mode / 内存路径 / fetch 等） |
| `diff_combinations` | 两个快照（或快照 vs 当前）的行增删改 + 风险增量 |
| `preset_compare` | standard / code / minimal / cordis 预设行集与工具面对比 |
| `verify_rows` | 行级装载预检（包可解析 / dsh.client / client.js 构建）+ **运行期服务探测** |

### 生命周期
| 工具 | 说明 |
| --- | --- |
| `archive_snapshot` | 存档当前组合到 data/history（快照历史） |
| `snapshot_history` | 列出/加载历史快照 |
| `history_stats` | 历史趋势统计（行数/健康度时间序列，仪表盘含趋势面板） |

### 决策支持
| 工具 | 说明 |
| --- | --- |
| `suggest_patch` | 冲突建议 → cordis.patch.yml 补丁文本（只输出，不写盘） |
| `check_upgrades` | npm registry 最新版本检查 + 升级阻断预测（**并发池 + 独立超时 + 镜像自动降级 + 附安装命令**，网络失败单独上报） |

## 架构

三层分离，详见 [ARCHITECTURE.md](./ARCHITECTURE.md)：

```
core/          零依赖分析引擎（28 个模块，Node 内置 API only）
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
src/          cordis 插件壳（src/tools/ 每工具一文件，13 个工具的 schema 定义 + 注册）
ui-plugin/    浏览器端客户端插件（sidebar 入口 + modal 仪表盘）
```

## 插件安装步骤

本插件由两个包组成，均通过 **link 依赖** 持久化装入 dsh profile（symlink 指向源码，改代码即生效）：

- **dsh-forge**（host 插件）：13 个分析工具，在 HOST 平面运行
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
# host 插件（13 个分析工具）
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
  `name` 是包名（从 profile 的 node_modules 解析），`config` 传给插件的 `apply(ctx, config)`。
  patch 层还支持 id 定向的 config 覆盖、disables 与 `!!js` 表达式（见文件顶部注释）。

### 第 4 步：重启 harness

```bash
npx @deepseek-ai/dsh web
```

成功标志：启动日志无 `Cannot find module` / schema 校验（`JsonSchemaError`）报错，服务监听 `http://127.0.0.1:3080`。

### 第 5 步：验证

1. 浏览器打开 `http://127.0.0.1:3080`，控制台无报错
2. 右侧 sidebar 底部出现「▦ 插件仪表盘」按钮（点击弹窗显示仪表盘）
3. 对话中可调用 13 个工具（`analyze_dependencies` / `check_conflicts` / `visualize_plugins` / `simulate_combination` / ...）
4. 离线快速自检（不依赖 harness）：

```bash
cd dsh-forge && node --input-type=module -e "import('./src/index.js').then(m => console.log('plugin import OK:', m.name))"
```

### 开发模式：改动生效机制

| 改动内容 | 生效方式 |
| --- | --- |
| host 插件代码（`core/`、`src/`） | **必须重启 harness**（模块已在进程中缓存，且 `defineTool` 在 apply 时编译 schema） |
| client 插件内容（`ui-plugin/lib/client.js`） | symlink 即时同步，但 manifest / 插件集合变更需重启 |
| 仪表盘内容（`web/`、`reports/dashboard.html`） | `node scripts/generate-dashboard.mjs`（用当前 dashboard.js 重新生成）→ `node scripts/build-ui.mjs`（内嵌进 client.js）→ 重启 |
| 一键挂载（免手工复制） | `node scripts/mount-ui.mjs`（自动探测部署 node_modules 并复制 ui-plugin + 写 patch；支持 `DSH_DEPLOY_NM` / `DSH_FORGE_ROOT` / `DSH_PROFILE_PATCH` 环境变量覆盖） |

### 卸载

```bash
cd "$HOME/.dsh/profiles/web"
npx @deepseek-ai/dsh plugin --profile web remove dsh-forge dsh-forge-ui
```

并从 `cordis.patch.yml` 移除对应两行 insert，重启 harness。

### 组合发现机制（host 插件运行时）

插件运行时从 `$DSH_HOME/profiles/<profile>` 自动发现组合：
profile 根 `cordis.yml` → **bundle 补丁（dsh-base / dsh-web-app，自动定位部署根）** →
`cordis.patch.yml`；包清单与已安装版本从部署 node_modules 读取（无需传 `root`）。
也可传 `compositionSources` / `dataset`（离线快照）/ `root` 覆盖。
## 离线快照

`data/ecosystem.json` 是分析时生成的快照（`format: dsh-forge-ecosystem@1`），
可用 `dataset` 参数复现同一份分析。

## 命令行复现（无插件运行时）

```bash
node --input-type=module -e "
import { runAnalysis } from './core/index.js';
const r = runAnalysis({ profile: 'web' });
console.log(JSON.stringify(r.assessment, null, 1));
"
```

## 独立 CLI：TUI / Web / check 三态（默认 TUI，按需 Web）

`dsh-forge` 提供独立命令行入口（`bin` 指向 `cli/dsh-forge.mjs`），
UI 形态不靠猜测，由 `core/mode.js` 按四层证据决策：

1. **启动入口**（硬判断）：`dsh-forge tui` 强制 TUI；`dsh-forge web|serve` 启动 Web 并打开浏览器；`dsh-forge check|ci` 纯日志/`--json`，无界面。
2. **运行环境**（自动检测）：`stdout.isTTY` + `TERM != dumb` 才进 TUI；检测 `DISPLAY`/`WAYLAND_DISPLAY`/`SESSIONNAME` 桌面会话；无 TTY 但有桌面时自动 Web；端口被占用自动降级 TUI/check。
3. **用户场景**：CI 环境（`CI` 变量）与 `--json` 请求直接走 check，供监控/脚本消费。
4. **数据复杂度**（自适应兜底）：< 10 插件直接 TUI；> 30 插件提示 “建议 `dsh-forge web` 查看交互拓扑”，TUI 内按 `W` 一键切 Web。

```bash
node cli/dsh-forge.mjs               # 自动决策（终端内默认 TUI）
node cli/dsh-forge.mjs tui           # 强制 TUI（W=打开 Web，R=刷新，Q=退出）
node cli/dsh-forge.mjs web           # 强制 Web（--port 3060，--no-open 不自动开浏览器）
node cli/dsh-forge.mjs check --json  # CI/CD 机器输出
```

TUI 与 Web 双壳复用同一套 `core/` 分析引擎；TUI 为零依赖 ANSI 渲染器，
Web 为零依赖 `node:http` + 10 模块交互仪表盘（缺 `web/dashboard-client.js` 时
自动回退到自包含 SVG 拓扑页；不引入 Express/ECharts，保持 core 零依赖与可离线部署）。
Web 形态采用**混合审查**：每次请求用当前分析结果新鲜渲染（静态层），页头提供 `↻ 刷新`
按钮调用 `GET /api/refresh` 清除分析缓存并重新分析（动态层），无需刷新页面即可让仪表盘如实反映组合变更。

## 验证状态

- `dsh web` 正常启动于 http://127.0.0.1:3080，浏览器无报错，**13 个工具**注册成功
- `analyze_dependencies` 真实执行：4 层组合（profile 根 + dsh-base + dsh-web-app + patch），
  138 插件行（含 forge/forge-ui）/ 128 包 / 1226+ 依赖边
- 自动化测试（22 个自包含套件；smoke13 13/13 依赖本机 harness，不入 CI）：
  - `test/ui-test.mjs` — 仪表盘 workspace 结构与交互（77 项，含 v0.1.5 混合架构页/嵌入字段/finding_id 语义与渲染断言，及 v0.1.6 引导页/名词解释/悬停提示/规范标签 + 旧模块引导条/表头详释）
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
    - `test/tools-snapshot-smoke.test.mjs` — 13 工具快照半集成 + output.schema 校验（13 项）
    - `test/composition-strict.test.mjs` — YAML fail-loud + vm 沙箱逃逸回归（8 项，含 inline comment 与 cordis inject 行键）
  - `test/evidence-fusion.test.mjs` — 证据融合引擎（A-1 三态 + A-2 稳定 id + A-3 可行动 + 7 行矩阵 + INV-3 绝不清除，18 项）
  - `test/runtime-calibration.test.mjs` — 运行时校准（A-4 滑窗/基数上限 + INV-2 时序边界 + 可逆性，21 项）
  - `test/truth-source-degradation.test.mjs` — 真相源三态降级（INV-4 置信度上限，12 项）
  - `test/check-report-schema.test.mjs` — P0-3 冻结 check --json 报告 schema 与 gate 门禁（10 项）
  - `test/finding-id-uniqueness.test.mjs` — finding_id 唯一性消重回归（服务/行/包维度区分 + A-2 稳定，6 项）
  - `test/main-path-fusion.test.mjs` — 主默认路径融合接线（runAnalysis 对 conflicts/leaks 调 fuse + 离线 not-executed 基线；finalSeverity/evidenceTag/runtimeState + INV-3，8 项）
  - `test/heuristic-detect.test.mjs` — 启发式检测收敛（句柄捕获感知泄漏 + 已知安全降级 + leak-context + 全部 BARE 规则；动态工具名按包追踪 + 显式扫描局限，16 项）
  - `test/live-cal-unify.test.mjs` — live 校准统一（RUNTIME_LIFECYCLE_EVENTS 事件名契约 + 双通道桥接去重 + 离线诚实降级，12 项）

## 错误反馈体系

- 统一错误码（FORGE-001~014）+ 分级（fatal/error/warning/info）+ 建议 + 来源。
- 仪表盘"错误与反馈"面板；启动预检致命错误输出到终端 stderr（崩溃场景可诊断）。
- check_conflicts 输出 `feedback` 字段。
- 仪表盘入口：sidebar 会话框下方/设置上方（sidebar.footer.action）+ 对话流提示卡片（turnTail）；会话头按钮已移除。

## 评审整改（R0–R5）

第三版项目经理评审的验收标准已逐条落实：dump-config 真相源（R0）、未校准声明 + contract/heuristic 分级（R1）、
harnessVersion 绑定与知识库版本门控（R2）、泄漏扫描（R3）、证据分级 static-suspect/contract-source（R4）。
详见 `reports/PM-remediation.md` 与 `CHANGELOG.md`。

## 已知限制（诚实声明）

| 限制 | 原因 | 缓解 |
| --- | --- | --- |
| truthSource 落在 scan 而非 dump-config | npx 安装树路径与 findDshBin 候选不完全匹配 | 输出 `truthSource=scan` + warnings 显式标注 |
| 静态扫描覆盖率有限 | 仅扫描 `lib/**/*.js`，单文件 >400KB 跳过 | findings 标 `confidence: "low"` + disclaimer |
| 实时仪表盘（host.call 拉取） | harness 仅存在于 cordis 动态插件沙箱，静态插件不可靠注入 | Web 混合审查：静态内嵌 + `/api/refresh` 动态重分析；离线 `generate-dashboard.mjs` → `build-ui.mjs` 重建 |
| 会话事件实时统计 | 静态客户端插件无运行期事件订阅通道 | `history_stats` 快照趋势替代 |

## 目录

- `core/` — 零依赖分析引擎（semver / composition / truth / 图构建 / 冲突 / 模拟 / 可视化 / 知识库 / 校准 / 泄漏 / 升级 / mode 决策）
- `cli/` — 独立 TUI/Web/check 入口（四层证据决策，默认 TUI 按需 Web）
- `src/` — cordis 插件壳（src/tools/ 每工具一文件，13 个工具的 schema 定义 + 注册）
- `ui-plugin/` — 浏览器端客户端插件（sidebar 入口 + modal 仪表盘）
- `web/` — 仪表盘客户端脚本（生成时内嵌进 dashboard.html）
- `prompt/` — 专家 persona 提示词（含风险预测）
- `data/` — 生态快照（`ecosystem.json` versioned；`history/` 运行期生成，gitignored）
- `reports/` — 生成的分析报告与图谱
- `test/` — 自包含测试套件（22 套件 952 项，零本机依赖）
- `scripts/` — 生成与构建脚本（generate-dashboard / build-ui / mount-ui）