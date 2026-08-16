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
  }

  document.addEventListener('DOMContentLoaded', function () {
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
  });

  function toggleFbGroup(btn) {
    var items = btn.parentNode ? btn.parentNode.querySelector('.fb-items') : null;
    if (!items) return;
    var show = items.style.display === 'none';
    items.style.display = show ? 'block' : 'none';
    btn.textContent = show ? '收起' : '展开';
  }

  window.__DSH_APP__ = { apply: apply, addRow: addRow, removeRow: removeRow, reset: reset, toggle: toggle, toggleFbGroup: toggleFbGroup, state: state };
})();