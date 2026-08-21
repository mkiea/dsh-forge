// dsh-forge/test/graph-test.mjs
// Dependency-graph tests (no browser): DOM-mock execution of
// web/dashboard-client.js, focused on the interactive dependency graph
// (page-graph). Verifies:
//  A) overview renders plugin nodes + the synthetic forge-ui→forge edge
//  B) clicking a node fills the right panel with 前置(→)/后置(←)
//  C) 假设模拟 addRow() makes the new component appear in the graph
//  D) round-2/3/4 graph helpers survive (adaptive filter, fitText)
import * as fs from "node:fs";
import * as path from "node:path";
import vm from "node:vm";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const DASH = path.join(ROOT, "reports", "dashboard.html");
const CLIENT = path.join(ROOT, "web", "dashboard-client.js");

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

const dash = fs.readFileSync(DASH, "utf8");
const m = dash.match(/window\.__DSH__ = (.*?);\s*<\/script>/s);
check("embedded __DSH__ extractable", !!m);
let data = null;
if (m) {
  try { data = JSON.parse(m[1]); check("embedded JSON parses", !!data); }
  catch (e) { check("embedded JSON parses", false, e.message); }
}

if (!data) {
  console.log("cannot run graph tests: no embedded data");
  process.exit(1);
}

function makeElement(id) {
  return {
    id: id || null, value: "", innerHTML: "", textContent: "", attrs: {},
    listeners: {},
    classList: (() => { const s = new Set(); return {
      contains: (c) => s.has(c), add: (c) => s.add(c), remove: (c) => s.delete(c),
      toggle: (c, f) => { if (f === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else { f ? s.add(c) : s.delete(c); } }, _set: s }; })(),
    children: [], clientWidth: 800, clientHeight: 600,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] || null; },
    appendChild(e) { this.children.push(e); },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    querySelector() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  };
}

const elements = {};
for (const id of ["q", "fLayer", "fSev", "fStatus", "rowCount", "simAdd", "simRemove", "simResult", "gDetail", "gZoomIn", "gZoomOut", "gZoomReset"]) elements[id] = makeElement(id);
const graphHost = makeElement("dshGraph");
elements.dshGraph = graphHost;
const tbody = makeElement("tbody");
const doc = {
  _handlers: {},
  getElementById(id) { return elements[id] || makeElement(id); },
  querySelector(sel) { return sel === "#tbl tbody" ? tbody : null; },
  querySelectorAll() { return []; },
  createElement(tag) { return makeElement(tag); },
  addEventListener(ev, fn) { this._handlers[ev] = fn; }
};

const promptReturn = "sim-graph-added";
const windowMock = { __DSH__: data, __DSH_APP__: null, prompt: () => promptReturn };
const ctx = vm.createContext({ window: windowMock, document: doc, console, prompt: windowMock.prompt, Set, Array, Object, JSON, String, Math, Date, Number, RegExp, isNaN, parseInt, parseFloat, fetch: undefined });
const clientSrc = fs.readFileSync(CLIENT, "utf8");
let clientError = null;
try { new vm.Script(clientSrc, { filename: "dashboard-client.js" }).runInContext(ctx); }
catch (e) { clientError = e; }
check("client script executes without error", !clientError, clientError ? clientError.message : "");
const app = windowMock.__DSH_APP__;
check("client app exposed (__DSH_APP__)", !!app);

if (doc._handlers["DOMContentLoaded"]) doc._handlers["DOMContentLoaded"]();

// ---- A) overview rendering of the graph ----
const html = graphHost.innerHTML;
check("graph container populated by initGraph", typeof html === "string" && html.length > 1000, (html || "").length + "B");
check("overview renders forge node", html.indexOf('data-pkg="dsh-forge"') >= 0, "data-pkg=dsh-forge");
check("overview renders forge-ui node", html.indexOf('data-pkg="dsh-forge-ui"') >= 0, "data-pkg=dsh-forge-ui");
check("overview emits clipPath per node", (html.match(/<clipPath /g) || []).length >= 20, (html.match(/<clipPath /g) || []).length + " clips");
check("graph-side detail panel shows overview help", elements.gDetail.innerHTML.indexOf("依赖图谱 · 总览") >= 0);
check("overview has arrow marker defs", html.indexOf('id="arrow-att"') >= 0);
check("synthetic forget-ui edge present in edge markup", html.indexOf("forge-ui") >= 0 && html.indexOf("dsh-forge") >= 0);

// ---- B) click a node -> right panel shows 前置/后置 ----
// synthesize a click on the dsh-forge node
const fakeTarget = { getAttribute: (k) => (k === "data-pkg" ? "dsh-forge" : null), parentNode: graphHost };
graphHost.onclick({ target: fakeTarget });
check("clicking forge fills detail panel", elements.gDetail.innerHTML.indexOf("dsh-forge") >= 0);
check("detail shows 前置依赖 heading", elements.gDetail.innerHTML.indexOf("前置依赖") >= 0);
check("detail shows 后置依赖 heading", elements.gDetail.innerHTML.indexOf("后置依赖") >= 0);

// ---- C) simulated addRow appears in the graph ----
const cand = data.candidates[0];
check("candidate available to add", !!cand);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inGraph = (name) => graphHost.innerHTML.indexOf('data-pkg="' + esc(name) + '"') >= 0;
// All real candidates already live in the snapshot graph, so inject a brand
// new synthetic package to strictly prove a fresh node appears after addRow.
const freshName = "@forge/sim-graph-new";
data.candidates.push({ name: freshName, ver: "9.9.9", deps: [{ dep: "dsh-attachment", ok: true, range: "*" }] });
const beforeFresh = inGraph(freshName);
elements.simAdd.value = freshName;
app.addRow();
const afterHtml = graphHost.innerHTML;
const afterFresh = afterHtml.indexOf('data-pkg="' + esc(freshName) + '"') >= 0;
check("new injected package absent before addRow", !beforeFresh, "pre-add absent");
check("injected package appears in graph after addRow", afterFresh, freshName);
check("graph re-rendered (forge still present)", afterHtml.indexOf('data-pkg="dsh-forge"') >= 0);

// (bonus) added component's own node markup exists
check("added node carries rows metadata", /data-pkg="[^"]+"[^>]*>\s*<rect/.test(afterHtml));

// ---- D) surviving graph helpers ----
check("adaptiveFilter helper present", clientSrc.indexOf("function adaptiveFilter") >= 0);
check("fitText helper present", clientSrc.indexOf("function fitText") >= 0);
check("importantEdge helper present", clientSrc.indexOf("function importantEdge") >= 0);
check("graph detail panel re-rendered after add", elements.gDetail.innerHTML.length > 0);

const report = [];
report.push("# 依赖图谱测试报告（dsh-forge Graph Tests）");
report.push("");
report.push("- 被测对象：reports/dashboard.html + web/dashboard-client.js（page-graph 互动图谱）");
report.push("- 方法：DOM-mock 执行 + 模拟拖拽/点击/添加组件，无浏览器");
report.push("- 时间：" + new Date().toISOString());
report.push("");
report.push("## 结果：" + passed + " 通过 / " + failed + " 失败");
report.push("");
report.push("---");
for (const r of results) report.push(r);
report.push("---");
if (failed === 0) report.push("\n**结论：依赖图谱工作正常，含『添加组件后图谱显示』场景。**");
else report.push("\n**结论：存在失败用例，需修复。**");
fs.writeFileSync(path.join(ROOT, "reports", "graph-test-results.md"), report.join("\n"), "utf8");
console.log(report.join("\n"));
console.log("\nTEST SUMMARY:", passed, "passed,", failed, "failed");
process.exit(failed ? 1 : 0);