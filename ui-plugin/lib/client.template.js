window.__ModuleLoader__.load({
  id: "dsh-forge-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    var DASHBOARD_HTML = "__DASHBOARD_HTML__";
    var GENERATED_AT = "__GENERATED_AT__";
    var TITLE = "dsh-forge 插件仪表盘";
    var SUBTITLE = "插件组合分析 · 只读 · 模拟不落盘";

    function btnStyle(wide) {
      return {
        width: "100%",
        minHeight: 30,
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: wide ? "6px 10px" : "6px 0",
        margin: "2px 0",
        border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))",
        borderRadius: 8,
        background: "var(--dsw-alias-button-elevated-fill, rgba(127,127,127,.08))",
        color: "var(--dsw-alias-label-primary, #222)",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 500,
        whiteSpace: "nowrap",
        overflow: "hidden"
      };
    }
    function overlayStyle() {
      return {
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(10,12,16,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box"
      };
    }
    function modalStyle() {
      return {
        width: "min(1180px, 96vw)",
        height: "min(88vh, 900px)",
        display: "flex",
        flexDirection: "column",
        background: "var(--dsw-specific-surface-fill, #fff)",
        border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))",
        borderRadius: 14,
        boxShadow: "0 18px 60px rgba(0,0,0,.35)",
        overflow: "hidden"
      };
    }
    function headerStyle() {
      return {
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2))"
      };
    }
    function closeStyle() {
      return {
        marginLeft: "auto",
        border: "none",
        background: "transparent",
        color: "var(--dsw-alias-label-secondary, #666)",
        cursor: "pointer",
        fontSize: 16,
        width: 28,
        height: 28,
        borderRadius: 6
      };
    }

    function DashboardEntry(props) {
      var wide = props && props.wide;
      var openState = react.useState(false);
      var isOpen = openState[0];
      var setOpen = openState[1];
      react.useEffect(() => {
        if (!isOpen) return;
        function onKey(e) { if (e.key === "Escape") setOpen(false); }
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, [isOpen]);
      var btn = react.createElement("button", {
        type: "button",
        onClick: function () { setOpen(true); },
        title: TITLE + "（" + SUBTITLE + " · 生成于 " + GENERATED_AT + "）",
        "aria-label": TITLE,
        style: btnStyle(wide)
      }, react.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 } },
        react.createElement("span", { "aria-hidden": true, style: { fontSize: 14 } }, "▦"),
        wide ? react.createElement("span", null, "插件仪表盘") : null));
      if (!isOpen) return btn;
      var modal = react.createElement("div", { style: overlayStyle() },
        react.createElement("div", { style: modalStyle() },
          react.createElement("div", { style: headerStyle() },
            react.createElement("strong", null, TITLE),
            react.createElement("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary, #888)" } }, "生成于 " + GENERATED_AT + " · " + SUBTITLE),
            react.createElement("button", { type: "button", onClick: function () { setOpen(false); }, style: closeStyle(), "aria-label": "关闭" }, "✕")
          ),
          react.createElement("iframe", {
            srcDoc: DASHBOARD_HTML,
            title: TITLE,
            style: { width: "100%", flex: 1, border: 0, background: "#f4f6f8" }
          })
        )
      );
      return react.createElement(react.Fragment, null, btn, modal);
    }

    function apply(ctx) {
      ctx.effect(() => ctx.slots.register({ name: "sidebar.footer.action", id: "forge-ui" }, DashboardEntry), "dsh-forge-ui: sidebar entry");
    }
    var inject = ["slots"];
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
