// dsh-forge/test/ui-test.mjs
// Visualization UI tests (no browser required):
//  A) structural validation of generated HTML
//  B) DOM-mock execution of web/dashboard-client.js across all interaction
//     paths (filter / sort / toggle / add / remove / reset)
import * as fs from "node:fs";
import * as path from "node:path";
import vm from "node:vm";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const DASH = path.join(ROOT, "reports", "dashboard.html");
const GRAPH = path.join(ROOT, "reports", "plugin-graph.html");
const CLIENT = path.join(ROOT, "web", "dashboard-client.js");

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

// ---- A) structural validation ----
const dash = fs.readFileSync(DASH, "utf8");
const graph = fs.readFileSync(GRAPH, "utf8");

check("dashboard.html exists and non-trivial", dash.length > 100000, dash.length + "B");
check("graph html exists", graph.length > 50000, graph.length + "B");
check("balanced script tags", (dash.match(/<script>/g) || []).length === 2 && (dash.match(/<\/script>/g) || []).length === 2);
check("has closing html/body", dash.includes("</body></html>"));
const m = dash.match(/window\.__DSH__ = (.*?);\s*<\/script>/s);
check("embedded __DSH__ JSON extractable", !!m);
let data = null;
if (m) {
  try { data = JSON.parse(m[1]); check("embedded JSON parses", true); }
  catch (e) { check("embedded JSON parses", false, e.message); }
}
if (data) {
  check("rows embedded", data.rows && data.rows.length >= 100, data.rows.length + " rows");
  check("candidates embedded", data.candidates && data.candidates.length > 10, data.candidates.length + " candidates");
  check("conflicts embedded", Array.isArray(data.conflicts) && data.conflicts.length >= 50, data.conflicts.length + " findings");
  check("health embedded", ["A", "B", "C", "D"].includes(data.health), data.health);
  check("row fields complete", data.rows.every((r) => Array.isArray(r.deps) && typeof r.baseScore === "number" && Array.isArray(r.verified)));
  const ids = ["q", "fLayer", "fSev", "fStatus", "rowCount", "tbl", "simAdd", "simRemove", "simResult"];
  for (const id of ids) check("element id present: " + id, dash.includes('id="' + id + '"'));
}
check("graph has svg", graph.includes("<svg"));
check("graph has health badge", /badge [ABCD]/.test(graph));

// ---- B) DOM-mock execution test ----
function makeElement(id) {
  return {
    id: id || null,
    value: "",
    innerHTML: "",
    textContent: "",
    attrs: {},
    listeners: {},
    classList: { contains: () => false },
    children: [],
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] || null; },
    appendChild(e) { this.children.push(e); },
    addEventListener(ev, fn) { this.listeners[ev] = fn; }
  };
}
const elements = {};
for (const id of ["q", "fLayer", "fSev", "fStatus", "rowCount", "simAdd", "simRemove", "simResult"]) elements[id] = makeElement(id);
const tbody = makeElement("tbody");
const ths = ["id", "pkg", "layer", "disabled", "risk", "severity"].map((k) => {
  const th = makeElement("th");
  th.setAttribute("data-k", k);
  return th;
});
const doc = {
  _handlers: {},
  getElementById(id) { return elements[id] || makeElement(id); },
  querySelector(sel) { return sel === "#tbl tbody" ? tbody : null; },
  querySelectorAll(sel) { return sel === "#tbl th" ? ths : []; },
  createElement(tag) { return makeElement(tag); },
  addEventListener(ev, fn) { this._handlers[ev] = fn; }
};

const windowMock = { __DSH__: data, __DSH_APP__: null, prompt: (msg, def) => def || "sim-added-row" };
const ctx = vm.createContext({ window: windowMock, document: doc, console, prompt: windowMock.prompt, Set, Array, Object, JSON, String, Math, Date, Number, RegExp, isNaN, parseInt, parseFloat });
const clientSrc = fs.readFileSync(CLIENT, "utf8");
let clientError = null;
try { new vm.Script(clientSrc, { filename: "dashboard-client.js" }).runInContext(ctx); }
catch (e) { clientError = e; }
check("client script executes without error", !clientError, clientError ? clientError.message : "");
const app = windowMock.__DSH_APP__;
check("client app exposed (__DSH_APP__)", !!app);
// fire DOMContentLoaded so th click handlers + click delegation register
if (doc._handlers["DOMContentLoaded"]) doc._handlers["DOMContentLoaded"]();

if (app) {
  const rowCount = () => {
    const t = elements.rowCount.textContent;
    const mm = /(\d+) \/ (\d+)/.exec(t);
    return mm ? [+mm[1], +mm[2]] : null;
  };
  app.apply();
  check("initial render populates tbody", tbody.innerHTML.includes("<tr>") && tbody.innerHTML.includes("directory-picker"));
  check("initial row count = all rows", rowCount() && rowCount()[0] === rowCount()[1], JSON.stringify(rowCount()));
  check("sim shows baseline health A", elements.simResult.innerHTML.includes("健康度 A"));

  elements.q.value = "tool-";
  app.apply();
  const afterSearch = (tbody.innerHTML.match(/<tr>/g) || []).length;
  check("search tool- filters rows", afterSearch > 0 && afterSearch < rowCount()[1], afterSearch + " rows");
  elements.q.value = "";
  app.apply();

  elements.fStatus.value = "disabled";
  app.apply();
  const disabledRows = (tbody.innerHTML.match(/<tr>/g) || []).length;
  check("status=disabled shows 7 rows", disabledRows === 7, disabledRows + " rows");
  elements.fStatus.value = "";
  app.apply();

  elements.fLayer.value = "preset:standard";
  app.apply();
  const presetRows = (tbody.innerHTML.match(/<tr>/g) || []).length;
  check("layer=preset:standard filters", presetRows > 0 && presetRows < 40, presetRows + " rows");
  elements.fLayer.value = "";
  app.apply();

  const riskTh = ths.find((t) => t.getAttribute("data-k") === "risk");
  // initial dir = -1, so the first click sorts ASCENDING
  riskTh.listeners.click();
  const firstRowAsc = tbody.innerHTML.slice(0, 200);
  check("sort risk asc puts 0-risk row first", !firstRowAsc.includes("directory-picker"), firstRowAsc.slice(0, 100));
  riskTh.listeners.click();
  const firstRowDesc = tbody.innerHTML.slice(0, 400);
  check("sort risk desc puts directory-picker first", firstRowDesc.indexOf("directory-picker") >= 0 && firstRowDesc.indexOf(">10<") >= 0, firstRowDesc.slice(0, 120));

  app.toggle("directory-picker");
  check("toggle updates sim result", elements.simResult.innerHTML.includes("已禁用/移除：directory-picker"));
  app.toggle("directory-picker");

  const cand = data.candidates[0];
  elements.simAdd.value = cand.name;
  app.addRow();
  check("addRow adds candidate", elements.simResult.innerHTML.includes("已添加：") && elements.simResult.innerHTML.includes(cand.name.split("/").pop().replace(/^dsh-/, "")), cand.name);
  app.reset();
  check("reset clears sim state", elements.simResult.innerHTML.includes("已禁用/移除：—"));

  elements.simRemove.value = "tool-web";
  app.removeRow();
  check("removeRow updates sim result", elements.simResult.innerHTML.includes("已禁用/移除：tool-web"));
  app.reset();
}

const lines = [];
lines.push("# 可视化界面测试报告（dsh-forge UI Tests）");
lines.push("");
lines.push("- 被测对象：reports/dashboard.html（交互仪表盘）、reports/plugin-graph.html（图谱）、web/dashboard-client.js（客户端脚本）");
lines.push("- 数据来源：data/ecosystem.json（真实装载：web profile + preset:standard，136 行 / 131 插件）");
lines.push("- 方法：HTML 结构校验 + Node DOM-mock 全交互路径执行（无浏览器环境）");
lines.push("- 时间：" + new Date().toISOString());
lines.push("");
lines.push("## 结果：" + passed + " 通过 / " + failed + " 失败");
lines.push("");
lines.push("---");
for (const r of results) lines.push(r);
lines.push("---");
lines.push("");
if (failed === 0) lines.push("**结论：界面逻辑全部通过。** 建议在浏览器中打开 reports/dashboard.html 做视觉验收。");
else lines.push("**结论：存在失败用例，需修复。**");
fs.writeFileSync(path.join(ROOT, "reports", "ui-test-results.md"), lines.join("\n"), "utf8");
console.log(lines.join("\n"));
console.log("\nTEST SUMMARY:", passed, "passed,", failed, "failed");
process.exit(failed ? 1 : 0);