# Changelog

## [0.2.0] - 2026-08-14

### 评审整改（R0-R5 验收标准）

- **R0 接地真相**：新增 dump-config 真相源（truthSource: auto|dump-config|scan，默认 auto）：消费 harness 官方 dsh --dump-config 生效组合树（含层溯源 provenance），替代纯源码重建；scan 模式保留并标注可能偏离。
- **R1 校准诚实**：所有风险分/健康度声明 calibrated: false + 未校准免责声明；冲突条目分级 kind: contract|heuristic；移除伪精确表述。
- **R2 版本绑定**：快照记录 harnessVersion（0.1.0-rc.6）；知识库模式声明验证版本，版本漂移输出 knowledge-version-drift 告警。
- **R3 健全性**：新增非可逆副作用泄漏扫描（scanLeaks：裸 setInterval/process.on/addEventListener 注册 vs 清理配对），纳入 check_conflicts 输出。
- **R4 精确性**：冲突条目 evidenceTier: static-suspect|contract-source；工具名扫描扩展动态注册模式并输出 dynamic-registration hint；检测标注为疑似清单而非 harness 实际拒绝确认。
- **R5 可行动**：保留证据链/dashboard/模拟/补丁建议。

### 其他

- semver 支持部分版本号（^1.2 / ~1.2 / 1.x / 1.2.x / 1.2 / 部分比较器）；两份实现一致性测试 30/30（修复内联 prerelease 比较缺陷）。
- 挂载脚本路径 env 化（DSH_HOME / DSH_DEPLOY_NM）。
- CI 模板（.github/workflows/ci.yml）。

## [0.1.0] - 2026-08-13

- 初始版本：4 个分析工具 + 仪表盘 + 快照 + 13 工具扩展（见 README）。
