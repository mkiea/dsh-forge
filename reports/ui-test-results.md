# 可视化界面测试报告（dsh-forge UI Tests）

- 被测对象：reports/dashboard.html（交互仪表盘）、reports/plugin-graph.html（图谱）、web/dashboard-client.js（客户端脚本）
- 数据来源：data/ecosystem.json（真实装载：web profile + preset:standard，136 行 / 131 插件）
- 方法：HTML 结构校验 + Node DOM-mock 全交互路径执行（无浏览器环境）
- 时间：2026-08-13T19:19:08.386Z

## 结果：36 通过 / 0 失败

---
PASS  dashboard.html exists and non-trivial  [370346B]
PASS  graph html exists  [82541B]
PASS  balanced script tags
PASS  has closing html/body
PASS  embedded __DSH__ JSON extractable
PASS  embedded JSON parses
PASS  rows embedded  [131 rows]
PASS  candidates embedded  [32 candidates]
PASS  conflicts embedded  [63 findings]
PASS  health embedded  [A]
PASS  row fields complete
PASS  element id present: q
PASS  element id present: fLayer
PASS  element id present: fSev
PASS  element id present: fStatus
PASS  element id present: rowCount
PASS  element id present: tbl
PASS  element id present: simAdd
PASS  element id present: simRemove
PASS  element id present: simResult
PASS  graph has svg
PASS  graph has health badge
PASS  client script executes without error
PASS  client app exposed (__DSH_APP__)
PASS  initial render populates tbody
PASS  initial row count = all rows  [[131,131]]
PASS  sim shows baseline health A
PASS  search tool- filters rows  [22 rows]
PASS  status=disabled shows 7 rows  [7 rows]
PASS  layer=preset:standard filters  [24 rows]
PASS  sort risk asc puts 0-risk row first  [<tr><td><input type="checkbox" class="toggle" data-id="timer" checked>timer</td><td>@deepseek-ai/cor]
PASS  sort risk desc puts directory-picker first  [<tr><td><input type="checkbox" class="toggle" data-id="directory-picker" checked>directory-picker</td><td>@deepseek-ai/d]
PASS  toggle updates sim result
PASS  addRow adds candidate  [@deepseek-ai/dsh-attachment]
PASS  reset clears sim state
PASS  removeRow updates sim result
---

**结论：界面逻辑全部通过。** 建议在浏览器中打开 reports/dashboard.html 做视觉验收。