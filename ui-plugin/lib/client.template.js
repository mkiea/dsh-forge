window.__ModuleLoader__.load({
  id: "dsh-forge-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    var DASHBOARD_HTML = "__DASHBOARD_HTML__";
    var GENERATED_AT = "__GENERATED_AT__";
    var SERVER = "http://localhost:3060";
    var NS = "forge";
    var zh = {
      "title": "dsh-forge 插件仪表盘",
      "subtitle": "插件组合实时分析 · 动态刷新 · 报告可生成",
      "open": "插件仪表盘",
      "openShort": "仪表盘",
      "generatedAt": "生成于",
      "live": "实时",
      "liveFull": "实时 · 3060 已连接",
      "snapshot": "快照",
      "snapshotFull": "快照 · 请先运行 dsh-forge web（默认 127.0.0.1:3060，未启动自动回退快照）",
      "refresh": "刷新",
      "refreshing": "刷新中…",
      "refreshDone": "已刷新最新分析结果",
      "report": "生成报告",
      "reporting": "生成中…",
      "reportDone": "报告已生成",
      "history": "快照历史",
      "historyLoading": "读取历史…",
      "close": "关闭",
      "hint": "实时分析当前插件组合（刷新以重新扫描），可生成 Markdown 报告并归档快照；仪表盘如实呈现健康度、冲突、风险与运行时状态。"
    };
    var en = {
      "title": "dsh-forge plugin dashboard",
      "subtitle": "live plugin analysis · refresh · report",
      "open": "Plugin dashboard",
      "openShort": "Dashboard",
      "generatedAt": "generated at",
      "live": "live",
      "liveFull": "live · 3060 connected",
      "snapshot": "snapshot",
      "snapshotFull": "snapshot - run dsh-forge web first (default 127.0.0.1:3060; falls back to snapshot)",
      "refresh": "Refresh",
      "refreshing": "Refreshing…",
      "refreshDone": "Latest analysis loaded",
      "report": "Generate report",
      "reporting": "Generating…",
      "reportDone": "Report generated",
      "history": "Snapshots",
      "historyLoading": "Loading history…",
      "close": "Close",
      "hint": "Analyze the live plugin composition live (Refresh to re-scan), generate a Markdown report and archive snapshots; the dashboard honestly shows health, conflicts, risk and runtime state."
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
        gap: 8,
        padding: "8px 12px",
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
    function actionBtnStyle() {
      return {
        border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))",
        background: "var(--dsw-alias-button-elevated-fill, rgba(127,127,127,.08))",
        color: "var(--dsw-alias-label-primary, #222)",
        borderRadius: 6,
        padding: "4px 10px",
        cursor: "pointer",
        fontSize: 12,
        whiteSpace: "nowrap"
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
    // Live-first: fetch the dashboard from the local 3060 data channel so the
    // popup always reflects the real latest analysis; the snapshot (and any
    // still-shown server error) degrades to the embedded dashboard when the
    // server is unreachable. Refresh re-fetches; Generate report POSTs to the
    // 3060 report endpoint and surfaces the written file path.
    function WithModal(props) {
      var openState = react.useState(false);
      var isOpen = openState[0];
      var setOpen = openState[1];
      var iframeState = react.useState(DASHBOARD_HTML);
      var iframeHtml = iframeState[0];
      var setIframeHtml = iframeState[1];
      var liveState = react.useState(false);
      var live = liveState[0];
      var setLive = liveState[1];
      var statusState = react.useState("");
      var status = statusState[0];
      var setStatus = statusState[1];
      var busyState = react.useState("");
      var busy = busyState[0];
      var setBusy = busyState[1];

      var loadLive = function () {
        if (typeof fetch === "undefined") { setLive(false); return; }
        setBusy(props.t("refreshing"));
        fetch(SERVER + "/").then(function (r) {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        }).then(function (html) {
          setIframeHtml(html);
          setLive(true);
          setStatus(props.t("refreshDone"));
          setBusy("");
        }).catch(function () {
          setLive(false);
          setStatus("");
          setBusy("");
        });
      };

      var generateReport = function () {
        if (typeof fetch === "undefined") { setStatus("report API unavailable"); return; }
        setBusy(props.t("reporting"));
        fetch(SERVER + "/api/report", { method: "POST" }).then(function (r) { return r.json(); }).then(function (d) {
          setBusy("");
          if (d && d.ok) setStatus(props.t("reportDone") + " · " + d.file + (d.historyError ? " · history 失败: " + d.historyError : " · history 已归档"));
          else setStatus("report failed: " + (d && d.error || "unknown"));
        }).catch(function (e) {
          setBusy("");
          setStatus("report failed: " + String(e && e.message || e));
        });
      };

      var loadHistory = function () {
        if (typeof fetch === "undefined") { setStatus("history API unavailable"); return; }
        setBusy(props.t("historyLoading"));
        fetch(SERVER + "/api/history").then(function (r) { return r.json(); }).then(function (d) {
          setBusy("");
          if (d && d.ok) setStatus("快照历史 " + (d.list ? d.list.length : 0) + " 条");
          else setStatus("history failed: " + (d && d.error || "unknown"));
        }).catch(function (e) {
          setBusy("");
          setStatus("history failed: " + String(e && e.message || e));
        });
      };

      react.useEffect(function () {
        if (!isOpen) return;
        function onKey(e) { if (e.key === "Escape") setOpen(false); }
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, [isOpen]);

      react.useEffect(function () {
        if (!isOpen) return;
        var cancelled = false;
        if (typeof fetch !== "undefined") {
          setBusy(props.t("refreshing"));
          fetch(SERVER + "/").then(function (r) {
            if (!r.ok) throw new Error(String(r.status));
            return r.text();
          }).then(function (html) {
            if (cancelled) return;
            setIframeHtml(html);
            setLive(true);
            setStatus("");
            setBusy("");
          }).catch(function () {
            if (cancelled) return;
            setLive(false);
            setBusy("");
          });
        }
        return function () { cancelled = true; };
      }, [isOpen]);

      var trigger = props.renderTrigger(setOpen);
      if (!isOpen) return trigger;
      var subtitle = props.t(live ? "liveFull" : "snapshotFull") + " · " + props.t("generatedAt") + " " + GENERATED_AT;
      var modal = react.createElement("div", { style: overlayStyle() },
        react.createElement("div", { style: modalStyle() },
          react.createElement("div", { style: headerStyle() },
            react.createElement("strong", null, props.t("title")),
            react.createElement("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary, #888)", marginLeft: 8 } }, subtitle + (busy ? " · " + busy : "")),
            react.createElement("button", { type: "button", onClick: generateReport, style: actionBtnStyle(), "aria-label": props.t("report") }, props.t("report")),
            react.createElement("button", { type: "button", onClick: loadHistory, style: actionBtnStyle(), "aria-label": props.t("history") }, props.t("history")),
            react.createElement("button", { type: "button", onClick: function () { setOpen(false); }, style: closeStyle(), "aria-label": props.t("close") }, "✕")
          ),
          status
            ? react.createElement("div", { style: { flex: "none", padding: "6px 14px", background: "var(--dsw-alias-background-fill, rgba(127,127,127,.06))", borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2))", fontSize: 12, color: "var(--dsw-alias-label-secondary, #666)", fontFamily: "monospace" } }, status)
            : null,
          react.createElement("iframe", {
            srcDoc: iframeHtml,
            title: props.t("title"),
            style: { width: "100%", flex: 1, border: 0, background: "#f4f6f8" }
          })
        )
      );
      return react.createElement(react.Fragment, null, trigger, modal);
    }

    // 1) sidebar footer entry (弹窗按钮)
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

    // 3) turn-tail hint card (弹窗按钮)
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
      ctx.slots.inject("sidebar.footer.action", function () {
        ctx.slots.register({ name: "sidebar.footer.action", id: "forge-ui", locale: NS }, SidebarEntry);
      });
      ctx.slots.inject("conversation.chat.turnTail", function () {
        ctx.slots.register({ name: "conversation.chat.turnTail", id: "forge-ui", locale: NS, select: function () { return true; } }, TurnTailCard);
      });
    }
    var inject = ["slots", "locale"];
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});