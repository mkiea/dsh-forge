## dsh-forge 0.1.15（正式版）

> 版本：0.1.15 · 标签 `v0.1.15-20261027-b509f7c` · 兼容 harnessVersion：0.1.7-rc.2

### 修复 dsh 0.1.7 兼容性（插件 `failed to import`，`dsh web` 无法加载 forge）

harness 升级到 0.1.7 后，`dsh web` 启动日志出现 `forge (dsh-forge): failed to import`，14 个工具全部不可用。原因是插件自带的 `@deepseek-ai/dsh-tools@0.1.1-rc.2` 仍从 `@deepseek-ai/dsh-llm` 导入 `CallId`，而 0.1.7 的 `dsh-llm` 已移除该导出——ESM 链接阶段直接抛 `SyntaxError: The requested module '@deepseek-ai/dsh-llm' does not provide an export named 'CallId'`。

- **依赖升级**（`package.json`）：`@deepseek-ai/dsh-tools` `^0.1.1-rc.2` → `^0.1.7-rc.2`。新版 `dsh-tools` 只从 `dsh-llm` 导入 `HarnessError` / `createUserMessage`，其余能力改走 `dsh-util-values` / `dsh-brand` / `dsh-sandbox`。
- **供应链排除项同步**（`pnpm-workspace.yaml`）：`minimumReleaseAgeExclude` 全部基线升到 `0.1.7-rc.2`（cordis `4.0.5`、schemastery `3.18.5`），并新增 `@deepseek-ai/dsh-util-values@0.1.7-rc.2`；`pnpm-lock.yaml` 同步（Packages +20 −13）。
- **知识图谱版本门控更新**（`core/knowledge.js`）：`PATTERNS_HARNESS_VERSION` `0.1.1-rc.2` → `0.1.7-rc.2`，消除 `knowledge-version-drift` 对新部署的误告警。
- **文档同步**：README / README.en 顶行 `harnessVersion`、ARCHITECTURE「harnessVersion 绑定」同步为 `0.1.7-rc.2`；`plan` 示例版本号同步更新。

### 验证

- 本机 `dsh --version` = `0.1.7-rc.2`；插件内 `dsh-tools` = `0.1.7-rc.2`；`import('./src/index.js')` 正常导出 `Config, apply, inject, name`。
- `dsh web --port 0 --no-open`：`[dsh-forge] ✓ forge 启动成功 · 14 个工具已注册`。
- CI 全守卫回归通过：doc-consistency 18 项全过、26 个自包含套件 0 失败、CLI `check --json` 输出 `version: 0.1.15`。

完整变更见 [CHANGELOG.md](./CHANGELOG.md)。
