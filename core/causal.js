// dsh-forge/core/causal.js
// Causal projection over an existing analysis. This layer never rescans and
// never turns a dependency into a cause: every relation is a projection of
// manifest / source-scan / finding evidence, with its tier and provenance
// attached so the UI can answer "why does this edge exist?".
"use strict";

const RELATIONS = ["depends_on", "provides_service", "requires_service", "influences"];

function node(id, type, label, extra) {
  return { id, type, label, ...extra };
}

// `*` / empty means any version; harness packages are prerelease-only, so the
// raw npm check would call these unsatisfied.
function isWildcardRange(range) {
  const t = String(range == null ? "" : range).trim();
  return t === "" || t === "*" || /^[xX]$/.test(t);
}

function ev(tier, confidence, provenance, observed) {
  return { tier, confidence, provenance, observed: !!observed };
}

// Build the projection. `analysis` is the object returned by runAnalysis().
export function buildCausalModel(analysis) {
  const { graph, conflicts, assessment } = analysis || {};
  if (!graph) {
    return { nodes: [], edges: [], counts: { nodes: 0, edges: 0, plugins: 0, services: 0, outcomes: 0 }, note: "no dependency graph" };
  }
  const nodes = [];
  const seen = new Set();
  const addNode = (n) => { if (n && !seen.has(n.id)) { seen.add(n.id); nodes.push(n); } };
  const edges = [];

  for (const pl of graph.plugins) {
    const r = assessment && assessment.risk ? assessment.risk[pl.id] : null;
    addNode(node("plugin:" + pl.package, "plugin", pl.name, {
      package: pl.package,
      version: pl.version,
      state: pl.disabled === true ? "disabled" : "active",
      risk: r ? r.score : null
    }));
  }

  // depends_on: a declared manifest dependency. Contract evidence, not a call.
  for (const e of graph.edges) {
    if (!e.toPackage) continue; // external libraries are assets, not causal actors
    const from = "plugin:" + e.fromPackage;
    const to = "plugin:" + e.to;
    if (!seen.has(to)) continue;
    // `*` accepts any version; harness packages are prerelease-only, so npm's
    // prerelease exclusion would otherwise report a settled wildcard as unsat
    // (risk scoring and the dashboard already exempt it).
    const wildcard = isWildcardRange(e.range);
    edges.push({
      id: "depends_on:" + from + "→" + to,
      relation: "depends_on",
      from,
      to,
      ...ev("contract-source", "high", e.fromPackage + " package.json requires " + e.to + " " + e.range),
      range: e.range,
      satisfied: wildcard ? true : e.satisfied,
      peer: !!e.peer
    });
  }

  // Service relations come from the same source scan the conflict engine used.
  const svc = (conflicts && conflicts.services) || { provides: {}, consumes: {} };
  const provides = svc.provides || {};
  const consumes = svc.consumes || {};
  for (const list of Object.values(provides)) for (const s of list || []) addNode(node("service:" + s, "service", s, {}));
  for (const list of Object.values(consumes)) for (const s of list || []) addNode(node("service:" + s, "service", s, {}));
  for (const [p, list] of Object.entries(provides)) {
    const from = "plugin:" + p;
    if (!seen.has(from)) continue;
    for (const s of list || []) {
      edges.push({
        id: "provides_service:" + from + "→service:" + s,
        relation: "provides_service", from, to: "service:" + s,
        ...ev("static-suspect", "medium", "source scan: " + p + " registers service '" + s + "'")
      });
    }
  }
  for (const [p, list] of Object.entries(consumes)) {
    const from = "plugin:" + p;
    if (!seen.has(from)) continue;
    for (const s of list || []) {
      edges.push({
        id: "requires_service:" + from + "→service:" + s,
        relation: "requires_service", from, to: "service:" + s,
        ...ev("static-suspect", "medium", "source scan: " + p + " consumes service '" + s + "'")
      });
    }
  }

  // Outcomes: findings link to the packages involved. The relation is
  // "influences" on purpose — the static scan proves involvement, not causation.
  for (const c of (conflicts && conflicts.conflicts) || []) {
    if (!c.finding_id) continue;
    const oid = "outcome:" + c.finding_id;
    addNode(node(oid, "outcome", c.type || "finding", {
      severity: c.finalSeverity || c.severity,
      finding_id: c.finding_id
    }));
    for (const pkg of c.packages || []) {
      const pn = "plugin:" + pkg;
      if (!seen.has(pn)) continue;
      edges.push({
        id: "influences:" + pn + "→" + oid,
        relation: "influences", from: pn, to: oid,
        ...ev(c.evidenceTier || "static-suspect", c.confidence || "medium",
          "finding " + (c.type || "unknown") + " (" + c.finding_id + ")"),
        finding_id: c.finding_id
      });
    }
  }

  const counts = {
    nodes: nodes.length,
    edges: edges.length,
    plugins: nodes.filter((n) => n.type === "plugin").length,
    services: nodes.filter((n) => n.type === "service").length,
    outcomes: nodes.filter((n) => n.type === "outcome").length
  };
  const model = {
    nodes,
    edges,
    counts,
    relations: RELATIONS,
    note: "因果投影：depends_on 表示声明依赖，不等于运行期调用；observed 仅在运行期探针确认后为 true。"
  };
  // Attach the human explanation once, so every surface (dashboard/client/CLI)
  // renders the same wording instead of re-deriving it.
  for (const e of model.edges) {
    const x = explainEdge(model, e.id);
    if (x) { e.why = x.why; e.caveat = x.caveat; }
  }
  return model;
}

// Human explanation for one projected edge ("why was this relation created?").
export function explainEdge(model, id) {
  const e = (model && model.edges ? model.edges : []).find((x) => x.id === id);
  if (!e) return null;
  let why;
  if (e.relation === "depends_on") {
    const verdict = isWildcardRange(e.range) ? "，* 接受任意版本，视为满足"
      : e.satisfied === false ? "，已安装版本不满足"
      : e.satisfied === true ? "，已安装版本满足" : "，未能确认安装版本";
    why = e.from.replace(/^plugin:/, "") + " 的清单声明依赖 " + e.to.replace(/^plugin:/, "") +
      "（" + e.range + "）" + verdict;
  } else if (e.relation === "provides_service") {
    why = e.from.replace(/^plugin:/, "") + " 的源码中扫描到 service 注册：" + e.to.replace(/^service:/, "");
  } else if (e.relation === "requires_service") {
    why = e.from.replace(/^plugin:/, "") + " 的源码中扫描到 service 消费：" + e.to.replace(/^service:/, "");
  } else {
    why = e.from.replace(/^plugin:/, "") + " 参与了该发现：" + e.to.replace(/^outcome:/, "");
  }
  return {
    id: e.id,
    relation: e.relation,
    from: e.from,
    to: e.to,
    evidence: { tier: e.tier, confidence: e.confidence, provenance: e.provenance, observed: e.observed },
    why,
    caveat: e.relation === "depends_on"
      ? "声明依赖只说明它需要该包；是否在运行期调用需由探针观测，不能据此推断因果。"
      : "该关系来自静态扫描，未观测到行为不代表不存在。"
  };
}
