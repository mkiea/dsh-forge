# Changelog

## [0.1.3] - 2026-08-14

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

## [0.1.0] - 2026-08-13

- 初始版本：4 个分析工具 + 仪表盘 + 快照 + 13 工具扩展（见 README）。