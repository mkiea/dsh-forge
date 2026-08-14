window.__ModuleLoader__.load({
  id: "dsh-forge-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    var DASHBOARD_HTML = "__DASHBOARD_HTML__";
    var GENERATED_AT = "__GENERATED_AT__";
    var NS = "forge";
    var zh = {
      "title": "dsh-forge 插件仪表盘",
      "subtitle": "插件组合分析 · 只读 · 模拟不落盘",
      "open": "插件仪表盘",
      "openShort": "仪表盘",
      "generatedAt": "生成于",
      "close": "关闭",
      "hint": "可用 analyze_dependencies / check_conflicts 分析组合；仪表盘展示组件状态、风险评分与假设模拟。"
    };
    var en = {
      "title": "dsh-forge plugin dashboard",
      "subtitle": "plugin analysis · read-only · simulation never persisted",
      "open": "Plugin dashboard",
      "openShort": "Dashboard",
      "generatedAt": "generated at",
      "close": "Close",
      "hint": "Analyze the composition with analyze_dependencies / check_conflicts; the dashboard shows component status, risk and simulation."
    };

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

    function makeT(ctx) {
      return function (key) {
        try {
          if (ctx && ctx.locale && ctx.locale.dict && ctx.locale.dict[NS]) {
            var d = ctx.locale.dict[NS];
            if (d[key]) return d[key];
          }
        } catch (e) { /* fall through */ }
        return zh[key] || key;
      };
    }

    // Self-contained modal wrapper: any trigger button opens it.
    function WithModal(props) {
      var openState = react.useState(false);
      var isOpen = openState[0];
      var setOpen = openState[1];
      react.useEffect(function () {
        if (!isOpen) return;
        function onKey(e) { if (e.key === "Escape") setOpen(false); }
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, [isOpen]);
      var trigger = props.renderTrigger(setOpen);
      if (!isOpen) return trigger;
      var modal = react.createElement("div", { style: overlayStyle() },
        react.createElement("div", { style: modalStyle() },
          react.createElement("div", { style: headerStyle() },
            react.createElement("strong", null, props.t("title")),
            react.createElement("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary, #888)" } }, props.t("generatedAt") + " " + GENERATED_AT + " · " + props.t("subtitle")),
            react.createElement("button", { type: "button", onClick: function () { setOpen(false); }, style: closeStyle(), "aria-label": props.t("close") }, "✕")
          ),
          react.createElement("iframe", {
            srcDoc: DASHBOARD_HTML,
            title: props.t("title"),
            style: { width: "100%", flex: 1, border: 0, background: "#f4f6f8" }
          })
        )
      );
      return react.createElement(react.Fragment, null, trigger, modal);
    }

    // 1) sidebar footer entry
    function SidebarEntry(props) {
      var t = props.t;
      return react.createElement(WithModal, {
        t: t,
        renderTrigger: function (setOpen) {
          return react.createElement("button", {
            type: "button",
            onClick: function () { setOpen(true); },
            title: t("title") + "（" + t("subtitle") + "）",
            "aria-label": t("title"),
            style: btnStyle(props.wide)
          }, react.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 } },
            react.createElement("span", { "aria-hidden": true, style: { fontSize: 14 } }, "▦"),
            props.wide ? react.createElement("span", null, t("open")) : null));
        }
      });
    }

    // 2) conversation header action entry
    function HeaderEntry(props) {
      var t = props.t;
      return react.createElement(WithModal, {
        t: t,
        renderTrigger: function (setOpen) {
          return react.createElement("button", {
            type: "button",
            onClick: function () { setOpen(true); },
            title: t("title"),
            "aria-label": t("title"),
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              border: "none",
              background: "transparent",
              color: "var(--dsw-alias-label-secondary, #666)",
              cursor: "pointer",
              fontSize: 13,
              padding: "4px 6px",
              borderRadius: 6
            }
          }, "▦ ", t("openShort"));
        }
      });
    }

    // 3) turn-tail hint card
    function TurnTailCard(props) {
      var t = props.t;
      return react.createElement(WithModal, {
        t: t,
        renderTrigger: function (setOpen) {
          return react.createElement("div", {
            style: {
              margin: "6px 0",
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2))",
              background: "var(--dsw-alias-surface-fill, rgba(127,127,127,.04))",
              fontSize: 12,
              color: "var(--dsw-alias-label-secondary, #666)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap"
            }
          },
            react.createElement("span", null, "▦"),
            react.createElement("span", null, t("hint")),
            react.createElement("button", {
              type: "button",
              onClick: function () { setOpen(true); },
              style: {
                marginLeft: "auto",
                border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))",
                background: "var(--dsw-alias-button-elevated-fill, rgba(127,127,127,.08))",
                color: "var(--dsw-alias-label-primary, #222)",
                borderRadius: 6,
                padding: "3px 10px",
                cursor: "pointer",
                fontSize: 12
              }
            }, t("openShort"))
          );
        }
      });
    }

    function apply(ctx) {
      var t = makeT(ctx);
      if (ctx.locale) {
        ctx.effect(function () {
          ctx.locale.register(NS, { zh: zh, en: en });
        }, "dsh-forge-ui: dictionaries");
      }
      ctx.effect(function () {
        ctx.slots.register({ name: "sidebar.footer.action", id: "forge-ui", locale: NS }, SidebarEntry);
      }, "dsh-forge-ui: sidebar entry");
      ctx.effect(function () {
        ctx.slots.register({ name: "conversation.session.header.actions", id: "forge-ui", locale: NS }, HeaderEntry);
      }, "dsh-forge-ui: header entry");
      ctx.effect(function () {
        ctx.slots.register({ name: "conversation.chat.turnTail", id: "forge-ui", locale: NS }, TurnTailCard);
      }, "dsh-forge-ui: turn-tail card");
    }
    var inject = ["slots", "locale"];
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
