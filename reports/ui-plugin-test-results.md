# dsh-forge-ui 客户端插件测试报告

- 被测对象：ui-plugin/lib/client.js（ModuleLoader 客户端 bundle，内嵌 reports/dashboard.html）
- 方法：vm + mock __ModuleLoader__ / react（createElement/useState/useEffect）真实执行 bundle，驱动开/关交互
- 时间：2026-08-20T03:36:24.233Z

## 结果：22 通过 / 0 失败

---
PASS  bundle executes without error
PASS  ModuleLoader.load called with id dsh-forge-ui
PASS  factory returns exports
PASS  exports apply+inject
PASS  sidebar.footer.action registered (workspaces 下方/settings 上方)
PASS  header action removed (not registered)
PASS  registers turnTail card
PASS  locale injected
PASS  slots registered with locale ns
PASS  renders an entry button
PASS  button has title with 仪表盘
PASS  button label present when wide
PASS  modal opens with iframe
PASS  embedded html contains __DSH__ data
PASS  embedded html contains health badge
PASS  modal has close affordance
PASS  Escape closes modal
PASS  reopens
PASS  close button found
PASS  close button closes modal
PASS  sidebar button renders open label
PASS  collapsed sidebar button icon-only
---