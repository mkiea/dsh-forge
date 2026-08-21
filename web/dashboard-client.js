// dsh-forge/web/dashboard-client.js
// Injected into the dashboard page by core/dashboard.js (self-contained).
// ES5 style, no template literals. Reads window.__DSH__ (embedded JSON).
/*jshint esversion: 6 */
(function () {
  'use strict';
  var E = window.__DSH__;
  var state = { search: '', layer: '', sev: '', status: '', sort: 'risk', dir: -1, disabled: {}, added: [], removed: [] };

  function layers() {
    var s = new Set();
    E.rows.forEach(function (r) { s.add(r.layer); });
    return Array.from(s);
  }

  function fillLayers() {
    var sel = document.getElementById('fLayer');
    sel.innerHTML = '<option value="">全部层</option>';
    layers().forEach(function (l) {
      var o = document.createElement('option');
      o.value = l; o.textContent = l; sel.appendChild(o);
    });
  }

  function active(r) {
    if (state.disabled[r.id]) return false;
    if (r.disabled) return false;
    if (state.removed.indexOf(r.id) >= 0) return false;
    return true;
  }

  function scoreOf(r) {
    if (!active(r)) return { score: 0, severity: 'disabled', sig: [] };
    var s = r.baseScore || 0;
    var sig = r.base ? r.base.slice() : [];
    r.deps.forEach(function (d) {
      if (d.ok === false) {
        var w = d.kind === 'plugin' ? 40 : 35;
        s += w; sig.push('unsat ' + d.dep + ' ' + d.range); return;
      }
      if (d.peer && d.dsh && !d.mounted && !d.inferred && !d.lib) {
        if (d.variant) { s += 10; sig.push('variant ' + d.dep); }
        else { s += 25; sig.push('peer ' + d.dep); }
      }
    });
    state.added.forEach(function (a) {
      a.deps.forEach(function (d) {
        if (d.ok === false) { s += d.kind === 'plugin' ? 40 : 35; sig.push('unsat ' + d.dep); }
      });
    });
    if (r.verified) r.verified.forEach(function (v) { s += v.scoreDelta || 0; });
    if (s > 100) s = 100;
    var sev = s >= 60 ? 'blocking' : s >= 40 ? 'high' : s >= 20 ? 'medium' : 'low';
    return { score: s, severity: sev, sig: sig };
  }

  function compute() {
    var rows = E.rows.map(function (r) {
      var o = scoreOf(r);
      return { id: r.id, pkg: r.pkg, ver: r.ver, layer: r.layer, disabled: !active(r), risk: o.score, severity: o.severity, sig: o.sig, verified: r.verified };
    });
    rows = rows.concat(state.added.map(function (a) {
      var o = scoreOf(a);
      return { id: a.id, pkg: a.name, ver: a.ver, layer: 'simulate', disabled: false, risk: o.score, severity: o.severity, sig: o.sig, verified: [] };
    }));
    var byS = { blocking: 0, high: 0, medium: 0, low: 0, disabled: 0 };
    var sum = 0, max = 0, n = 0;
    rows.forEach(function (r) {
      if (r.disabled) { byS.disabled++; return; }
      byS[r.severity]++; sum += r.risk; n++;
      if (r.risk > max) max = r.risk;
    });
    var avg = n ? Math.round(sum / n * 10) / 10 : 0;
    var health = (byS.blocking > 0 || max >= 60) ? 'D' : (byS.high > 0 || max >= 40) ? 'C' : (avg >= 15 || byS.medium > 3) ? 'B' : 'A';
    return { rows: rows, byS: byS, avg: avg, max: max, health: health, n: n };
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderTable() {
    var c = compute();
    var rows = c.rows.filter(function (r) {
      if (state.sev && r.severity !== state.sev) return false;
      if (state.status === 'disabled' && !r.disabled) return false;
      if (state.status === 'active' && r.disabled) return false;
      if (state.layer && r.layer !== state.layer) return false;
      var q = state.search.toLowerCase();
      if (q && r.id.toLowerCase().indexOf(q) < 0 && r.pkg.toLowerCase().indexOf(q) < 0 && r.ver.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var x = a[key], y = b[key];
      if (typeof x === 'string') { x = x.toLowerCase(); y = String(y).toLowerCase(); }
      var d = x < y ? -1 : x > y ? 1 : 0;
      return d * state.dir;
    });
    var tb = document.querySelector('#tbl tbody');
    var html = '';
    rows.forEach(function (r) {
      var sig = r.sig.length ? r.sig.map(function (s) { return '<div class="ev">• ' + esc(s) + '</div>'; }).join('') : '';
      var ver = r.verified.length ? r.verified.map(function (v) { return '<div class="ev" style="color:#16a085">✔ ' + esc(v.note.slice(0, 130)) + '</div>'; }).join('') : '';
      var on = active(r.id);
      var cb = '<input type="checkbox" class="toggle" data-id="' + r.id + '"' + (on ? ' checked' : '') + '>';
      html += '<tr><td>' + cb + esc(r.id) + '</td><td>' + esc(r.pkg) + '@' + esc(r.ver) + '</td><td>' + esc(r.layer) + '</td><td>' +
        (r.disabled ? '<span class="sev disabled">disabled</span>' : '<span class="sev low">active</span>') + '</td>';
      html += '<td>' + r.risk + '</td><td><span class="sev ' + r.severity + '">' + r.severity + '</span></td><td>' + sig + ver + '</td></tr>';
    });
    tb.innerHTML = html;
    document.getElementById('rowCount').textContent = '显示 ' + rows.length + ' / ' + c.rows.length + ' 行';
    renderSim(c);
  }

  function activeRow(id) {
    var r = E.rows.filter(function (x) { return x.id === id; })[0];
    if (!r) return true;
    if (state.disabled[id]) return false;
    if (r.disabled) return false;
    if (state.removed.indexOf(id) >= 0) return false;
    return true;
  }

  function renderSim(c) {
    var base = E.health;
    var el = document.getElementById('simResult');
    if (!el) return;
    var delta = c.health === base ? '持平' : (c.health > base ? '改善' : '降级');
    var html = '<b>模拟结果：健康度 ' + base + ' → <span class="chg">' + c.health + '</span>（' + delta + '）</b> · 活动 ' + c.n +
      ' 组件 · 平均风险 <span class="chg">' + c.avg + '</span> · 最高 <span class="chg">' + c.max + '</span> · 分布 ' + JSON.stringify(c.byS) + '<br>';
    var off = Object.keys(state.disabled).filter(function (k) { return state.disabled[k]; }).concat(state.removed);
    html += '已禁用/移除：' + (off.join(', ') || '—') + '<br>';
    html += '已添加：' + (state.added.map(function (a) { return a.id + ' (' + a.name + '@' + a.ver + ')'; }).join(', ') || '—');
    el.innerHTML = html;
  }

  function apply() {
    state.search = document.getElementById('q').value;
    state.layer = document.getElementById('fLayer').value;
    state.sev = document.getElementById('fSev').value;
    state.status = document.getElementById('fStatus').value;
    renderTable();
  }
  function sort(k) {
    if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = -1; }
    renderTable();
  }
  function toggle(id) { state.disabled[id] = !state.disabled[id]; renderTable(); }
  function addRow() {
    var v = document.getElementById('simAdd').value;
    if (!v) return;
    var cand = E.candidates.filter(function (c) { return c.name === v; })[0];
    if (!cand) return;
    var id = prompt('row id（默认取包短名）', cand.name.split('/').pop().replace(/^dsh-/, ''));
    if (id === null) return;
    state.added.push({ id: id, name: cand.name, ver: cand.ver, deps: cand.deps });
    renderTable();
    initGraph();
  }
  function removeRow() {
    var v = document.getElementById('simRemove').value;
    if (!v) return;
    state.removed.push(v);
    renderTable();
  }
  function reset() {
    state = { search: '', layer: '', sev: '', status: '', sort: 'risk', dir: -1, disabled: {}, added: [], removed: [] };
    document.getElementById('q').value = '';
    document.getElementById('simAdd').value = '';
    document.getElementById('simRemove').value = '';
    renderTable();
  }

  function switchTab(id) {
    var pages = document.querySelectorAll('.ws-page');
    for (var i = 0; i < pages.length; i++) pages[i].classList.toggle('active', pages[i].id === id);
    var tabs = document.querySelectorAll('.ws-tab');
    for (var j = 0; j < tabs.length; j++) tabs[j].classList.toggle('active', tabs[j].getAttribute('data-page') === id);
    if (id === 'page-graph') { var gh = document.getElementById('dshGraph'); if (gh && G && G.model) { fitView(gh); renderGraphInto(gh, G.model); } }
  }

  document.addEventListener('DOMContentLoaded', function () {
    applySkin(currentSkin());
    var tabs = document.querySelectorAll('.ws-tab');
    for (var i = 0; i < tabs.length; i++) {
      (function (el) {
        el.addEventListener('click', function () { switchTab(el.getAttribute('data-page')); });
      })(tabs[i]);
    }
    fillLayers();
    var ths = document.querySelectorAll('#tbl th');
    ths.forEach(function (th) { th.addEventListener('click', function () { sort(th.getAttribute('data-k')); }); });
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains('toggle')) toggle(t.getAttribute('data-id'));
    });
    renderTable();
    initGraph();
  });

  function toggleFbGroup(btn) {
    var items = btn.parentNode ? btn.parentNode.querySelector('.fb-items') : null;
    if (!items) return;
    var show = items.style.display === 'none';
    items.style.display = show ? 'block' : 'none';
    btn.textContent = show ? '收起' : '展开';
  }

  // Dynamic (live) mode: re-fetch analysis from the server and re-render.
  // In offline/static snapshots the refresh button does not exist, so this is
  // a graceful no-op and the page keeps its embedded facts.
  function refresh() {
    var btn = document.getElementById('refreshBtn');
    var badge = document.getElementById('liveBadge');
    var msg = document.getElementById('refreshMsg');
    if (btn) { btn.disabled = true; btn.textContent = '刷新中…'; }
    if (msg) msg.textContent = '';
    fetch('/api/refresh').then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok || !d.data) throw new Error((d && d.error) || 'refresh failed');
      E = d.data;
      state = { search: '', layer: '', sev: '', status: '', sort: 'risk', dir: -1, disabled: {}, added: [], removed: [] };
      var meta = document.getElementById('metaLine');
      var foot = document.getElementById('footLine');
      if (meta) meta.textContent = 'dsh-forge v' + (window.__DSH_VERSION__ || '?') + ' · 生成于 ' + E.generatedAt + ' · ' + E.sourceLabel + ' · 只读，模拟不落盘';
      if (foot) foot.textContent = '生成于 ' + E.generatedAt + ' · ' + E.sourceLabel + ' · 静态分析 + 运行期源码验证 · 只读工具，不修改任何组合';
      if (badge) badge.classList.remove('stale');
      fillLayers();
      renderTable();
      initGraph();
      if (msg) msg.textContent = '已刷新 · ' + E.generatedAt;
    }).catch(function (err) {
      if (msg) msg.textContent = '刷新失败：' + err.message;
      if (badge) badge.classList.add('stale');
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = '↻ 刷新'; }
    });
  }

  var skinCache = 'light';
  function currentSkin() {
    try { var v = window.localStorage.getItem('dsh-skin'); if (v === 'light' || v === 'dark') return v; } catch (e) { }
    return skinCache;
  }
  function applySkin(skin) { var root = document.documentElement; if (root) root.setAttribute('data-skin', skin); }
  function toggleSkin() {
    var next = currentSkin() === 'dark' ? 'light' : 'dark';
    skinCache = next;
    try { window.localStorage.setItem('dsh-skin', next); } catch (e) { }
    applySkin(next);
  }

  // ── Interactive dependency graph (knowledge-graph style) ──────────────
  // Overview shows only the 'main' relationship edges (the composed-plugin
  // backbone + synthetic forge-ui→forge) to keep rendering light; library
  // edges appear on click. When edge density is high, auto-degrades: non-
  // critical edges fade out / get filtered. Scroll to zoom, drag to pan.
  // Clicking a node fills the right panel with its 前置(→) & 后置(←).
  var G = { model: null, selected: null, tx: 0, ty: 0, k: 1, wired: false, moved: false, sparse: null };
  var SEV_C = { blocking: '#d64545', high: '#e67e22', medium: '#f1c40f', low: '#27ae60', disabled: '#95a5a6' };
  var SEV_R = { blocking: 5, high: 4, medium: 3, low: 2, disabled: 1 };
  var GW = 172, GH = 40, EXT_W = 150, EXT_H = 26, M = 92, TOP = 40;

  function graphModel() {
    var byPkg = {}, order = [];
    E.rows.forEach(function (r) {
      var g = byPkg[r.pkg];
      if (!g) { byPkg[r.pkg] = { pkg: r.pkg, layer: r.layer, sev: r.severity || 'low', disabled: r.disabled === true, rows: [r.id] }; order.push(r.pkg); }
      else { g.rows.push(r.id); if (r.disabled === true) g.disabled = true; if (SEV_R[r.severity] && SEV_R[r.severity] > SEV_R[g.sev]) g.sev = r.severity; }
    });
    // Simulated components added via 假设模拟 also appear in the graph.
    state.added.forEach(function (a) {
      if (a.name == null || a.name === '') return;
      var g = byPkg[a.name];
      if (g) { if (g.rows.indexOf(a.id) < 0) g.rows.push(a.id); }
      else { byPkg[a.name] = { pkg: a.name, layer: a.layer || 'simulate', sev: 'low', disabled: false, rows: [a.id] }; order.push(a.name); }
    });
    var plugin = {}; order.forEach(function (p) { plugin[p] = true; });
    var extOrder = [], extSeen = {};
    var edges = [], emap = {};
    function addEdge(from, to, d) {
      if (from === to) return;
      var key = from + '\u0001' + to;
      if (emap[key]) { if (d.ok === false) emap[key].sat = false; return; }
      emap[key] = { sat: d.ok !== false };
      edges.push({ from: from, to: to, range: d.range, sat: d.ok !== false, peer: !!d.peer, fake: !!d.fake });
    }
    E.rows.forEach(function (r) {
      r.deps.forEach(function (d) {
        if (!byPkg[d.dep] && !extSeen[d.dep]) { extSeen[d.dep] = true; extOrder.push(d.dep); }
        addEdge(r.pkg, d.dep, d);
      });
    });
    state.added.forEach(function (a) {
      if (a.name == null || a.name === '') return;
      var ds = (a.deps && a.deps.length) ? a.deps : [];
      ds.forEach(function (d) {
        if (!byPkg[d.dep] && !extSeen[d.dep]) { extSeen[d.dep] = true; extOrder.push(d.dep); }
        addEdge(a.name, d.dep, d);
      });
    });
    addEdge('dsh-forge-ui', 'dsh-forge', { range: 'forge-ui 可视化 forge 分析', fake: true });
    return { byPkg: byPkg, order: order, extOrder: extOrder, edges: edges, plugin: plugin };
  }

  function edgeScore(e, model) {
    if (e.sat === false) return 100;
    if (e.fake) return 80;
    if (model.plugin[e.from] && model.plugin[e.to]) return 60;
    if (model.plugin[e.from] || model.plugin[e.to]) return 35;
    return 15;
  }

  function adaptiveFilter(edges, model) {
    var total = edges.length;
    var critical = edges.filter(function (e) { return e.sat === false || e.fake; });
    var backbone = edges.filter(function (e) { return !e.sat && !e.fake && model.plugin[e.from] && model.plugin[e.to]; });
    var medium = edges.filter(function (e) { return !e.sat && !e.fake && (model.plugin[e.from] || model.plugin[e.to]) && !(model.plugin[e.from] && model.plugin[e.to]); });
    var liblib = edges.filter(function (e) { return !e.sat && !e.fake && !model.plugin[e.from] && !model.plugin[e.to]; });
    var density = 0;
    var visible;
    if (total <= 200) {
      visible = edges.slice();
      density = 0;
    } else if (total <= 350) {
      visible = critical.concat(backbone, medium, liblib);
      density = 1;
    } else {
      visible = critical.concat(backbone);
      density = 2;
    }
    G.sparse = density;
    return { edges: visible, density: density };
  }

  function importantEdge(e, model) {
    return e.fake === true || model.plugin[e.to] === true || e.sat === false;
  }

  function layoutGraph(model) {
    var ci = {}, colOrder = [];
    model.order.forEach(function (pkg) {
      var l = model.byPkg[pkg].layer;
      if (ci[l] === undefined) { ci[l] = colOrder.length; colOrder.push(l); }
    });
    var perCol = colOrder.map(function () { return []; });
    model.order.forEach(function (pkg) { perCol[ci[model.byPkg[pkg].layer]].push(pkg); });
    var yat = colOrder.map(function () { return 0; });
    var maxRows = 0;
    model.order.forEach(function (pkg) {
      var g = model.byPkg[pkg], c = ci[g.layer];
      g.x = M + c * (GW + M); g.y = TOP + yat[c] * (GH + 8); g.ext = false;
      yat[c]++; if (yat[c] > maxRows) maxRows = yat[c];
    });
    var pluginBottom = TOP + maxRows * (GH + 8);
    var perRow = 9;
    model.extOrder.forEach(function (dep, i) {
      var g = { pkg: dep, ext: true, sev: 'low', disabled: false, rows: [] };
      g.x = M + (i % perRow) * (EXT_W + 12);
      g.y = pluginBottom + 60 + Math.floor(i / perRow) * (EXT_H + 8);
      model.byPkg[dep] = g;
    });
    var extRows = Math.ceil(model.extOrder.length / perRow);
    model.svgW = M + colOrder.length * (GW + M) + M;
    model.svgH = pluginBottom + 60 + extRows * (EXT_H + 8) + 44;
  }

  function shortName(pkg) { return String(pkg).split('/').pop(); }

  function edgePath(from, to, byPkg) {
    var s = byPkg[from], t = byPkg[to];
    if (!s || !t) return '';
    var a = { x: s.x + (s.ext ? EXT_W : GW), y: s.y + (s.ext ? EXT_H : GH) / 2 };
    var b = { x: t.x, y: t.y + (t.ext ? EXT_H : GH) / 2 };
    var mx = (a.x + b.x) / 2;
    return 'M' + a.x + ' ' + a.y + ' C' + mx + ' ' + a.y + ',' + mx + ' ' + b.y + ',' + b.x + ' ' + b.y;
  }

  function edgeMarkup(e, model, selected, focused, incoming, density) {
    var byPkg = model.byPkg;
    var p = edgePath(e.from, e.to, byPkg);
    if (!p || e.from === e.to) return '';
    var color = '#9aa3ac', op = 0.12, w = 1, label = false, arrow = false;
    if (selected) {
      if (focused) { color = incoming ? '#1f8a5a' : '#1f6feb'; op = 1; w = 2.2; label = true; arrow = true; }
      else { color = '#9aa3ac'; op = 0.03; w = 1; }
    } else if (e.fake) {
      color = '#b5bac1'; op = 0.35; w = 1.2;
    }
    if (!selected && density >= 1 && !e.sat && !e.fake) {
      op = Math.max(0.04, op * 0.5);
      w = 0.8;
      if (density >= 2) { op = 0.025; w = 0.6; }
    }
    var s = '<path d="' + p + '" fill="none" stroke="' + color + '" stroke-opacity="' + op + '" stroke-width="' + w + '"' +
      (e.sat === false ? ' stroke-dasharray="5,4"' : '') + (arrow ? ' marker-end="url(#arrow-att)"' : '') + '></path>';
    if (label) {
      var a = byPkg[e.from], b = byPkg[e.to];
      var aw = a ? (a.ext ? EXT_W : GW) : GW, bh = b ? (b.ext ? EXT_H : GH) : GH;
      var mx = ((a.x + aw) + b.x) / 2;
      var my = ((a.y + (a.ext ? EXT_H : GH) / 2) + (b.y + bh / 2)) / 2;
      s += '<text x="' + mx + '" y="' + (my - 4) + '" font-size="9" fill="' + color + '" text-anchor="middle">' + esc(e.range) + '</text>';
    }
    return s;
  }

  // Truncate a text string to fit within maxWidth pixels at fontPx.
  // Uses conservative char-width estimate (~fontPx * 0.55 for mixed CJK/latin).
  function fitText(str, fontPx, maxWidth) {
    var approxCharW = fontPx * 0.58;
    var maxChars = Math.max(1, Math.floor(maxWidth / approxCharW));
    var s = String(str);
    if (s.length <= maxChars) return s;
    if (maxChars <= 1) return s.slice(0, 1);
    return s.slice(0, maxChars - 1) + '…';
  }

  function nodeMarkup(g, selected, rel, clipDefs) {
    var w = g.ext ? EXT_W : GW, h = g.ext ? EXT_H : GH;
    var color = g.ext ? '#8a93a1' : (SEV_C[g.sev] || '#27ae60');
    var fillop = g.ext ? 0.12 : 0.16;
    var dim = selected && g.pkg !== selected && !rel.out[g.pkg] && !rel.in[g.pkg];
    if (dim) fillop = 0.025;
    var dash = g.disabled ? ' stroke-dasharray="3,2"' : '';
    var label = g.ext ? shortName(g.pkg) : (shortName(g.pkg) + ' · ' + (g.layer || ''));
    var op = dim ? ' opacity="0.35"' : '';
    var title = esc(g.pkg) + ((g.rows && g.rows.length) ? ' rows: ' + esc(g.rows.join(', ')) : '');
    var padX = 6, padRight = 4;
    var availW = Math.max(4, w - padX - padRight);
    var fontPx = g.ext ? 10 : 11;
    var displayLabel = fitText(label, fontPx, availW);
    var clipId = 'clip-node-' + clipDefs.length;
    clipDefs.push('<clipPath id="' + clipId + '"><rect width="' + w + '" height="' + h + '"></rect></clipPath>');
    return '<g class="g-node" data-pkg="' + esc(g.pkg) + '" transform="translate(' + g.x + ',' + g.y + ')"' + op + '>' +
      '<rect width="' + w + '" height="' + h + '" rx="6" fill="' + color + '" fill-opacity="' + fillop + '" stroke="' + color + '" stroke-width="1.2"' + dash + '></rect>' +
      '<g clip-path="url(#' + clipId + ')"><text x="' + padX + '" y="' + (h / 2 + 3) + '" font-size="' + fontPx + '" fill="' + color + '">' + esc(displayLabel) + '</text></g>' +
      '<title>' + title + '</title></g>';
  }

  function relation(model) {
    var out = {}, in_ = {};
    model.edges.forEach(function (e) {
      if (e.from === G.selected) out[e.to] = true;
      if (e.to === G.selected) in_[e.from] = true;
    });
    return { out: out, in: in_ };
  }

  function escDetail(s) { return esc(s); }

  function renderDetail(selected, model, edgeSelLen, density) {
    var el = document.getElementById('gDetail');
    if (!el) return;
    if (!selected) {
      var note = '';
      if (density === 1) note = '<p class="ev" style="color:#e67e22">密度自适应：边数较多，已淡化非关键边以保证流畅</p>';
      if (density === 2) note = '<p class="ev" style="color:#d64545">密度自适应：边数过多，已过滤插件→外部库边以保证流畅。点击节点可查看完整依赖</p>';
      el.innerHTML = '<h4>依赖图谱 · 总览</h4>' +
        '<p class="meta">当前显示 <b>' + model.order.length + '</b> 个组合插件包 · <b>' + model.extOrder.length + '</b> 个外部库包 · <b>' + model.edges.length + '</b> 条依赖边。</p>' +
        '<p class="meta">总览仅保留<b>组合插件主干</b>关系线（' + edgeSelLen + ' 条）。滚轮缩放、拖拽平移；点击任意节点，在右侧查看其<b>前置依赖</b>(→, 它需要什么)与<b>后置依赖</b>(←, 谁需要它)。点空白或「重置」返回总览。</p>' +
        note +
        '<p class="ev">颜色：插件包=风险级色 · 外部库=灰 · 灰虚线=forge-ui↔forge 关联 · 红虚线=未满足</p>';
      return;
    }
    var pre = [], dep = [];
    model.edges.forEach(function (e) {
      if (e.from === selected) pre.push({ other: e.to, range: e.range, sat: e.sat, fake: e.fake });
      if (e.to === selected) dep.push({ other: e.from, range: e.range, sat: e.sat, fake: e.fake });
    });
    function row(a, t) { return '<li>' + escDetail(a.other) + ' <span class="ev">' + escDetail(a.range) + (a.sat === false ? ' ✗' : '') + '</span></li>'; }
    el.innerHTML = '<h4>' + escDetail(selected) + '</h4>' +
      '<div class="pre"><b>前置依赖（它需要 →）：' + pre.length + '</b></div><ul>' + (pre.map(function (a) { return row(a, 'pre'); }).join('') || '<li class="ev">无</li>') + '</ul>' +
      '<div class="post"><b>后置依赖（← 谁需要它）：' + dep.length + '</b></div><ul>' + (dep.map(function (a) { return row(a, 'post'); }).join('') || '<li class="ev">无</li>') + '</ul>';
  }

  function applyView() {
    var host = document.getElementById('dshGraph');
    if (!host) return;
    var vp = host.querySelector('#vp');
    if (vp && vp.setAttribute) vp.setAttribute('transform', 'translate(' + G.tx + ',' + G.ty + ') scale(' + G.k + ')');
  }
  function zoomAt(px, py, f) {
    var k = Math.min(6, Math.max(0.05, G.k * f));
    G.tx = px - (px - G.tx) * (k / G.k);
    G.ty = py - (py - G.ty) * (k / G.k);
    G.k = k; applyView();
  }
  function fitView(host) {
    var w = host.clientWidth || 800, h = host.clientHeight || 600;
    G.k = Math.min(w / G.model.svgW, h / G.model.svgH, 1.2); if (G.k < 0.05) G.k = 0.05;
    G.tx = (w - G.model.svgW * G.k) / 2; G.ty = (h - G.model.svgH * G.k) / 2;
  }

  function renderGraphInto(host, model) {
    var rel = G.selected ? relation(model) : { out: {}, in: {} };
    var density = 0;
    var edgesSel;
    if (G.selected) {
      edgesSel = model.edges;
    } else {
      var adapted = adaptiveFilter(model.edges, model);
      edgesSel = adapted.edges;
      density = adapted.density;
    }
    var parts = [];
    var clipDefs = [];
    parts.push('<svg id="gSvg" width="100%" height="100%" style="display:block" preserveAspectRatio="xMidYMid meet">');
    parts.push('<defs><marker id="arrow-att" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#1f6feb"></path></marker></defs>');
    parts.push('<rect width="100%" height="100%" fill="transparent"></rect>');
    parts.push('<g id="vp">');
    edgesSel.forEach(function (e) {
      var focused = false, incoming = false;
      if (G.selected) { if (e.from === G.selected) { focused = true; } else if (e.to === G.selected) { focused = true; incoming = true; } }
      parts.push(edgeMarkup(e, model, G.selected, focused, incoming, density));
    });
    model.order.forEach(function (pkg) { parts.push(nodeMarkup(model.byPkg[pkg], G.selected, rel, clipDefs)); });
    model.extOrder.forEach(function (dep) { var g = model.byPkg[dep]; if (g && g.ext) parts.push(nodeMarkup(g, G.selected, rel, clipDefs)); });
    // Merge clipPath defs into the existing marker <defs> (single defs).
    if (clipDefs.length > 0) {
      parts[1] = parts[1].replace('</defs>', '' + clipDefs.join('') + '</defs>');
    }
    parts.push('</g></svg>');
    host.innerHTML = parts.join('');
    renderDetail(G.selected, model, edgesSel.length, density);
    host.onwheel = function (e) { e.preventDefault(); var w = host.clientWidth || 800, h = host.clientHeight || 600; var rect = host.getBoundingClientRect ? host.getBoundingClientRect() : null; var px = rect ? (e.clientX - rect.left) : w / 2; var py = rect ? (e.clientY - rect.top) : h / 2; zoomAt(px, py, e.deltaY < 0 ? 1.15 : 0.87); };
    host.onmousedown = function (e) { G.dragging = true; G.moved = false; G.sx = e.clientX; G.sy = e.clientY; G.ox = G.tx; G.oy = G.ty; };
    host.onclick = function (e) {
      if (G.moved) return;
      var t = e.target, pkg = null;
      while (t && t !== host) { if (t.getAttribute && t.getAttribute('data-pkg')) { pkg = t.getAttribute('data-pkg'); break; } t = t.parentNode; }
      G.selected = pkg ? (G.selected === pkg ? null : pkg) : null;
      renderGraphInto(host, G.model);
    };
    applyView();
  }

  function wireZoomButtons() {
    function waitHost() { return document.getElementById('dshGraph'); }
    var zi = document.getElementById('gZoomIn'), zo = document.getElementById('gZoomOut'), zr = document.getElementById('gZoomReset');
    if (zi) zi.onclick = function () { var host = waitHost(); if (!host) return; var w = host.clientWidth || 800, h = host.clientHeight || 600; zoomAt(w / 2, h / 2, 1.25); };
    if (zo) zo.onclick = function () { var host = waitHost(); if (!host) return; var w = host.clientWidth || 800, h = host.clientHeight || 600; zoomAt(w / 2, h / 2, 0.8); };
    if (zr) zr.onclick = function () { var host = waitHost(); if (!host || !G.model) return; G.selected = null; fitView(host); renderGraphInto(host, G.model); };
    document.addEventListener('mousemove', function (e) { if (!G.dragging) return; var dx = e.clientX - G.sx, dy = e.clientY - G.sy; if (Math.abs(dx) > 2 || Math.abs(dy) > 2) G.moved = true; G.tx = G.ox + dx; G.ty = G.oy + dy; applyView(); });
    document.addEventListener('mouseup', function () { G.dragging = false; });
  }

  function initGraph() {
    var host = document.getElementById('dshGraph');
    if (!host || typeof host.querySelector !== 'function') return;
    G.model = graphModel(); layoutGraph(G.model);
    G.selected = null;
    fitView(host);
    renderGraphInto(host, G.model);
    if (!G.wired) { G.wired = true; wireZoomButtons(); }
  }

  window.__DSH_APP__ = { apply: apply, addRow: addRow, removeRow: removeRow, reset: reset, toggle: toggle, toggleFbGroup: toggleFbGroup, refresh: refresh, toggleSkin: toggleSkin, state: state };
})();