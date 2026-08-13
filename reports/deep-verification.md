# 深度验证报告（dsh-forge · 第二层取证）

> 目标：把第一轮静态分析的每个信号用**源码级证据**证实或证伪。
> 分析方法：全树版本扫描、插件源码逐段取证、错误码原文核对、语义引擎单元测试、预设差异对比。
> 结论先行：**第一轮的全部风险信号均已被证实为「预期设计」或「低风险」——修正后整体健康度 C → A。**

## 1. 双重实例（dual-instance）风险 —— 全树扫描 [确证] 置信度：高

- 证据：递归扫描部署 node_modules 全部 565 个包目录；`@deepseek-ai` 作用域**每个包全树仅存在一个实例**（含嵌套 node_modules）。
- 结论：插件家族**无双重实例**——不存在"两个同名服务各自注册"的运行时竞态。`cordis@4.0.1`、`cosmokit@1.8.2`、`schemastery@3.18.1` 同样单一实例。
- 唯一双版本包：`chokidar`（顶层 4.0.3 / dsh-skill-filesystem 下嵌套 5.0.0）——两个消费者各取所需，无共享状态，**良性**。

## 2. directory-picker（首轮唯一 high 风险，40 分）—— 机制翻转 [确证] 置信度：高

- 源码取证（`dsh-host-directory-picker-auto/lib/index.js`）：
  - `resolveDirectoryPickerBackend()` 启动时采样 host 事实（bindHost / SSH / 平台 / Linux chooser）解析后端：`native` 或 `browse`；
  - `apply()` 用 `ctx.loader.create({ name })` **运行时动态装载**后端 + 客户端界面两个 Loader 条目；
  - `BACKEND_PACKAGES` / `SURFACE_PACKAGES` 常量指向 4 个变体包——它们**无需写进组合**，只要已安装。
- 修正：本部署 4 个变体包全部已安装（win32 + loopback → 预期解析为 `native` 后端）→ 首轮"4× 未组合 peer"信号为**假阳性**；真实残余风险仅剩"包被裁剪则 `loader.create` 抛错、本行激活失败"。风险分 40 → **10（低）**，报告与仪表盘已带 verified 注记。
- 推论（可用于其他部署）：若裁剪 node_modules，`directory-picker` 行会**整体激活失败**——这是该设计的唯一脆弱点。

## 3. 服务提供者静态扫描 —— 两处假阳性已证伪 [确证] 置信度：高

- `slots`：`dsh-client-runtime/lib/client.js` 中 `super(ctx, 'slots')`（另含 conversationEvents / conversationViews）→ client 平面注册，host 侧扫描不可见 → 首轮唯一 medium 冲突**证伪**。
- `theme` / `locale`：分别由 `dsh-client-ui-theme/lib/client.js`、`dsh-client-locale/lib/client.js` 提供 → 同样为 client 平面。
- `dsh-settings`（基类）确实执行 `super(ctx, 'settings')` → 名称推断方法（provider-indirection 29 条）得到验证。

## 4. 工具注册语义 —— 冲突不会静默 [确证] 置信度：高

- 取证（`dsh-tools/lib/index.js`）：重复注册抛出 `tool "X" is already registered`（**响亮失败**，非覆盖）。
- 推论：0 工具重名 = 0 注册失败；若未来组合引入重名，第二个插件会**整体挂载失败**而非悄悄降级。
- `tool-subagent` 四行模式取证：`toolName = config.toolName ?? "subagent"`（config 驱动动态注册）→ subagent / subagent_fork 两行各注册一个工具名，codex / claude-code 两行禁用不注册，机制自洽。

## 5. 平台与配置类预测 —— 错误码/常量原文核对 [确证] 置信度：高

- `session-query-sqlite`：`openAt: never` 时在请求前抛出 `SESSION_QUERY_SEARCH_DISABLED`（错误码原文）→ 全文搜索禁用行为与首轮描述逐字一致。
- `session-telemetry-otel`：源码含 `forceFlush()` 与 `shutdownTimeoutMillis` → 关闭集流上限 3s 的推断成立。
- `bash-sandbox`/`tool-bash`：`disabled: !!js process.platform === 'win32'` 在本机求值为 true → 无 bash 工具链的结论成立。
- 预设对比：standard/code/cordis 三预设行集几乎一致；`code` 额外挂 `tool-presentation`；`minimal` 是完全不同的持久化 shell 平面（pty/terminal-bash）。

## 6. mini-semver 引擎 —— 29 例 npm 语义测试 [确证] 置信度：高

- 28/29 通过；唯一"失败"用例系**测试期望写错**：npm 语义下 `^0.0.3` **不含** 0.0.4（`>=0.0.3 <0.0.4`），引擎行为正确。
- 覆盖：caret（含 0.x 分支）、tilde、预发布规则（`^0.1.0-rc.6` 满足 rc.7 不满足 rc.5）、`*` 排除预发布、|| 并集、复合比较器。

## 7. 版本清单盘点 [确证] 置信度：高

- 组合内 126 包：124 × `0.1.0-rc.6`（单一基线）+ `cordis-plugin-timer@1.1.3`、`cordis-plugin-hmr@1.0.16`（cordis 生态独立版本号，非漂移）。
- 全树 565 包扫描确认无第二份 `@deepseek-ai/dsh-*`。

## 8. 修正后的最终数字

| 指标 | 第一轮 | 深度验证后 |
| --- | --- | --- |
| 健康度 | C（high 1） | **A**（high 0 · medium 0 · blocking 0） |
| 冲突发现 | 64（含 1 medium） | **63，全部 info**（27 行覆盖 + 29 提供者间接 + 7 禁用行） |
| 版本冲突 / 工具重名 / 服务覆盖 | 0 | 0（且语义已确证：重名会响亮失败） |
| directory-picker | 40 high | **10 low**（verified：运行时动态装载机制） |
| 快照往返保真 | 部分（扫描结论丢失） | **完整**（toolNames/services/nested 已持久化） |

## 9. 仍存在的合理保留

1. `provider-indirection` 29 条为**名称推断**（非运行期注册证据）——推断方法已用 dsh-settings 验证有效，但个别命名异常的服务可能漏判。
2. host/client 平面分离依赖文件路径约定（`lib/client.js`、`lib/types/client*`）——非常规命名会误判。
3. 会话平面以 cordis preset 为例；GUI 实际挂载的 preset 可能不同（standard/code 行集几乎一致，影响极小）。
