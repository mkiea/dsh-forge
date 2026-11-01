# 依赖图谱测试报告（dsh-forge Graph Tests）

- 被测对象：reports/dashboard.html + web/dashboard-client.js（page-graph 互动图谱）
- 方法：DOM-mock 执行 + 模拟拖拽/点击/添加组件，无浏览器
- 时间：2026-11-01T14:15:44.233Z

## 结果：41 通过 / 0 失败

---
PASS  embedded __DSH__ extractable
PASS  embedded JSON parses
PASS  client script executes without error
PASS  client app exposed (__DSH_APP__)
PASS  graph container populated by initGraph  [161954B]
PASS  overview renders forge node  [data-pkg=dsh-forge]
PASS  overview renders forge-ui node  [data-pkg=dsh-forge-ui]
PASS  overview emits clipPath per node  [210 clips]
PASS  graph-side detail panel shows overview help
PASS  overview has arrow marker defs
PASS  synthetic forget-ui edge present in edge markup
PASS  clicking forge fills detail panel
PASS  detail shows 前置依赖 heading
PASS  detail shows 后置依赖 heading
PASS  candidate available to add
PASS  new injected package absent before addRow  [pre-add absent]
PASS  injected package appears in graph after addRow  [@forge/sim-graph-new]
PASS  graph re-rendered (forge still present)
PASS  added node carries rows metadata
PASS  adaptiveFilter helper present
PASS  fitText helper present
PASS  importantEdge helper present
PASS  graph detail panel re-rendered after add
PASS  palette rendered with addable candidates
PASS  palette renders external-lib toggle + auto layout controls
PASS  node drag moves the card  [{"x":884,"y":40} -> {"x":1509,"y":457}]
PASS  drag re-renders node card
PASS  dragged node is not silently selected
PASS  palette click adds a node  [@forge/sim-palette-new]
PASS  palette add lands in simulation state
PASS  Delete removes the selected node
PASS  removed component listed as restorable
PASS  removal marks composition rows as hypothetical
PASS  palette restore brings the node back
PASS  restore clears hypothetical removals
PASS  auto layout restores the layer grid position  [{"x":884,"y":40}]
PASS  hide external libs shrinks the canvas  [164613->123905]
PASS  ext toggle button reflects state
PASS  show external libs restores them
PASS  edge click fills evidence inspector
PASS  clear selection returns to overview
---

**结论：依赖图谱工作正常，含『添加组件后图谱显示』场景。**