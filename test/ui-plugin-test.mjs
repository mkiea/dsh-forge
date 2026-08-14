// dsh-forge/test/ui-plugin-test.mjs
// Tests for the dsh-forge-ui client bundle: ModuleLoader format, slot
// registration, button render, modal open/close via click and Escape.
// Run: node test/ui-plugin-test.mjs
import * as fs from "node:fs";
import * as path from "node:path";
import vm from "node:vm";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const BUNDLE = path.join(ROOT, "ui-plugin", "lib", "client.js");
const src = fs.readFileSync(BUNDLE, "utf8");

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

// ---- react mock (createElement/useState/useEffect/Fragment) ----
// zh dictionary stub for t()
const zhT = { title: "dsh-forge 插件仪表盘", subtitle: "插件组合分析", open: "插件仪表盘", openShort: "仪表盘", close: "关闭", hint: "提示" };
const tFn = (k) => zhT[k] || k;

// mini renderer: expand function components into plain trees
function renderNode(n) {
  if (!n || typeof n !== "object") return n;
  if (typeof n.type === "function") return renderNode(n.type(n.props));
  return { type: n.type, props: n.props, children: (n.children || []).map(renderNode) };
}

function makeReact() {
  let state = false;
  let rerender = null;
  let effectCleanup = null;
  const keydownHandlers = [];
  const doc = {
    addEventListener(ev, fn) { if (ev === "keydown") keydownHandlers.push(fn); },
    removeEventListener(ev, fn) { if (ev === "keydown") { const i = keydownHandlers.indexOf(fn); if (i >= 0) keydownHandlers.splice(i, 1); } }
  };
  const react = {
    Fragment: Symbol("fragment"),
    createElement: (type, props, ...children) => ({ type: type || null, props: props || {}, children }),
    useState(init) {
      if (init !== undefined && state === false && init !== false) state = !!init;
      return [state, (v) => {
        state = typeof v === "function" ? v(state) : !!v;
        if (rerender) rerender();
      }];
    },
    useEffect(fn) {
      if (effectCleanup) effectCleanup();
      const ret = fn();
      effectCleanup = typeof ret === "function" ? ret : null;
    }
  };
  return { react, doc, setRerender: (f) => { rerender = f; }, keydown: (k) => keydownHandlers.forEach((h) => h(k)) };
}

// ---- load bundle ----
let loaded = null;
let factoryError = null;
const m = makeReact();
const requireShim = (id) => {
  if (id === "react") return m.react;
  if (id === "react/jsx-runtime") return {};
  throw new Error("unexpected require: " + id);
};
const sandboxCtx = vm.createContext({
  window: { __ModuleLoader__: { load: (o) => { loaded = o; } } },
  document: m.doc,
  require: requireShim,
  console,
  Symbol,
  Object,
  JSON,
  String,
  Math,
  Date,
  Array
});
try {
  new vm.Script(src, { filename: "client.js" }).runInContext(sandboxCtx);
} catch (e) { factoryError = e; }
check("bundle executes without error", !factoryError, factoryError ? factoryError.message : "");
check("ModuleLoader.load called with id dsh-forge-ui", loaded && loaded.id === "dsh-forge-ui");

let plugin = null;
if (loaded) {
  try { plugin = loaded.factory(requireShim); } catch (e) { check("factory runs", false, e.message); }
}
check("factory returns exports", !!plugin);
if (plugin) {
  check("exports apply+inject", typeof plugin.apply === "function" && Array.isArray(plugin.inject) && plugin.inject.indexOf("slots") >= 0);
  const regs = [];
  const ctxMock = {
    effect: (fn) => fn(),
    slots: { register: (def, comp) => regs.push({ def, comp }) }
  };
  plugin.apply(ctxMock);
  const names = regs.map((r) => r.def.name);
  check("registers sidebar.footer.action", names.indexOf("sidebar.footer.action") >= 0);
  check("registers header action", names.indexOf("conversation.session.header.actions") >= 0);
  check("registers turnTail card", names.indexOf("conversation.chat.turnTail") >= 0);
  check("locale injected", plugin.inject.indexOf("locale") >= 0);
  check("slots registered with locale ns", regs.every((r) => r.def.locale === "forge"));

  const sidebarReg = regs.find((r) => r.def.name === "sidebar.footer.action");
  const comp = sidebarReg.comp;
  const render = () => renderNode(comp({ wide: true, t: tFn }));
  m.setRerender(() => { tree = render(); });
  let tree = render();
  const findButtons = (n, acc) => {
    if (!n || typeof n !== "object") return acc;
    if (n.type === "button" || (n.props && n.props.type === "button")) acc.push(n);
    (n.children || []).forEach((c) => findButtons(c, acc));
    return acc;
  };
  const buttons = findButtons(tree, []);
  check("renders an entry button", buttons.length >= 1);
  const openBtn = buttons[0];
  check("button has title with 仪表盘", openBtn.props.title && openBtn.props.title.indexOf("仪表盘") >= 0);
  check("button label present when wide", JSON.stringify(tree).indexOf("插件仪表盘") >= 0);
  openBtn.props.onClick();
  const hasIframe = (n) => {
    if (!n || typeof n !== "object") return false;
    if (n.type === "iframe") return true;
    return (n.children || []).some(hasIframe);
  };
  check("modal opens with iframe", hasIframe(tree));
  const treeStr = JSON.stringify(tree);
  check("embedded html contains __DSH__ data", treeStr.indexOf("window.__DSH__") >= 0);
  check("embedded html contains health badge", treeStr.indexOf("badge") >= 0);
  check("modal has close affordance", treeStr.indexOf("✕") >= 0 || treeStr.indexOf("关闭") >= 0);
  m.keydown({ key: "Escape" });
  check("Escape closes modal", !hasIframe(tree));
  openBtn.props.onClick();
  check("reopens", hasIframe(tree));
  const allBtns = findButtons(tree, []);
  const closeBtn = allBtns.find((b) => b.props["aria-label"] === "关闭");
  check("close button found", !!closeBtn);
  if (closeBtn) { closeBtn.props.onClick(); check("close button closes modal", !hasIframe(tree)); }
}

if (plugin) {
  const regs = [];
  const ctxMock = { effect: (fn) => fn(), slots: { register: (def, comp) => regs.push({ def, comp }) } };
  plugin.apply(ctxMock);
  // title + aria-label always carry the name; the label SPAN renders only when wide
  const spansWithText = (n, text, acc) => {
    if (!n || typeof n !== "object") return acc;
    if (n.type === "span" && n.children && n.children.some((c) => c === text)) acc.push(n);
    (n.children || []).forEach((c) => spansWithText(c, text, acc));
    return acc;
  };
  const collapsedTree = renderNode(regs[0].comp({ wide: false, t: tFn }));
  check("collapsed has no label span", spansWithText(collapsedTree, "插件仪表盘", []).length === 0);
  const wideTree = renderNode(regs[0].comp({ wide: true, t: tFn }));
  check("wide has label span", spansWithText(wideTree, "插件仪表盘", []).length === 1);
}

const lines = [];
lines.push("# dsh-forge-ui 客户端插件测试报告");
lines.push("");
lines.push("- 被测对象：ui-plugin/lib/client.js（ModuleLoader 客户端 bundle，内嵌 reports/dashboard.html）");
lines.push("- 方法：vm + mock __ModuleLoader__ / react（createElement/useState/useEffect）真实执行 bundle，驱动开/关交互");
lines.push("- 时间：" + new Date().toISOString());
lines.push("");
lines.push("## 结果：" + passed + " 通过 / " + failed + " 失败");
lines.push("");
lines.push("---");
for (const r of results) lines.push(r);
lines.push("---");
fs.writeFileSync(path.join(ROOT, "reports", "ui-plugin-test-results.md"), lines.join("\n"), "utf8");
console.log(lines.join("\n"));
console.log("\nSUMMARY:", passed, "passed,", failed, "failed");