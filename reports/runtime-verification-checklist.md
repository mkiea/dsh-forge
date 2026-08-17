# dsh-forge 运行时沙箱验证清单

> 定位：dsh-forge 是**配置合规性检查器**，不是运行时稳定性预言机。
> 本清单覆盖静态分析无法触及的四类风险：热插拔生命周期、事件流竞态、
> Capability Seam、Agent Loop 替换。每个检查都给出前置条件 / 步骤 /
> 观测点 / 通过标准 / 失败签名，便于在 DSH“创造模式”或测试 harness 中执行，
> 并可回填为 dsh-forge `core/knowledge.js` 的 `runtimeVerified` / FORGE 反馈条目。

## A. 热插拔与生命周期（时间可组合性）

| # | 检查 | 前置 | 步骤 | 观测点 | 通过 | 失败签名 |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | apply/dispose 幂等 | 自定义 host 插件 | 循环 apply→dispose 10 次 | `ctx.$` 服务注册表、进程监听器、定时器计数 | 计数回到基线 | 注册表/监听器/定时器单调增长 |
| A2 | 异步任务可中止 | 含 fetch/WebSocket/child_process 的插件 | apply 后立即 dispose，观测任务状态 | 连接关闭、子进程 exit、fetch AbortController 触发 | 无悬挂句柄 | 任务在 dispose 后仍产出回调 |
| A3 | ctx 可逆机制 | 插件用 `ctx.effect/ctx.on/ctx.setInterval` | apply→dispose，检查回调 | disposer 被调用 | 副作用随卸载回滚 | 回调在 dispose 后仍触发 |
| A4 | HMR/fiber unload | 组合含 `cordis-plugin-hmr` | 修改被监听插件源码触发热更新 | HMR 事件、旧 fiber 的 disposer | 旧 fiber 零残留 | 旧定时器/监听器存活 |
| A5 | 启动失败回滚 | 插件 apply 中途 throw | 装载该插件 | harness 启动日志 + 后续服务可用性 | 失败插件不拖垮整个组合 | 半注册服务/半启动状态残留 |

## B. 事件流与竞态（隐式协作暗线）

| # | 检查 | 前置 | 步骤 | 观测点 | 通过 | 失败签名 |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | 事件类型契约 | 使用 `ctx.on("session/event")` 的插件 | 注入 tool/call、tool/result、turn/end 事件 | 已知事件类型清单（dsh-session known-event-types） | 监听事件全部存在且语义匹配 | 监听不存在/拼写错误的事件，处理器永不触发 |
| B2 | Waterfall/Parallel/Serial 顺序 | 两个以上监听同一事件的插件 | 调换组合行顺序运行两次 | 事件执行顺序、返回值 | 功能输出不依赖顺序 | 结果随顺序改变 |
| B3 | 事件处理器异常 | 监听关键事件的插件 | 处理器 throw / 返回 rejected Promise | 事件链后续处理器、会话是否中断 | 异常被隔离，其他处理器继续 | 单插件异常杀死整条事件链 |
| B4 | 事件监听泄漏 | 插件在 apply 中裸 `ctx.on` 无 disposer | apply→dispose 后触发事件 | 处理器是否仍被调用 | 不再调用 | 幽灵处理器继续响应 |
| B5 | 事件风暴/重入 | 插件在事件处理器内再次触发同类事件 | 单次会话轮转 | 事件计数、递归深度 | 有界或受保护 | 无限递归/指数级事件数 |

## C. Capability Seam（能力缝隙）

| # | 检查 | 前置 | 步骤 | 观测点 | 通过 | 失败签名 |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | Provider 替换矩阵 | 每个 seam（llm/fs/sandbox/subagents/sessionQuery/credentials…）默认 provider | 逐 seam 替换为自定义 provider 再回滚 | 相关工具/会话功能 | 行为符合自定义实现 | 功能静默走旧 provider 或报错 |
| C2 | Provider 缺失 | 组合移除 seam provider 行 | 调用依赖该 seam 的工具 | 启动日志/调用错误 | 缺失被显式拒绝或明确降级 | 静默功能缺失 |
| C3 | 跨 seam 隐式契约 | 自定义 tool 插件 + sandbox/fs/credentials 组合 | 更换 sandbox 实现（路径/策略不同） | tool 的读写路径、凭证访问 | tool 不依赖未声明的实现细节 | 路径硬编码/凭证格式假设导致失败 |
| C4 | 重复 provider | 两个包 provide 同一服务名 | 同作用域装载 | Cordis 注册结果（拒绝/覆盖） | 行为与 dsh-forge 的 contract 判定一致 | 后注册静默覆盖先注册 |
| C5 | 最小行为探针 | 每个 seam | 调用 seam 的最小公开操作 | 返回结构/错误码 | 与默认 provider 契约一致 | 返回结构漂移但无报错 |

## D. Agent Loop 替换

| # | 检查 | 前置 | 步骤 | 观测点 | 通过 | 失败签名 |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | 消息流契约 | 自定义 loop 插件 | 一次完整 turn | 事件序列 tool/call→tool/result→turn/end | 序列完整、顺序正确 | 缺 turn/end 或 result 早到 |
| D2 | step/turn 状态迁移 | 自定义 loop | 多次工具调用轮转 | step 计数、turn 边界、compaction 触发 | 状态机与默认 loop 等价 | 状态卡死/跨 turn 泄漏 |
| D3 | 错误与中断传播 | 自定义 loop | 工具失败/用户中断/subagent 退出 | 错误事件、恢复或终止路径 | 传播路径清晰且可恢复 | 错误被吞或循环挂起 |
| D4 | 插件握手 | 自定义 loop + goal/plan/compaction | 触发 goal 切换、plan 更新、压缩 | 这些插件是否收到预期事件 | 握手成立 | 静默失联（插件空转） |

## E. 证据采集规范（回填 dsh-forge）

每条验证结果按以下字段记录，便于写入 `core/knowledge.js` 的
`runtimeVerified`（源码级实证）或生成 FORGE 反馈：

```yaml
check: A2
plugin: <package@version>
harnessVersion: <dsh version>
combination: <cordis.patch.yml 片段或快照路径>
steps: <实际执行步骤>
observed: <事件/日志/计数证据>
passed: true|false
signature: <通过或失败签名>
confidence: high|medium|low
```

回填建议：

- `passed: true` → `runtimeVerified` 增加条目，并给出 `scoreDelta` 修正；
- `passed: false` → 按 severity 生成 FORGE 反馈，并写入知识库为已知模式；
- 不确定 → 保留 `confidence: low`，在报告中标注“需运行期复验”。
