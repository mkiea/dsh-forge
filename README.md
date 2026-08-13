# dsh-forge

DeepSeek Harness **插件组合分析**插件：依赖分析、冲突检测、风险评估（含预测）、可视化与组合模拟。

## 工具

| 工具 | 说明 |
| --- | --- |
| `analyze_dependencies` | 组合依赖树 + 共享依赖摘要 + 范围满足性 |
| `check_conflicts` | 版本冲突 / 工具重名 / 服务覆盖 / 缺失提供者 / 行覆盖 |
| `visualize_plugins` | HTML（内联 SVG 图谱）/ Mermaid / ASCII / **dashboard**（交互组件仪表盘）输出 |
| `simulate_combination` | 假设组合模拟：新增/解除冲突、风险增量、判定 |

所有工具**只读**；`simulate_combination` 不落盘。

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
  129 插件行 / 126 包 / 1226 依赖边 / 0 冲突警告
- 自动化测试：`test/ui-test.mjs` 36 项 + `test/ui-plugin-test.mjs` 18 项全部通过
  （结果见 `reports/ui-test-results.md`、`reports/ui-plugin-test-results.md`）

## 目录

- `core/` — 零依赖分析引擎（semver / composition 解析 / 图构建 / 冲突 / 模拟 / 可视化 / 知识库）
- `src/` — cordis 插件壳（四个工具的注册）
- `web/` — 仪表盘客户端脚本（生成时内嵌进 dashboard.html）
- `prompt/` — 专家 persona 提示词（含风险预测）
- `data/` — 生态快照
- `reports/` — 生成的分析报告与图谱（`analysis-report.md`、`deep-verification.md`、`dashboard.html`、`ui-test-results.md`、`plugin-graph.html`、`plugin-graph.mmd`、`dependency-trees.txt`）