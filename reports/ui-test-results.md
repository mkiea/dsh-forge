# 可视化界面测试报告（dsh-forge UI Tests）

- 被测对象：reports/dashboard.html（交互仪表盘）、reports/plugin-graph.html（图谱）、web/dashboard-client.js（客户端脚本）
- 数据来源：data/ecosystem.json（真实装载：web profile + preset:standard，136 行 / 131 插件）
- 方法：HTML 结构校验 + Node DOM-mock 全交互路径执行（无浏览器环境）
- 时间：2026-08-20T10:45:31.978Z

## 结果：77 通过 / 0 失败

---
PASS  dashboard.html exists and non-trivial  [401804B]
PASS  graph html exists  [83338B]
PASS  balanced script tags
PASS  has closing html/body
PASS  embedded __DSH__ JSON extractable
PASS  embedded JSON parses
PASS  rows embedded  [133 rows]
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
PASS  hybrid nav tabs present
PASS  hybrid pages present
PASS  INV invariants table present
PASS  truthSource embedded  [snapshot]
PASS  confidenceCap key present  [null]
PASS  findingsValid is violations array  [[]]
PASS  findingsValid empty (all valid)  [violations=0]
PASS  mixedNote sourceLabel present  [离线快照 2026-08-14T03:41:06.010Z（可复现）]
PASS  conflict finding_id embedded
PASS  leaks + leakSummary embedded
PASS  graph has svg
PASS  graph has health badge
PASS  client script executes without error
PASS  client app exposed (__DSH_APP__)
PASS  workspace has module tabs  [11 tabs]
PASS  default page is guide  [page-guide]
PASS  guide page active by default
PASS  guide nav tab present
PASS  guide h2 present
PASS  guide 3-step ol present
PASS  glossary table present
PASS  tooltip css .tip:hover::after present
PASS  tooltip trigger present
PASS  canonical SEV label 阻断 present
PASS  glossary term truthSource present
PASS  10 legacy module guide banners present  [10 banners]
PASS  mod-guide css present
PASS  extended glossary: 层 layer
PASS  extended glossary: 风险分 risk score
PASS  extended glossary: 信号 signal
PASS  extended glossary: 状态 active/disabled
PASS  components header layer tooltip expanded
PASS  clicking tab switches page
PASS  back to first tab
PASS  page-inv page activates
PASS  back to default after page-inv
PASS  page-leaks page activates
PASS  back to default after page-leaks
PASS  initial render populates tbody
PASS  initial row count = all rows  [[133,133]]
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
PASS  live dashboard renders refresh button
PASS  live dashboard renders live badge
PASS  live dashboard embeds live:true
PASS  live dashboard metaLine present
PASS  static dashboard has no refresh button (graceful offline)
PASS  live client executes without error
PASS  live client exposes refresh()
---

**结论：界面逻辑全部通过。** 建议在浏览器中打开 reports/dashboard.html 做视觉验收。