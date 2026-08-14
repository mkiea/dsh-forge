# dsh-forge

DeepSeek Harness **插件组合分析**插件：依赖分析、冲突检测、风险评估（含预测）、可视化与组合模拟。

## 工具（13 个，全部只读；simulate_combination / archive_snapshot 不碰组合本体）

### 分析
| 工具 | 说明 |
| --- | --- |
| `analyze_dependencies` | 组合依赖树 + 共享依赖摘要 + 范围满足性 |
| `check_conflicts` | 版本冲突 / 工具重名 / 服务覆盖 / 缺失提供者 / 行覆盖 |
| `visualize_plugins` | HTML / Mermaid / ASCII / **dashboard**（交互仪表盘）输出 |
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
| `check_upgrades` | npm registry 最新版本检查 + 升级阻断预测（网络失败优雅降级） |

## 挂载（当前状态：已挂载并验证）

通过 `dsh plugin` 以 `link:` 依赖装入 `$DSH_HOME/profiles/web/node_modules`
（symlink 指向本工作区，改代码即生效），并在 `$DSH_HOME/profiles/web/cordis.patch.yml`
加入两行 insert：

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

- **host 插件**（dsh-forge）：四个分析工具，HOST 平面运行。
- **client 插件**（dsh-forge-ui）：GUI 右侧 sidebar 底部「▦ 插件仪表盘」入口，点击弹窗显示 `reports/dashboard.html`（iframe 内嵌）。

插件运行时从 `$DSH_HOME/profiles/<profile>` 自动发现组合：
profile 根 `cordis.yml` → **bundle 补丁（dsh-base / dsh-web-app，自动定位部署根）** →
`cordis.patch.yml`；包清单与已安装版本从部署 node_modules 读取（无需传 `root`）。
也可传 `compositionSources` / `dataset`（离线快照）/ `root` 覆盖。

> 注意：host 插件代码（core/）更新后需**重启 harness** 才生效（模块已在进程中缓存）；
> client 插件内容（ui-plugin/lib/client.js）经 symlink 即时同步，但 manifest 变更同样需重启。

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

## Harness 右侧入口（已挂载）

`ui-plugin/` 是浏览器端客户端插件：在 GUI 右侧 sidebar 底部注入「插件仪表盘」按钮，
点击以弹窗（modal + iframe）显示 `reports/dashboard.html`。

- 已挂载到：部署 node_modules/dsh-forge-ui + `$DSH_HOME/profiles/web/cordis.patch.yml`（行 `forge-ui`）
- **重启 harness 后生效**（客户端插件集合变更需重启；内容更新只需重新构建并重启）
- 更新仪表盘内容：`node scripts/build-ui.mjs`（重新内嵌 dashboard.html 到 client.js）→ 复制 lib/client.js 到部署目录 → 重启

## 验证状态

- `dsh web` 正常启动于 http://127.0.0.1:3080，浏览器无报错，4 个工具注册成功
- `analyze_dependencies` 真实执行：4 层组合（profile 根 + dsh-base + dsh-web-app + patch），
  138 插件行（含 forge/forge-ui）/ 128 包 / 1226+ 依赖边 / 0 冲突警告
- 自动化测试：`test/ui-test.mjs` 36 项 + `test/ui-plugin-test.mjs` 22 项全部通过
  （结果见 `reports/ui-test-results.md`、`reports/ui-plugin-test-results.md`）

## 未实现项（受静态插件数据通路限制）

| 功能 | 原因 | 替代方案 |
| --- | --- | --- |
| 实时仪表盘（host.call 拉取） | `harness` 仅存在于 cordis 动态插件沙箱（Builtin），静态插件不可靠注入 | 静态内嵌 + `node scripts/build-ui.mjs` 重建（symlink 即同步，重启生效） |
| 工具调用专属卡片（tool.call.toolview） | 替换产品默认卡片，契约（ToolCallOwnerProps）未公开，替换有 UI 回归风险 | 保持默认卡片 + 对话流 turnTail 引导卡片 |
| 会话事件实时统计 | 静态客户端插件无运行期事件订阅通道 | `history_stats` 快照趋势替代 |

## 目录

- `core/` — 零依赖分析引擎（semver / composition 解析 / 图构建 / 冲突 / 模拟 / 可视化 / 知识库）
- `src/` — cordis 插件壳（四个工具的注册）
- `web/` — 仪表盘客户端脚本（生成时内嵌进 dashboard.html）
- `prompt/` — 专家 persona 提示词（含风险预测）
- `data/` — 生态快照
- `reports/` — 生成的分析报告与图谱（`analysis-report.md`、`deep-verification.md`、`dashboard.html`、`ui-test-results.md`、`plugin-graph.html`、`plugin-graph.mmd`、`dependency-trees.txt`）