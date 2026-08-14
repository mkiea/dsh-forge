# Changelog

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
core/          零依赖分析引擎（20 个模块，仅 Node 内置 API）
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