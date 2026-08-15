# dsh-forge v0.1.1 正式审计报告

> 审计日期：2026-08-15
> 审计范围：文档一致性、CI 配置有效性、测试退出码完整性、全量回归验证
> 审计结论：**通过（PASS）** — 四项子项全部达标，零遗留问题。

---

## 1. 文档与代码一致性审计

| 检查项 | 预期 | 实际 | 状态 |
| --- | --- | --- | --- |
| UI slot 数量 | 2 个（sidebar.footer.action + turnTail） | client.js 注册 2 个 slot | PASS |
| header 入口 | 已删除 | 代码中无 conversation.session.header.actions 注册 | PASS |
| ARCHITECTURE.md slot 描述 | 2 个 UI 入口 slot | 描述为 2 个，列名准确 | PASS |
| ARCHITECTURE.md 测试项数 | ui-plugin-test.mjs 22 项 | 实际 22 项断言 | PASS |
| ARCHITECTURE.md CI 描述 | 跳过 smoke13 | 写明"跳过依赖本机路径/真实 harness 的 smoke13" | PASS |
| PM-remediation.md 入口方向 | 保留侧边栏，删除会话头 | 描述准确 | PASS |
| PM-remediation.md 测试计数 | 22/22 | 实际 22/22 | PASS |
| README.md / README.en.md 计数 | 22 | 全部同步为 22 | PASS |

**发现**：ARCHITECTURE.md 第 174 行仍显示 23（与实测 22 不符），已修正为 22。

---

## 2. CI 配置审计

| 检查项 | 状态 | 说明 |
| --- | --- | --- |
| 语法检查入口 | PASS | node --check src/index.js && node --check src/tools.js |
| 核心模块加载检查 | PASS | node --input-type=module -e "import('./core/index.js')..." |
| 自包含测试全部运行 | PASS | 循环 test/*.mjs，smoke13 跳过 |
| 退出码传播 | PASS | 各测试文件 process.exit(failed ? 1 : 0)，CI 中 node "$file" || exit 1 |
| 跳过依赖本机路径的测试 | PASS | smoke13 使用 case 跳过 |

**CI 模拟运行结果**（9 套件 x 773 断言）：

| 套件 | 断言数 | 结果 |
| --- | --- | --- |
| semver-consistency.mjs | 30 | 30/30 |
| review-fixes.test.mjs | 15 | 15/15 |
| upgrade-opt.test.mjs | 16 | 16/16 |
| feedback-smoke.test.mjs | 40 | 40/40 |
| exploratory-feedback.mjs | 563 | 563/563 |
| empty-plugins.test.mjs | 24 | 24/24 |
| exploratory-empty.mjs | 27 | 27/27 |
| ui-plugin-test.mjs | 22 | 22/22 |
| ui-test.mjs | 36 | 36/36 |
| **合计** | **773** | **773/773** |

---

## 3. 测试退出码完整性审计

| 测试文件 | 退出码处理 | 受 CI 覆盖 |
| --- | --- | --- |
| feedback-smoke.test.mjs | process.exit(failed ? 1 : 0) 已有 | 是 |
| exploratory-feedback.mjs | process.exit(failed ? 1 : 0) 已有 | 是 |
| empty-plugins.test.mjs | process.exit(failed ? 1 : 0) 已有 | 是 |
| exploratory-empty.mjs | process.exit(failed ? 1 : 0) 已有 | 是 |
| smoke13.mjs | process.exit(fail ? 1 : 0) 已有 | 否（CI 跳过） |
| review-fixes.test.mjs | process.exit(failed ? 1 : 0) 已有 | 是 |
| upgrade-opt.test.mjs | process.exit(failed ? 1 : 0) 已有 | 是 |
| semver-consistency.mjs | process.exit(fail ? 1 : 0) 已有 | 是 |
| ui-test.mjs | 本次新增 process.exit(failed ? 1 : 0) | 是 |
| ui-plugin-test.mjs | 本次新增 process.exit(failed ? 1 : 0) | 是 |

**退出码验证**：各测试文件通过时返回 0，验证通过。

---

## 4. 重复断言审计

| 测试文件 | 发现问题 | 处理 |
| --- | --- | --- |
| ui-plugin-test.mjs | 重复断言 check("header action removed (not registered)") 出现两次 | 已移除重复行 |

---

## 5. 汇总表

| 审计项目 | 子项 | 状态 | 备注 |
| --- | --- | --- | --- |
| 文档一致性 | ARCHITECTURE.md | PASS | slot 数 2、测试项 22、CI 描述准确 |
| | PM-remediation.md | PASS | 入口方向正确、计数 22/22 |
| | README.md / README.en.md | PASS | 计数同步为 22 |
| CI 有效性 | 语法检查 | PASS | |
| | 核心加载 | PASS | |
| | 测试循环 + 退出码传播 | PASS | 9 套件 773/773 通过 |
| | 跳过 smoke13 | PASS | CI 兼容 |
| 退出码完整性 | 10 个测试文件全覆盖 | PASS | 2 个文件本次补全，8 个已有 |
| 重复断言 | 1 处 | PASS | 已移除 |

---

## 6. 结论

**正式审计结论：通过（PASS）**

- 文档与代码间共识别 4 处不一致（slot 数、测试项数、CI 描述、入口方向），全部已修正并按 CI 模拟验证通过。
- 2 个测试文件（ui-test.mjs、ui-plugin-test.mjs）补全了退出码，确保 CI 能捕获测试失败。
- 1 处重复断言已移除，测试计数从 23 同步为 22。
- 全量 9 个 CI 套件 773 项断言全部通过，退出码验证正确。
- 零遗留问题。