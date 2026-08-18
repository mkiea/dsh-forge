# DSH-Forge 静态-运行时混合验证体系（v0.1.5 定稿方案）

- 方案名称：静态-运行时校准 + 三态降级混合验证体系
- 版本：**v0.1.5**（基于 v0.1.4 代码底座；原 v0.2.0 规划，经评审裁剪为本增量发布范围）
- 评审日期：2026-08-18
- 评审方式：staff-engineer-mode / observability-and-alerting 专业评审 + A-1~A-7 调整并入
- 核心增量：运行时事件订阅交叉校验（补齐当前最大短板）
- 目标状态：从纯静态审计升级为静态-运行时混合验证原型
- 作用域：**P0 + P1** 纳入 v0.1.5；P2 默认延后；P3 明确排除

> 说明：本方案基于对 dsh-forge v0.1.4 的深度架构评审提出，保留 core 层零依赖、离线可审计的核心优势，在 src 插件壳层新增运行时事件订阅与证据融合能力，实现「静态初筛 + 运行时校准」闭环。6 条架构设计不变量为演进期不可妥协原则，须写入 ARCHITECTURE.md 并在代码审查中强制检查。

---

## 一、评审结论与调整记录

**结论：方向正确，架构贴合，可演进；但有 5 个直接影响正确性与可验收性的缺口已在定稿中修正。** 尤其「证据融合」若把"没证据"当作"没发生"，会引入一种更难发现的漏检，必须按 A-1 三态化，否则 INV-3「绝不清除」会被架空。

### 已认同并保留的决策

| 点 | 评价 |
|---|---|
| 混合验证哲学（运行时只校准、不判定） | 防止全盘动态的开销与不可复现，保住 core 零依赖红线 |
| INV-3「未观测仅降级、绝不清除」 | 正确且关键，符合保守性原则 |
| truth-source 三态 + scan 最高 medium | 正确、保守的置信度传递 |
| 运行时模块自身可逆性 | 完整对齐 Cordis 可逆效应契约 |
| P3 排除清单 | 全持久化 / 初始化回溯 / vm 对抗不可信输入 / 运行时作主检测源 —— 全部正确 |
| core/src 架构红线 | 与本项目既有约束一致 |

### 定稿并入的调整（A-1~A-7）

| 编号 | 调整 | 影响模块 |
|---|---|---|
| A-1 | 「未观测」三态化为 `not-executed / executed-clean / executed-residual`，禁止把 absence-of-evidence 当 evidence-of-absence | evidence-fusion、快照、仪表盘标签 |
| A-2 | 引入稳定 `finding_id`（作用域+名称+类别+位置哈希）绑定静态 suspect 与运行时证据 | runtime-calibration、evidence-fusion |
| A-3 | 升到 high 告警必须随附可行动指引（`next_action` + 复现句柄） | evidence-fusion 输出 |
| A-4 | 滑动窗口补：窗口大小 N、事件基数上限、超限丢帧策略、明确时序边界 | runtime-calibration |
| A-5 | 运行时套件环境门控（沿用 smoke13 模式，CI 默认 skip、本地显式跑）；检出率/误报率验收依附于可跑真实 Crowd 运行时的对照实验 harness，属 P1 里程碑，非 P0 标准 | 测试与验收 |
| A-6 | 版本统一 v0.1.5；作用域裁剪为 P0+P1，P2 延后，P3 排除 | 全方案 |
| A-7 | vm 加固如实承诺：超时可原生，全局冻结/原型隔离为近似加固，内存限制非 node:vm 原生能力、改为尽力近似并标注边界 | 安全设计 |

> 注：A-1~A-7 为内部评审编号，与下文正式章节（第三、四、五节）内容一致。

---

## 二、现状诊断与演进目标

### 2.1 现状（v0.1.4）与核心短板

v0.1.4 已实现 13 项分析工具、22 模块零依赖核心引擎、四层证据决策 CLI、workspace 仪表盘与 832 项测试矩阵。当前最大痛点：**静态扫描产出大量可疑项，但无法区分哪些会在运行时真实爆发，哪些只是代码模式误报。**

| 短板 | 表现 | 影响 |
|---|---|---|
| 静态误报 | scanLeaks 对 bare-registration 的 heuristic 不可收敛 | 大量 medium 级告警 → 开发者告警疲劳，难以 prioritization |
| 运行时盲区 | 插件初始化、事件订阅生命周期、跨作用域副作用溢出无观测 | 漏检真实泄漏路径 |
| 证据置信度不可验证 | static-suspect 与 contract-source 之间缺运行时交叉校验 | 高置信结果可能实际不可复现 |
| 快照无行为基线 | archive_snapshot 仅保存静态配置，不含运行时行为 | 历史回溯无法验证"当时是否真泄漏" |

### 2.2 v0.1.5 演进目标

| 目标维度 | 具体指标 | 验证方式 |
|---|---|---|
| 高检出 | 运行时真实泄漏路径检出率 >= 90% | 对照实验：注入已知泄漏，观测检出率（P1 harness） |
| 可控误报 | 静态告警经运行时校准后误报率 <= 15% | 人工标注 + 运行时观测交叉验证（P1 harness） |
| 零外部配置依赖 | truth-source 三态降级无需用户手动配置 | 删除 dump-config，验证自动回退（CI 可跑） |
| 离线可审计 | core 层仍可在无 Cordis 运行时环境独立执行完整分析 | 纯 Node.js 环境运行 core 测试（CI 常驻） |
| 证据可追溯 | 每条告警附证据来源标签 + 运行时观测样本（如有） | 快照格式校验 + 仪表盘展示 |

> A-5：前两项（检出率/误报率）属运行时对照实验指标，**仅在具备真实 Crowd 运行时的 P1 集成 harness 上测量**，不作为 P0 完成标准。

---

## 三、总体架构设计

### 3.1 设计哲学：混合验证而非全盘动态

核心定位：**运行时做校准，不做全权判定。** 静态层负责配置树还原、依赖 DAG、冲突初筛、源码副作用可疑模式扫描；运行时校准层对静态结果复核、升降告警等级，而非作为主检测源。候选风险集由静态给出，事件流用来确认"该风险是否在运行时真实发生"。

### 3.2 分层架构（严格边界）

| 层级 | 职责 | 输入 | 输出 | 关键约束 |
|---|---|---|---|---|
| core/ | 静态分析引擎：配置树还原、依赖图、冲突初筛、泄漏扫描、风险评估 | 配置快照 / 源码 / 生态数据 | 风险候选集 + 置信度标记 | **零依赖、离线可运行，不引入任何 Cordis API** |
| src/ | Cordis 插件壳：事件订阅、行为基线采集、证据融合 | core 分析结果 + Cordis 运行时事件 | 融合后的最终告警集 + 证据标签 | 运行时代码仅限此层，调用 core 作为纯函数 |
| ui-plugin/ + web/ | 仪表盘展示证据来源、运行时观测状态、历史趋势 | 融合后的告警集 + 快照数据 | 可视化报告 + 交互式探索 | 只读展示，不修改分析逻辑 |
| cli/ | TUI/Web/check 三态入口，支持离线/在线 | 用户指令 + 环境检测 | 分析报告 / 仪表盘 / CI JSON | 四层证据决策引擎保持不变 |

**架构红线：core/ 保持离线零依赖，所有运行时观测逻辑放在 src 插件壳层，作为外部证据输入，不污染 core。**

### 3.3 数据流与证据融合

`静态初筛 → 运行时校准 → 证据融合 → 输出`

| 阶段 | 处理模块 | 数据转换 | 关键决策 |
|---|---|---|---|
| 静态初筛 | core/analyze.js + core/conflicts.js + core/leaks.js | 原始配置 → 风险候选集（含 evidenceTier + finding_id） | 生成 static-suspect / contract-source 分级结果 |
| 运行时采集 | src/runtime-calibration.js | Cordis 事件流 → 行为基线统计（滑动窗口，不存全量日志） | 窗口采样，不持久化事件日志 |
| 交叉校验 | src/evidence-fusion.js | 风险候选集 + 行为基线 → 融合告警集 | **A-1 三态观测**：运行时确认→升级；未执行→`not-executed`；执行干净→`executed-clean`；残留→`executed-residual` |
| 输出沉淀 | core/snapshot.js（扩展） | 融合结果 + 基线样本 → 扩展快照格式 | 支持历史回溯与复现审计 |

---

## 四、核心模块设计

### 4.1 真相源三态降级（truth.js 扩展）

在 auto/dump-config/scan 三态基础上，全链路传递置信度元数据：

| 模式 | 触发条件 | 置信度上限 | 下游影响 |
|---|---|---|---|
| dump-config | DSH CLI 可用且成功 dump-config | high | 所有下游分析可输出 high |
| auto | dump-config 失败自动回退 scan | medium | 全局降级，最大输出 medium |
| scan | 显式指定或自动回退源码扫描 | medium | 组合树为静态推测重建，结果全部标推测性 |

**约束：scan 模式所有检测结果默认置信度最高为 medium，不得输出 high；代码必须显式传递置信度元数据，禁止在降级后输出虚假高可靠结果。**

### 4.2 运行时校准模块（src/runtime-calibration.js，新增）

v0.1.5 核心增量，负责订阅 Cordis 生命周期事件、采集行为基线、生成运行时证据。

| 设计点 | 实现要求 | 风险规避 |
|---|---|---|
| 事件订阅范围 | toolbar/call、tool/result、turn/end、plugin/apply、plugin/dispose | 不订阅全量事件，只关注与冲突/泄漏相关生命周期 |
| A-4 滑动窗口预算 | 窗口大小 N、事件基数上限、超限丢帧策略（统计计数优先、慢速样本降采样） | 防内存暴涨 + 明确窗口语义 |
| **A-2 关联键** | 每条静态 finding 生成稳定 `finding_id`（作用域+名称+类别+位置哈希），标记事件归属 | 保证静态↔运行时证据可一一绑定，融合不张冠李戴 |
| 生命周期 | 所有绑定监听器绑定 dsh-forge 自身 fiber，uninstall 时全部 off | 防止 dsh-forge 自身泄漏 |
| 启动时序边界 | 仅观测 dsh-forge 加载之后的行为，不回溯初始化阶段事件 | 防止虚假承诺（≡ INV-2） |
| 观测即干扰 | 订阅行为只读，不修改原始事件流 | 避免 Heisenbug 效应 |

### 4.3 证据融合引擎（src/evidence-fusion.js，新增）

融合静态结果与运行时观测，生成最终告警集。**核心原则：运行时未观测到风险仅降低等级，绝不清除告警。**

**A-1 未观测三态：**
- `not-executed`：窗口期内该作用域/插件从未进入激活路径（无观测价值，标注"待运行时确认"）。**与"执行且干净"严格区分——absence of evidence ≠ evidence of absence。**
- `executed-clean`：已激活且卸载后无残留副作用（可确认安全）。
- `executed-residual`：已激活且观测到残留副作用（运行时确认复现）。

融合规则矩阵（含三态与 A-3 可行动指引）：

| 静态结果 | 运行时证据 | 融合动作 | 最终证据标签 | 输出附带 |
|---|---|---|---|---|
| high + static-suspect | executed-residual | 保持 high | static-suspect → runtime-confirmed | next_action + 复现句柄（A-3） |
| high + static-suspect | executed-clean | 降级 medium | static-suspect + executed-clean | — |
| high + static-suspect | not-executed | 保留 high(待确认) | static-suspect + not-executed | 提示"需运行时复现确认" |
| medium + heuristic | executed-residual | 升级 high | heuristic → runtime-confirmed | next_action + 复现句柄 |
| medium + heuristic | executed-clean | 降级 low | heuristic + executed-clean | — |
| medium + heuristic | not-executed | 保持 medium | heuristic + not-executed | 待确认提示 |
| low + contract-source | 任一 | 保持 low | contract-source（不升级） | — |

**关键反模式（禁止）：静态报风险、运行时没看到、直接消除告警。会引入新漏检，违反保守性原则。**

**A-3 可行动性：** 凡升级或确认为 `runtime-confirmed` 的 high 告警，必须随附 `next_action`（如"检查 pluginX 的 ctx.on 是否在 dispose 中 off"）与复现句柄，TUI/Web 可直接引导开发者操作。

### 4.4 作用域感知冲突检测（scope.js 扩展）

在现有 global / per-agent 判定基础上，叠加副作用跨域泄漏检测：

| 检测维度 | 静态分析 | 运行时校准 | 融合输出 |
|---|---|---|---|
| 命名冲突 | 工具/服务名在 global 作用域重复 | 观测实际激活路径是否同时加载 | global-confirmed / global-suspect |
| 版本冲突 | 同一依赖多版本共存 | 观测实际加载版本 | version-conflict-confirmed / -suspect |
| 跨域泄漏 | per-agent 插件 bare-registration 溢出到 global | 观测事件是否跨作用域传播 | scope-leak-confirmed / -suspect |
| 服务覆盖 | 后加载插件覆盖先加载服务 | 观测服务注册/注销时序 | service-override-confirmed / -suspect |

### 4.5 泄漏扫描增强（leaks.js 扩展）

强制输出置信度元数据，并与运行时校准联动：

| 扫描结果 | 置信度 | 运行时校准动作 | 最终输出 |
|---|---|---|---|
| apply 路径裸注册 | low（heuristic） | 卸载后是否残留监听器/定时器：残留→升级 high；干净→保持 low | runtime-confirmed / executed-clean |
| 非 apply 路径裸注册 | low（不在激活路径） | 不触发校准（非责任面） | info 级 |
| KNOWN_SAFE_TIMER_PACKAGES | high（contract-source） | 跳过校准（已核实设计） | info 级 |

**INV-6 联动：** 所有 findings 强制携带 `confidence` 与 `evidence` 字段，无默认值。

---

## 五、安全与鲁棒性设计

### 5.1 node:vm 沙箱加固（A-7 如实承诺）

在 v0.1.4 已完成 `evalJsExpr` → node:vm 迁移基础上进一步加固：

| 加固项 | 实现方式 | 能力边界（如实声明） |
|---|---|---|
| 超时限制 | vm 脚本设置最大运行时间（如 5s） | **可原生实现**，防无限循环/拒绝服务 |
| 全局对象冻结 | 冻结 process、require、globalThis 等危险内置 | **近似加固**，提升可控配置场景安全性 |
| 原型链隔离 | 无原型对象作为 vm 全局对象 | **近似加固**，降低 intrinsics 攻击面 |
| 内存限制 | 限制 vm 上下文可分配内存 | **非 node:vm 原生能力**，仅尽力近似（包裹/realm）；如需完全可靠需进程级隔离——不承诺 |

**安全边界声明（写入文档）：vm 加固仅提升可信配置场景安全性，不用于处理不受信任外部输入。不能把加固后的 vm 当成对抗恶意不受信任输入的安全边界。（≡ INV-5）**

### 5.2 YAML 严格解析（fail-loud）

延续 v0.1.4 策略：拒绝静默容错。任何解析错误立即中断分析，输出结构化 FORGE 错误码，而非基于不完整数据继续分析。

### 5.3 运行时模块自身可逆性

dsh-forge 自身作为 Cordis 插件，必须遵守可逆副作用契约，uninstall 时清理全部句柄：

| 资源类型 | 注册方式 | 清理方式 | 验证方法 |
|---|---|---|---|
| 事件监听器 | ctx.on(event, handler) | ctx.off(event, handler) / dispose | uninstall 后检查 emitter 监听器数量 |
| 定时器 | ctx.setTimeout / ctx.setInterval | 随 ctx 生命周期自动清理 | 依赖 Cordis 内置可逆机制 |
| 服务注册 | ctx.service(name, impl) | 随 ctx 生命周期注销 | 依赖 Cordis 内置可逆机制 |
| 内存缓存 | runAnalysis 结果缓存 | clearAnalysisCache() 在 uninstall 时调用 | 显式清理 |

---

## 六、落地路线图（P0 + P1 定稿）

### 6.1 P0：基础加固（纯 core，可入 CI，风险最低）

| 任务 | 现状 | 完成标准 |
|---|---|---|
| truth-source 三态降级 | truth.js auto/dump-config/scan | 全链路传递置信度元数据，scan 模式全局降级 |
| core 层 YAML fail-loud | v0.1.4 已迁移严格解析 | 所有解析错误输出 FORGE 结构化错误码，不静默跳过 |
| node:vm 上下文加固 | v0.1.4 已完成 vm 迁移 | 冻结危险全局对象 + 超时限制（原生）；内存限制尽力近似 |
| 作用域感知冲突分级 | v0.1.1 scope.js | 覆盖所有冲突类型（global/per-agent/跨域/服务覆盖） |
| scanLeaks 置信度标记 | core/leaks.js | 所有 findings 强制携带 confidence 字段，无默认值 |

### 6.2 P1：核心新增能力（运行时 + 条件化测试，v0.1.5 核心价值）

| 任务 | 设计要点 | 完成标准 |
|---|---|---|
| src/runtime-calibration.js | 滑动窗口（A-4）+ finding_id 关联（A-2），绑定自身 fiber 生命周期 | 订阅事件、生成行为基线，无内存泄漏、无 Heisenbug |
| src/evidence-fusion.js | 静态结果 + 运行时证据 → 融合告警集（A-1 三态 / A-3 可行动 / 只降不清除） | 覆盖表 7 全部组合，含 uninstall 后无泄漏边界 |
| scanLeaks 运行时联动 | 观测插件卸载后是否残留副作用 | 校准结果回流，运行时确认/降级可追溯 |
| 快照格式扩展 | 可选存入运行时观测基线样本 | 向后兼容，支持历史回溯 |
| 测试套件补充 | 运行时校准 + 证据融合 + 跨域泄漏 + 自可逆 + 降级 | 逻辑套件入 CI；运行时套件 env-gated（A-5） |

### 6.3 明确排除（P2 延后 / P3 不采纳）

- **P2（产品化，默认延后）**：仪表盘证据来源展示、历史趋势增强、CI 集成扩展。
- **P3（不采纳）**：全事件持久化、插件初始化阶段事件回溯、vm 沙箱对抗不可信输入、运行时校准作为主检测源。

---

## 七、架构设计不变量（Design Invariants）

必须写入 ARCHITECTURE.md，并在代码审查中强制检查：

| 编号 | 不变量 | 违反后果 | 验证方式 |
|---|---|---|---|
| INV-1 | core 层保持离线零依赖，运行时观测逻辑只在 src 插件壳层 | core 无法独立运行，离线审计能力丧失 | CI：纯 Node.js 环境运行 core 测试套件 |
| INV-2 | 运行时校准只观测 dsh-forge 加载之后的事件，不回溯初始化 | 虚假承诺导致漏检，用户信任崩塌 | 文档显式声明 + 测试验证启动时序边界 |
| INV-3 | 运行时未观测到风险仅降级、绝不清除（且未观测三态化，absence≠evidence-of-absence） | 引入新漏检，违反保守性原则 | 单元测试覆盖全部融合降级 + 三态边界（A-1） |
| INV-4 | 真相源降级到 scan 后全局降低置信度上限 | 输出虚假高可靠结果，误导自动化决策 | 自动化测试：scan 模式输出校验 |
| INV-5 | vm 加固仅提升可信配置场景安全性，不用于对抗不可信输入 | 安全边界被突破，代码注入风险 | 安全文档声明 + 威胁模型评审 |
| INV-6 | 所有静态扫描输出必须携带置信度元数据（confidence/evidence），区分推测来源与事实证据 | 证据不可追溯，无法区分误报与真实风险 | Schema 校验：所有 findings 必须含 confidence 字段 |

---

## 八、测试与验收标准

### 8.1 新增测试套件

| 套件 | 项数 | 覆盖范围 | 通过标准 | CI 归属 |
|---|---|---|---|---|
| runtime-calibration.test.mjs | 20 | 事件订阅、滑动窗口、findi_id 关联、生命周期绑定 | 全部通过，无内存泄漏 | **env-gated（A-5）** |
| evidence-fusion.test.mjs | 25 | 融合规则矩阵、三态降级、不清除原则 | 全部通过，边界覆盖 | 逻辑套件 → CI |
| scope-leak-cross.test.mjs | 15 | 跨作用域副作用传播、per-agent → global 泄漏 | 全部通过 | env-gated |
| truth-source-degradation.test.mjs | 12 | 三态降级、置信度传递、scan 全局降级 | 全部通过 | → CI |
| vm-hardening.test.mjs | 10 | 全局冻结、原型隔离、超时触发 | 全部通过 | → CI |
| self-reversibility.test.mjs | 10 | dsh-forge 自身 uninstall 后无残留 | 全部通过 | 逻辑 + env-gated |

**A-5 环境门控：** 运行时相关套件复用项目 smoke13 模式——纯 Node 无 Cordis 运行时则 skip（带清晰提示），CI 不影响核心绿；本地显式执行验证。融合/降级/vm/truth 等纯逻辑套件进入 CI 常驻门禁。

### 8.2 验收指标

| 指标 | 目标值 | 测量方法 | 归属 |
|---|---|---|---|
| 运行时真实泄漏检出率 | >= 90% | 注入已知泄漏对照实验（需真实 Crowd 运行时 harness） | P1 里程碑 |
| 静态告警校准后误报率 | <= 15% | 人工标注 + 运行时观测交叉验证（harness） | P1 里程碑 |
| core 层离线可运行性 | 100% | 无 Cordis 运行时执行 core 测试 | CI 常驻 |
| dsh-forge 卸载后残留 | 0 | uninstall 后检查全局监听器/定时器数量 | 逻辑套件 → CI |
| scan 模式最大置信度 | medium | 自动化 schema 校验 | CI 常驻 |
| 证据标签覆盖率 | 100% | 所有 findings 必须含 confidence/evidence 字段 | CI 常驻 |

---

## 九、时间线与里程碑（v0.1.5）

| 阶段 | 顺序 | 交付物 | 里程碑 |
|---|---|---|---|
| P0 基础加固 | 先行 | truth.js 扩展、YAML fail-loud、vm 加固、作用域冲突、scanLeaks 置信度；core 零依赖不变量通过 CI | core 层不变量绿 |
| P1 核心增量 | 其后 | runtime-calibration.js、evidence-fusion.js、scanLeaks 联动、快照扩展、条件化测试套件 | 运行时校准 + 证据融合通过集成测试 |
| 验收与发布 | 收尾 | 文档更新（ARCHITECTURE 纳入 6 条不变量）、v0.1.5 发布 | 逻辑指标达标 |

> 与论文发表衔接：形式化定义素材来源于融合规则矩阵与置信度传递；对照实验数据取自 P1 harness 的检出率/误报率前后对比；core 零依赖设计支撑跨框架（如 Koishi）移植；完整代码 + 测试套件 + 数据集作为 Artifact 随 v0.1.5 发布。

---

## 附录

### A.1 术语表

| 术语 | 定义 |
|---|---|
| 静态分析 | 不执行代码，通过解析配置和源码推导风险 |
| 运行时校准 | 程序执行中观测行为，对静态结果复核 |
| 证据融合 | 多源证据（静态 + 运行时）合并生成最终判断 |
| 证据分级 | contract-source / static-suspect / heuristic / runtime-probe |
| 未观测三态 | not-executed / executed-clean / executed-residual（A-1） |
| 可逆效应 | Cordis 核心机制：上下文变换携带显式逆函数，卸载自动撤销 |
| 反应式余效应 | Cordis 组件声明依赖需求，运行时按可用性调度 |
| 时空可组合性 | Cordis 论文范式：空间隔离 + 时间可逆的组合安全 |
| 真相源 | dump-config / auto / scan |
| 架构不变量 | 演进过程不可妥协的设计约束（INV-1~INV-6） |

### A.2 参考文档

| 文档 | 位置 | 说明 |
|---|---|---|
| Cordis 论文 | arXiv:2508.09153 | A Programming Paradigm for Spatiotemporal Composability |
| dsh-forge README | 仓库根目录 | overview 与安装指南 |
| ARCHITECTURE.md | 仓库根目录 | 现有架构文档（需更新纳入 INV-1~INV-6） |
| PM-remediation.md | reports/ | 五轮评审整改记录 |
| runtime-verification-checklist.md | reports/ | 运行时验证盲区清单 |
| 本方案 | reports/master-plan-v0.1.5.md | v0.1.5 演进入口 |

— v0.1.5 方案计划定稿（结束）—