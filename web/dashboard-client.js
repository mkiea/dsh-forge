// dsh-forge/web/dashboard-client.js
// Injected into the dashboard page by core/dashboard.js (self-contained).
// ES5 style, no template literals. Reads window.__DSH__ (embedded JSON).
/*jshint esversion: 6 */
(function () {
  'use strict';
  var E = window.__DSH__;
  var state = { search: '', layer: '', sev: '', status: '', sort: 'risk', dir: -1, disabled: {}, added: [], removed: [] };

  // The dashboard is also embedded as a srcDoc iframe by the desktop harness.
  // In such a document `location.protocol` is not http(s), so a relative
  // "/api/..." request resolves against the app origin and every live call
  // (SSE auto-update, bridge scan, snapshot/update) silently fails. Pin those
  // requests to the local data channel unless this page was served over http.
  var API_BASE = (function () {
    var proto = "";
    try { proto = String((window.location && window.location.protocol) || ""); } catch (e) { proto = ""; }
    if (proto === "http:" || proto === "https:") return "";
    var pinned = typeof window.__DSH_API__ === "string" ? window.__DSH_API__ : "";
    return pinned || "http://127.0.0.1:3060";
  })();
  function api(p) { return API_BASE + p; }

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

  // '*' accepts any version; harness packages are prerelease-only, so npm's
  // prerelease exclusion would otherwise flag every '*' dependency as unsat.
  function wildcard(range) {
    var t = String(range == null ? '' : range).trim();
    return t === '' || t === '*' || /^[xX]$/.test(t);
  }

  function scoreOf(r) {
    if (!active(r)) return { score: 0, severity: 'disabled', sig: [] };
    var s = r.baseScore || 0;
    var sig = r.base ? r.base.slice() : [];
    r.deps.forEach(function (d) {
      if (d.ok === false && !wildcard(d.range)) {
        var w = d.kind === 'plugin' ? 40 : 35;
        s += w; sig.push('unsat ' + d.dep + ' ' + d.range); return;
      }
      // A partial scan cannot see the composed runtime, so peer-mount claims
      // are unprovable there (the server skips them for the same reason).
      if (!E.partial && d.peer && d.dsh && !d.mounted && !d.inferred && !d.lib) {
        if (d.variant) { s += 10; sig.push('variant ' + d.dep); }
        else if (!d.installed) { s += 25; sig.push('peer ' + d.dep); }
      }
    });
    state.added.forEach(function (a) {
      a.deps.forEach(function (d) {
        if (d.ok === false && !wildcard(d.range)) { s += d.kind === 'plugin' ? 40 : 35; sig.push('unsat ' + d.dep); }
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
      var sig = r.sig.length ? r.sig.map(function (s) { return '<div class="ev">• ' + esc(s) + '</div>'; }).join('') : '<span class="ev">—</span>';
      var ver = r.verified.length ? r.verified.map(function (v) { return '<div class="ev" style="color:var(--dsh-sevVerified)">✔ ' + esc(v.note.slice(0, 130)) + '</div>'; }).join('') : '';
      var on = active(r.id);
      var cb = '<input type=checkbox class=toggle data-id=' + r.id + (on ? ' checked' : '') + '>';
      var status = r.disabled ? '<span class="st disabled">disabled</span>' : '<span class="st active">active</span>';
      var pct = r.disabled ? 0 : Math.min(100, Math.round(r.risk));
      html += '<tr><td class="sc-' + r.severity + '"><label class="idwrap">' + cb + '<span>' + esc(r.id) + '</span></label></td>' +
        '<td><div class="pkg">' + esc(r.pkg) + '</div><div class="pkgver">@' + esc(r.ver) + '</div></td>' +
        '<td><span class="chip">' + esc(r.layer) + '</span></td><td>' + status + '</td>' +
        '<td class="n"><span>' + r.risk + '</span><div class="riskbar"><i class="rb-' + r.severity + '" style="width:' + pct + '%"></i></div></td>' +
        '<td><span class="sev ' + r.severity + '">' + r.severity + '</span></td><td>' + sig + ver + '</td></tr>';
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
    var off = Object.keys(state.disabled).filter(function (k) { return state.disabled[k]; }).concat(state.removed);
    var html = '<b>模拟结果：健康度 ' + base + ' → <span class="chg">' + c.health + '</span>（' + delta + '）</b>' +
      '<div class="sim-metrics"><span>活动组件 <b>' + c.n + '</b></span><span>平均风险 <b>' + c.avg + '</b></span>' +
      '<span>最高风险 <b>' + c.max + '</b></span><span>分布 <b>' + esc(JSON.stringify(c.byS)) + '</b></span></div>' +
      '<div class="ev">已禁用/移除：' + esc(off.join(', ') || '—') + '</div>' +
      '<div class="ev">已添加：' + esc(state.added.map(function (a) { return a.id + ' (' + a.name + '@' + a.ver + ')'; }).join(', ') || '—') + '</div>';
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
    G.pos = {}; savePositions();
    renderTable();
    initGraph();
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
    renderHistory();
    bindOps();
    syncAutoBtn();
    if (document.getElementById('refreshBtn')) {
      try { startAuto(); } catch (e) { autoState('自动更新：不可用（缺少定时器/SSE）', false); }
    }
  });

  function bindOps() {
    var map = {
      opsAutoToggle: toggleAuto,
      opsCheckBtn: opsCheckVersions,
      opsArchiveBtn: opsArchive,
      opsSimBtn: opsSimulate,
      opsSimEmpty: function () { var ta = document.getElementById('opsSimInput'); if (ta) ta.value = ''; var o = document.getElementById('opsSimOut'); if (o) o.style.display = 'none'; },
      opsUpgradeBtn: opsUpgrade,
      opsPlanBtn: opsPlan,
      opsApplyBtn: opsApply,
      bridgeLoadBtn: loadBridge
    };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', map[id]);
    });
    if (!document.addEventListener) return;
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && autoUpdate.enabled && !autoUpdate.source && !autoUpdate.timer) startAuto();
      else if (!document.hidden) refresh(true);
    });
  }

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
  // Swap in a freshly analysed embeddable dataset. `keepState` preserves the
  // user's filters / simulated ops (auto-update), a manual refresh resets them.
  function applyData(d, keepState) {
    E = d;
    if (!keepState) state = { search: '', layer: '', sev: '', status: '', sort: 'risk', dir: -1, disabled: {}, added: [], removed: [] };
    var meta = document.getElementById('metaLine');
    var foot = document.getElementById('footLine');
    if (meta) meta.textContent = 'dsh-forge v' + (window.__DSH_VERSION__ || '?') + ' · 生成于 ' + E.generatedAt + ' · ' + E.sourceLabel + ' · 只读，模拟不落盘';
    if (foot) foot.textContent = '生成于 ' + E.generatedAt + ' · ' + E.sourceLabel + ' · 静态分析 + 运行期源码验证 · 只读工具，不修改任何组合';
    fillLayers();
    var fl = document.getElementById('fLayer');
    if (fl) fl.value = state.layer || '';
    renderTable();
    initGraph();
    renderHistory();
  }

  function renderHistory() {
    var body = document.getElementById('opsHistoryBody');
    if (!body) return;
    var hs = E.history || [];
    var html = '';
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      html += '<tr><td>' + (i + 1) + '</td><td>' + esc(h.collectedAt || '—') + '</td><td>' + (h.rows == null ? '—' : h.rows) + '</td><td>' + esc(h.harnessVersion || '—') + '</td><td>' + esc(h.source || '—') + '</td></tr>';
    }
    body.innerHTML = html || '<tr><td colspan="5">无快照数据</td></tr>';
  }

  function refresh(keepState) {
    var btn = document.getElementById('refreshBtn');
    var badge = document.getElementById('liveBadge');
    var msg = document.getElementById('refreshMsg');
    if (btn) { btn.disabled = true; btn.textContent = '刷新中…'; }
    if (msg && !keepState) msg.textContent = '';
    fetch(api('/api/refresh')).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok || !d.data) throw new Error((d && d.error) || 'refresh failed');
      applyData(d.data, keepState === true);
      if (badge) badge.classList.remove('stale');
      if (msg && !keepState) msg.textContent = '已刷新 · ' + E.generatedAt;
    }).catch(function (err) {
      if (msg && !keepState) msg.textContent = '刷新失败：' + err.message;
      if (badge) badge.classList.add('stale');
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = '↻ 刷新'; }
    });
  }

  // ── automatic update: SSE signature watch (harness web hot-update aware) ──
  var AUTO_KEY = 'dsh-forge-auto';
  var autoUpdate = { enabled: true, source: null, timer: null, interval: 15000 };
  try { autoUpdate.enabled = window.localStorage.getItem(AUTO_KEY) !== '0'; } catch (e) { }

  function autoState(text, stale) {
    var el = document.getElementById('opsAutoState');
    if (el) el.textContent = text;
    var badge = document.getElementById('liveBadge');
    if (badge && stale) badge.classList.add('stale');
  }
  function syncAutoBtn() {
    var btn = document.getElementById('opsAutoToggle');
    if (btn) btn.textContent = '自动更新：' + (autoUpdate.enabled ? '开' : '关');
  }
  function stopAuto() {
    if (autoUpdate.source) { try { autoUpdate.source.close(); } catch (e) { } autoUpdate.source = null; }
    if (autoUpdate.timer) { clearInterval(autoUpdate.timer); autoUpdate.timer = null; }
    autoState('自动更新：已暂停', false);
  }
  function startAuto() {
    stopAuto();
    syncAutoBtn();
    if (!autoUpdate.enabled) { autoState('自动更新：关', false); return; }
    if (window.EventSource) {
      try {
        var es = new EventSource(api('/api/events'));
        es.onmessage = function (ev) {
          var m = null;
          try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (!m) return;
          if (m.type === 'update' && m.data) {
            applyData(m.data, true);
            autoState('自动更新：已重算 · ' + (m.changedAt || E.generatedAt), false);
            var b = document.getElementById('liveBadge');
            if (b) b.classList.remove('stale');
          } else if (m.type === 'hello') {
            autoState('自动更新：SSE 已连接 · ' + String(m.signature || '').slice(0, 8), false);
          } else if (m.type === 'error') {
            autoState('自动更新：重算失败 · ' + m.error, true);
          }
        };
        es.onerror = function () {
          autoState('自动更新：SSE 断开，改用轮询', true);
          try { es.close(); } catch (e) { }
          autoUpdate.source = null;
          startPoll();
        };
        autoUpdate.source = es;
        return;
      } catch (e) { /* fall through to polling */ }
    }
    startPoll();
  }
  function startPoll() {
    if (autoUpdate.timer || typeof setInterval !== "function") return;
    autoState('自动更新：轮询 ' + (autoUpdate.interval / 1000) + 's', false);
    autoUpdate.timer = setInterval(function () {
      if (document.hidden) return;
      refresh(true);
    }, autoUpdate.interval);
  }
  function toggleAuto() {
    autoUpdate.enabled = !autoUpdate.enabled;
    try { window.localStorage.setItem(AUTO_KEY, autoUpdate.enabled ? '1' : '0'); } catch (e) { }
    syncAutoBtn();
    if (autoUpdate.enabled) startAuto(); else stopAuto();
  }

  // ── ops page: real snapshot history, simulate, upgrade, guarded update ──
  function postJSON(path, body) {
    return fetch(api(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(function (r) { return r.json(); });
  }
  function outHtml(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  function outText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  // Every live call shares the same failure story: the panel is open but the
  // 3060 data channel is unreachable (server not started, or the desktop shell
  // served an embedded snapshot). Say so instead of a bare "failed".
  function apiError(e) {
    var msg = String((e && e.message) || e || 'unknown');
    return '<div class="ops-alert">数据通道不可用：' + esc(msg) +
      '<br>请确认 <code>dsh-forge web</code> 正在运行（默认 http://127.0.0.1:3060），然后在「快照 / 刷新」里重试。</div>';
  }
  function verChip(v, cur) {
    if (!v) return '<span class="chip">未知</span>';
    if (v.networkError) return '<span class="chip blocking">仓库不可达</span>';
    if (v.newer) return '<span class="chip accent">可升级</span>';
    var st = String(v.status || '');
    if (st === 'local-ahead') return '<span class="chip">本地领先</span>';
    if (st === 'current' || st === 'up-to-date' || (v.latest && cur === v.latest)) return '<span class="chip">最新</span>';
    if (!v.latest) return '<span class="chip">无 latest 标记</span>';
    return '<span class="chip">' + esc(st || '—') + '</span>';
  }
  // One-line explanation so a bare "→ ?" never appears without a reason.
  function verNote(x) {
    var v = x.v || {};
    if (v.networkError) return '仓库不可达，未能获取最新版本；可稍后重试或检查网络/代理。';
    if (!v.latest) return 'registry 没有 latest 标记（该包可能只发布预发布版，dist-tag 未指向稳定版），无法自动比较。';
    if (String(v.status || '') === 'local-ahead') return '本地版本高于 registry latest（' + v.latest + '），无需升级；命令中的版本仅供参考。';
    if (v.newer) return '可升级：' + x.cmd;
    return '已是最新版本。';
  }
  function opsCheckVersions() {
    outText('opsUpdateState', '检查中…');
    fetch(api('/api/state?versions=1')).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || 'state failed');
      var v = d.versions || {};
      var f = v.forge || {}, h = v.harness || {};
      var newer = !!(f.newer || h.newer);
      outText('opsUpdateState', newer ? '有 ' + ((f.newer ? 1 : 0) + (h.newer ? 1 : 0)) + ' 个可升级目标' : '没有可升级目标');
      var rows = [
        { name: 'dsh-forge', v: f, cur: d.forgeVersion, cmd: (f.commands && f.commands.plugin) || 'npm i -D dsh-forge@latest' },
        { name: 'dsh（harness）', v: h, cur: d.harnessVersion, cmd: (h.commands && h.commands.npx) || 'npx @deepseek-ai/dsh@latest' }
      ];
      var html = rows.map(function (x) {
        var flow = (x.v.latest && x.v.latest !== x.cur)
          ? esc(x.cur || '—') + ' <span class="ev">→</span> ' + esc(x.v.latest)
          : esc(x.cur || '—');
        return '<div class="vrow"><div class="vname">' + esc(x.name) + '</div>' +
          '<div class="vflow">' + flow + '</div>' +
          verChip(x.v, x.cur) +
          (x.v.registry ? '<span class="chip mono">' + esc(x.v.registrySource === 'fallback' ? '镜像' : '主 registry') + '</span>' : '') +
          '<div class="vcmd">' + esc(verNote(x)) + '</div></div>';
      }).join('');
      if (f.checkedAt || h.checkedAt) html += '<div class="ops-note">检查时间 · ' + esc(f.checkedAt || h.checkedAt) + '</div>';
      outHtml('opsVersionOut', html);
    }).catch(function (e) {
      outText('opsUpdateState', '检查失败');
      outHtml('opsVersionOut', apiError(e));
    });
  }
  // Bridge: compare the web profile with the desktop app archive using the
  // same engine. Live-only; the server caches the scan briefly.
  function chipList(items) {
    var list = items || [];
    if (!list.length) return '<span class="ev">无</span>';
    var max = 40;
    var html = list.slice(0, max).map(function (x) { return '<span class="chip mono">' + esc(x) + '</span>'; }).join('');
    if (list.length > max) html += '<span class="chip">另 ' + (list.length - max) + ' 个</span>';
    return '<div class="ops-kv">' + html + '</div>';
  }
  function loadBridge() {
    var st = document.getElementById('bridgeState');
    outText('bridgeState', '扫描中…');
    outHtml('bridgeOut', '');
    fetch(api('/api/bridge?refresh=1')).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok || !d.bridge) throw new Error((d && d.error) || 'bridge failed');
      var b = d.bridge;
      var html = '<div class="panel"><div class="panel-head"><div><h3 style="margin:0">本机 profile</h3>' +
        '<div class="panel-sub">同一引擎采集 Web profile 与桌面归档</div></div>' +
        '<span class="chip">' + (b.profiles || []).length + ' 个</span></div>' +
        '<div class="ops-tablewrap"><table class="conf"><thead><tr><th>profile</th><th>行数</th><th>包数</th><th>harness</th><th>布局</th><th>来源</th></tr></thead><tbody>';
      (b.profiles || []).forEach(function (p) {
        var src = p.error ? '<span class="sev blocking">错误</span> ' + esc(p.error) : esc(p.truthSource || '—');
        if ((p.missingBundles || []).length) src += ' · 缺 bundle：' + esc(p.missingBundles.join(', '));
        html += '<tr><td><span class="pkg">' + esc(p.name) + '</span></td><td class="numtd">' + esc(p.rows) + '</td><td class="numtd">' + esc(p.packageCount) + '</td><td><span class="chip mono">' + esc(p.harnessVersion || '—') + '</span></td><td>' + esc(p.layout || '—') + '</td><td class="ev">' + src + '</td></tr>';
      });
      if (!(b.profiles || []).length) html += '<tr><td colspan="6" class="ev">未发现 profile</td></tr>';
      html += '</tbody></table></div>';
      var desk = b.desktop && b.desktop.available;
      html += '<div class="ops-note">桌面归档：' + (desk ? '<span class="chip accent">已检测</span> ' + esc(b.desktop.asar || '') : '<span class="chip">未检测到</span> 未找到 resources/app.asar，桌面端对比将不可用。') + '</div></div>';
      (b.pairs || []).forEach(function (pair) {
        var pct = Math.max(0, Math.min(100, Number(pair.similarity) || 0));
        html += '<div class="panel" style="margin-top:12px"><div class="panel-head"><div><h3 style="margin:0">' + esc(pair.left) + ' × ' + esc(pair.right) + '</h3>' +
          '<div class="panel-sub">共享 ' + esc(pair.matched) + ' / 并集 ' + esc(pair.union) + ' · 行数 ' + esc(pair.rows.left) + ' vs ' + esc(pair.rows.right) + '（差 ' + esc(pair.rows.delta) + '）</div></div>' +
          '<span class="chip ' + (pct >= 90 ? 'accent' : '') + '">' + esc(pair.verdict) + ' · ' + pct + '%</span></div>' +
          '<div class="riskbar" style="max-width:none"><i style="width:' + pct + '%"></i></div>' +
          '<div class="ops-note">harness ' + esc(pair.harness.left || '—') + ' vs ' + esc(pair.harness.right || '—') + (pair.harness.drift ? ' <span class="chip">版本漂移</span>' : '') + '</div>';
        if (pair.complete === false) {
          var mp = [];
          if (pair.missing && (pair.missing.left || []).length) mp.push(esc(pair.left) + '：' + esc(pair.missing.left.join(', ')));
          if (pair.missing && (pair.missing.right || []).length) mp.push(esc(pair.right) + '：' + esc(pair.missing.right.join(', ')));
          html += '<div class="ops-alert" style="margin-top:10px">口径不完整：未解析到 ' + mp.join('；') + '。相似度受可达性限制；为该 profile 安装 harness 后重启面板，或用 CLI <code>dsh-forge bridge --root &lt;node_modules&gt;</code> 指定部署目录。</div>';
        }
        if ((pair.shared || []).length) {
          html += '<div class="panel-sub" style="margin-top:12px">版本漂移（' + pair.shared.length + '）</div><div class="ops-tablewrap"><table class="conf"><thead><tr><th>包</th><th>' + esc(pair.left) + '</th><th>' + esc(pair.right) + '</th></tr></thead><tbody>';
          pair.shared.forEach(function (s) { html += '<tr><td><span class="pkg">' + esc(s.package) + '</span></td><td><span class="chip mono">' + esc(s.left) + '</span></td><td><span class="chip mono">' + esc(s.right) + '</span></td></tr>'; });
          html += '</tbody></table></div>';
        }
        html += '<div class="panel-sub" style="margin-top:12px">仅 ' + esc(pair.left) + '（' + (pair.onlyLeft || []).length + '）</div>' + chipList(pair.onlyLeft);
        html += '<div class="panel-sub" style="margin-top:10px">仅 ' + esc(pair.right) + '（' + (pair.onlyRight || []).length + '）</div>' + chipList(pair.onlyRight);
        html += '</div>';
      });
      outHtml('bridgeOut', html);
      outText('bridgeState', '已扫描 ' + (b.profiles || []).length + ' 个 profile · ' + b.generatedAt);
    }).catch(function (e) {
      outText('bridgeState', '扫描失败');
      outHtml('bridgeOut', apiError(e));
    });
  }
  function opsArchive() {
    outText('opsArchiveState', '归档中…');
    postJSON('/api/snapshot', {}).then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || 'snapshot failed');
      outText('opsArchiveState', '已归档 · ' + d.file);
      var banner = document.getElementById('metaLine');
      fetch(api('/api/history')).then(function (r) { return r.json(); }).then(function (h) {
        if (h && h.ok && h.series) { E.history = h.series; renderHistory(); }
      });
      if (banner) banner.classList.remove('stale');
    }).catch(function (e) {
      outText('opsArchiveState', '归档失败');
      outHtml('opsArchiveOut', apiError(e));
    });
  }
  function opsSimulate() {
    var ta = document.getElementById('opsSimInput');
    var ops = {};
    if (ta && ta.value.trim()) {
      try { ops = JSON.parse(ta.value); } catch (e) {
        outHtml('opsSimOut', '<div class="ops-alert">JSON 解析失败：' + esc(e.message) + '</div>');
        return;
      }
      if (!ops || typeof ops !== 'object' || Array.isArray(ops)) {
        outHtml('opsSimOut', '<div class="ops-alert">模拟输入必须是 JSON 对象，例如 {"add":["pkg"],"remove":["row-id"],"override":[...]}</div>');
        return;
      }
    }
    outHtml('opsSimOut', '<div class="ops-note">模拟中…</div>');
    postJSON('/api/simulate', ops).then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || 'simulate failed');
      var r = d.result || {};
      var base = (r.baseline && r.baseline.health) || '?';
      var merged = (r.merged && r.merged.health) || '?';
      var RANK = { A: 4, B: 3, C: 2, D: 1 };
      var delta = (RANK[merged] || 0) - (RANK[base] || 0);
      var vtext = String(r.verdict || '—');
      var vkind = vtext.indexOf('RISK:') === 0 ? 'blocking' : vtext.indexOf('OK:') === 0 ? 'accent' : '';
      var nOps = r.ops || {};
      var html = '<div class="ops-kv">' +
        '<span class="chip">假设推演 · 未执行</span>' +
        '<span class="chip ' + vkind + '">' + esc(vtext.split(':')[0] || '—') + '</span>' +
        '<span class="ops-metric">健康度 <b>' + esc(base) + '</b><i>→</i><b>' + esc(merged) + '</b></span>' +
        '<span class="ops-metric">平均风险 <b>' + esc((r.merged && r.merged.avgScore) || 0) + '</b></span>' +
        '<span class="ops-metric">风险增量 <b>' + esc(r.riskDelta == null ? '—' : (r.riskDelta > 0 ? '+' : '') + r.riskDelta) + '</b></span>' +
        '</div>' +
        '<div class="ops-kv">' +
        '<span class="chip ' + (delta < 0 ? 'accent' : delta > 0 ? 'blocking' : '') + '">' + (delta < 0 ? '健康度提升' : delta > 0 ? '健康度下降' : '健康度持平') + '</span>' +
        '<span class="chip">新增冲突 ' + ((r.newConflicts && r.newConflicts.length) || 0) + '</span>' +
        '<span class="chip">已解决 ' + ((r.resolvedConflicts && r.resolvedConflicts.length) || 0) + '</span>' +
        '<span class="chip">add ' + ((nOps.add && nOps.add.length) || 0) + '</span>' +
        '<span class="chip">remove ' + ((nOps.remove && nOps.remove.length) || 0) + ' 行</span>' +
        '<span class="chip">override ' + Object.keys(nOps.override || {}).length + '</span>' +
        '</div>' +
        '<div class="ops-note">' + esc(vtext) + '</div>';
      if ((r.newConflicts || []).length) {
        html += '<div class="panel-sub" style="margin-top:12px">新增冲突</div><div class="ops-tablewrap"><table class="conf"><thead><tr><th>类型</th><th>级别</th><th>内容</th><th>建议</th></tr></thead><tbody>';
        r.newConflicts.forEach(function (c) {
          html += '<tr><td><span class="chip mono">' + esc(c.type) + '</span></td><td>' + sevBadgeJs(c.severity) + '</td><td>' + esc(c.message) + '<div class="ev">' + esc(c.impact || '') + '</div></td><td class="ev">' + esc(c.advice || '—') + '</td></tr>';
        });
        html += '</tbody></table></div>';
      }
      if ((r.resolvedConflicts || []).length) {
        html += '<div class="panel-sub" style="margin-top:12px">已解决冲突</div><div class="ops-tablewrap"><table class="conf"><thead><tr><th>类型</th><th>级别</th><th>内容</th></tr></thead><tbody>';
        r.resolvedConflicts.forEach(function (c) {
          html += '<tr><td><span class="chip mono">' + esc(c.type) + '</span></td><td>' + sevBadgeJs(c.severity) + '</td><td>' + esc(c.message) + '</td></tr>';
        });
        html += '</tbody></table></div>';
      }
      var imp = r.impact || {};
      if ((imp.removedPackages || []).length) {
        html += '<div class="panel-sub" style="margin-top:12px">移除的包（' + imp.removedPackages.length + '）</div>' + chipList(imp.removedPackages);
      }
      if ((imp.dependents || []).length) {
        html += '<div class="panel-sub" style="margin-top:12px">失去依赖的组件（' + imp.dependents.length + '）</div><div class="ops-tablewrap"><table class="conf"><thead><tr><th>组件</th><th>经由</th></tr></thead><tbody>';
        imp.dependents.forEach(function (x) {
          html += '<tr><td><span class="pkg">' + esc(x.package) + '</span><div class="ev">' + esc(x.id || '') + '</div></td><td>' + (x.via || []).map(function (v) { return '<span class="chip mono">' + esc(v) + '</span>'; }).join(' ') + '</td></tr>';
        });
        html += '</tbody></table></div>';
      }
      if ((imp.lostProviders || []).length) {
        html += '<div class="panel-sub" style="margin-top:12px">消失的 Service 提供者（' + imp.lostProviders.length + '）</div>' + chipList(imp.lostProviders.map(function (x) { return x.service + ' ← ' + x.provider; }));
      }
      if ((imp.brokenServices || []).length) {
        html += '<div class="panel-sub" style="margin-top:12px">中断的服务调用链（' + imp.brokenServices.length + '）</div><div class="ops-tablewrap"><table class="conf"><thead><tr><th>服务</th><th>原提供者</th><th>受影响消费方</th></tr></thead><tbody>';
        imp.brokenServices.forEach(function (x) {
          html += '<tr><td><span class="chip mono">' + esc(x.service) + '</span></td><td><span class="pkg">' + esc(x.provider || '—') + '</span></td><td>' + (x.consumers || []).map(function (p) { return '<span class="chip mono">' + esc(p) + '</span>'; }).join(' ') + '</td></tr>';
        });
        html += '</tbody></table></div>';
      }
      if ((imp.disappearedSignals || []).length) {
        html += '<div class="panel-sub" style="margin-top:12px">随之消失的风险信号（' + imp.disappearedSignals.length + '）</div><div class="ops-tablewrap"><table class="conf"><thead><tr><th>被移除组件</th><th>原风险分</th><th>信号</th></tr></thead><tbody>';
        imp.disappearedSignals.forEach(function (x) {
          var sigs = (x.signals || []).length
            ? (x.signals || []).map(function (s) { return '<span class="chip mono">' + esc(s) + '</span>'; }).join(' ')
            : '<span class="ev">—</span>';
          html += '<tr><td><span class="pkg">' + esc(x.package) + '</span></td><td class="numtd">' + esc(x.score == null ? '—' : x.score) + '</td><td>' + sigs + '</td></tr>';
        });
        html += '</tbody></table></div>';
      }
      if (imp.evidenceNote) html += '<div class="ops-note">' + esc(imp.evidenceNote) + '</div>';
      outHtml('opsSimOut', html);
    }).catch(function (e) {
      outHtml('opsSimOut', apiError(e));
    });
  }
  // Small shared badge used by the simulate/upgrade tables.
  function sevBadgeJs(sev) {
    var s = String(sev || 'low');
    return '<span class="sev ' + esc(s) + '">' + esc(s) + '</span>';
  }
  function opsUpgrade() {
    outText('opsApplyState', '查询 registry…');
    outHtml('opsUpgradeOut', '<div class="ops-note">正在对比 registry 最新版本（主站不可达时自动切镜像），可能需要几秒…</div>');
    fetch(api('/api/upgrade')).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || 'upgrade failed');
      var data = d.data || {};
      var cs = data.candidates || [];
      outText('opsApplyState', cs.length ? '发现 ' + cs.length + ' 个可升级包' : '没有可升级的包');
      var html = '<div class="ops-kv">' +
        '<span class="chip ' + (cs.length ? 'accent' : '') + '">可升级 ' + cs.length + '</span>' +
        '<span class="chip">检查 ' + esc(data.checked == null ? '—' : data.checked) + ' 个包</span>' +
        '<span class="chip mono">' + esc(data.registry || '—') + '</span>' +
        '<span class="chip">' + (data.registrySource === 'fallback' ? '镜像降级' : '主 registry') + '</span>' +
        '<span class="chip">耗时 ' + esc(data.elapsedMs == null ? '—' : data.elapsedMs) + 'ms</span></div>';
      if ((data.networkFailures || []).length) {
        html += '<div class="ops-alert" style="margin-top:10px">仓库不可达（' + data.networkFailures.length + '）：' + esc(data.networkFailures.join(', ')) + '<br>这些包的最新版本未知，可稍后重试或检查网络/代理。</div>';
      }
      if (cs.length) {
        html += '<div class="ops-tablewrap"><table class="conf"><thead><tr><th>包</th><th>已装</th><th>最新</th><th>阻断</th><th>安装命令</th></tr></thead><tbody>';
        cs.forEach(function (c) {
          var n = (c.blockers || []).length;
          var bText = n ? c.blockers.map(function (b) { return esc(b.row) + ' 要求 ' + esc(b.range); }).join('<br>') : '<span class="ev">—</span>';
          html += '<tr><td><span class="pkg">' + esc(c.package) + '</span></td>' +
            '<td><span class="chip mono">' + esc(c.installed) + '</span></td>' +
            '<td><span class="chip mono accent">' + esc(c.latest) + '</span></td>' +
            '<td>' + (n ? '<span class="sev blocking">' + n + ' 处</span><div class="ev">' + bText + '</div>' : '<span class="ev">无</span>') + '</td>' +
            '<td class="ev">' + esc(c.installCmd || '—') + '</td></tr>';
        });
        html += '</tbody></table></div>';
      } else if (!(data.networkFailures || []).length) {
        html += '<div class="ops-note">所有包都已是最新版本。</div>';
      }
      outHtml('opsUpgradeOut', html);
    }).catch(function (e) {
      outText('opsApplyState', '查询失败');
      outHtml('opsUpgradeOut', apiError(e));
    });
  }
  function opsPlan() {
    outText('opsApplyState', '预演中…');
    outHtml('opsUpgradeOut', '<div class="ops-note">预演升级会破坏哪些 consumer 的版本范围（只读，不改动任何文件）…</div>');
    postJSON('/api/plan', {}).then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || 'plan failed');
      var data = d.data || {};
      var cs = data.candidates || [];
      var sum = data.summary || {};
      outText('opsApplyState', '候选 ' + (sum.total || cs.length) + ' · 安全 ' + (sum.safe == null ? '—' : sum.safe) + ' · 阻断 ' + (sum.blocking == null ? '—' : sum.blocking));
      var html = '<div class="ops-kv">' +
        '<span class="chip">候选 ' + esc(sum.total == null ? cs.length : sum.total) + '</span>' +
        '<span class="chip accent">安全 ' + esc(sum.safe == null ? '—' : sum.safe) + '</span>' +
        '<span class="chip ' + ((sum.blocking || 0) > 0 ? 'blocking' : '') + '">阻断 ' + esc(sum.blocking == null ? '—' : sum.blocking) + '</span>' +
        '<span class="chip mono">' + esc(data.registry || '—') + '</span></div>';
      if ((data.networkFailures || []).length) {
        html += '<div class="ops-alert" style="margin-top:10px">部分包无法从仓库解析：' + esc(data.networkFailures.join(', ')) + '</div>';
      }
      if (cs.length) {
        html += '<div class="ops-tablewrap"><table class="conf"><thead><tr><th>包</th><th>版本流向</th><th>结论</th><th>详情</th></tr></thead><tbody>';
        cs.forEach(function (c) {
          var brk = c.breaks || [];
          html += '<tr><td><span class="pkg">' + esc(c.package) + '</span></td>' +
            '<td><span class="chip mono">' + esc(c.from) + '</span> <span class="ev">→</span> <span class="chip mono accent">' + esc(c.to) + '</span></td>' +
            '<td>' + (c.safe ? '<span class="sev verified">安全</span>' : '<span class="sev blocking">阻断</span>') + '</td>' +
            '<td class="ev">' + esc(c.note || '') +
            (brk.length ? '<div style="margin-top:4px">' + brk.map(function (b) { return '<span class="chip mono">' + esc(b.row) + '</span> 范围 ' + esc(b.range); }).join('<br>') + '</div>' : '') +
            (c.suggestedRange ? '<div>建议范围 <code>' + esc(c.suggestedRange) + '</code></div>' : '') +
            '</td></tr>';
        });
        html += '</tbody></table></div>';
      } else {
        html += '<div class="ops-note">没有可预演的升级候选（可能都已是最新，或仓库不可达）。</div>';
      }
      outHtml('opsUpgradeOut', html);
    }).catch(function (e) {
      outText('opsApplyState', '预演失败');
      outHtml('opsUpgradeOut', apiError(e));
    });
  }
  function opsApply() {
    var targetEl = document.getElementById('opsTarget');
    var verEl = document.getElementById('opsVersion');
    var okEl = document.getElementById('opsConfirm');
    var target = targetEl ? targetEl.value : 'harness';
    var version = (verEl && verEl.value.trim()) || 'latest';
    if (target !== 'forge' && target !== 'harness') {
      outHtml('opsApplyOut', '<div class="ops-alert">升级目标必须是 harness 或 forge。</div>');
      return;
    }
    if (!okEl || !okEl.checked) {
      outHtml('opsApplyOut', '<div class="ops-alert">请先勾选「我已了解：会先备份 package.json 再执行升级」，再点击执行。</div>');
      return;
    }
    var label = target === 'forge' ? 'dsh-forge' : 'dsh（harness）';
    outText('opsApplyState', '执行中…（可能需要数分钟）');
    outHtml('opsApplyOut', '<div class="ops-note">正在执行 ' + esc(label) + ' → ' + esc(version) + '，会先备份 package.json…</div>');
    postJSON('/api/update', { target: target, version: version, apply: true, confirm: 'update-' + target }).then(function (d) {
      var okk = !!(d && d.ok);
      outText('opsApplyState', okk ? (d.applied ? '已执行' : '仅预演') : '执行失败');
      var html = '<div class="ops-kv">' +
        '<span class="chip ' + (okk ? 'accent' : 'blocking') + '">' + (okk ? (d.applied ? '成功' : '预演通过') : '失败') + '</span>' +
        '<span class="chip mono">' + esc(target) + ' → ' + esc((d && d.version) || version) + '</span>' +
        ((d && d.code != null) ? '<span class="chip">exit ' + esc(d.code) + '</span>' : '') +
        ((d && d.durationMs != null) ? '<span class="chip">' + esc(d.durationMs) + 'ms</span>' : '') +
        '</div>';
      if (d && d.command) html += '<div class="ops-note">命令 · <code>' + esc(d.command) + '</code></div>';
      if (d && d.backup) html += '<div class="ops-note">备份 · <code>' + esc(d.backup) + '</code></div>';
      if (d && d.error) html += '<div class="ops-alert" style="margin-top:8px">' + esc(d.error) + '</div>';
      if (d && d.stdout) html += '<div class="panel-sub" style="margin-top:10px">stdout</div><div class="ops-log">' + esc(d.stdout) + '</div>';
      if (d && d.stderr) html += '<div class="panel-sub" style="margin-top:10px">stderr</div><div class="ops-log">' + esc(d.stderr) + '</div>';
      outHtml('opsApplyOut', html);
      if (d && d.applied) {
        startAuto();
        refresh(true);
      }
    }).catch(function (e) {
      outText('opsApplyState', '执行失败');
      outHtml('opsApplyOut', apiError(e));
    });
  }

  var skinCache = (window.__DSH_SKIN__ === 'light' || window.__DSH_SKIN__ === 'dark') ? window.__DSH_SKIN__ : 'dark';
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
  var G = {
    model: null, selected: null, edge: null, tx: 0, ty: 0, k: 1,
    wired: false, moved: false, sparse: null,
    pos: {}, showExt: true, palSearch: '', nodeDrag: null, trashHot: false,
    collapsed: {}
  };
  var SEV_C = { blocking: '#d64545', high: '#e67e22', medium: '#f1c40f', low: '#27ae60', disabled: '#95a5a6' };
  var SEV_R = { blocking: 5, high: 4, medium: 3, low: 2, disabled: 1 };
  var GW = 172, GH = 40, EXT_W = 150, EXT_H = 26, M = 92, TOP = 40;
  var CW = 150, LH = 22, LH_Y = 8;

  var POS_KEY = 'dsh-graph-pos';

  // Positions survive reloads when storage exists; the browser is optional,
  // so absence of localStorage must never break the graph.
  function loadPositions() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return {};
      var raw = localStorage.getItem(POS_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      return obj && typeof obj === 'object' ? obj : {};
    } catch (e) { return {}; }
  }
  function savePositions() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
      localStorage.setItem(POS_KEY, JSON.stringify(G.pos));
    } catch (e) { /* storage full / disabled -> memory-only layout */ }
  }

  // A row hidden by table toggles or by hypothetical removal leaves the graph.
  function hiddenRow(id) {
    return state.disabled[id] === true || state.removed.indexOf(id) >= 0;
  }

  function isExtPkg(pkg, model) {
    var g = model.byPkg[pkg];
    return !!(g && g.ext);
  }

  function graphModel() {
    var byPkg = {}, order = [], hidden = 0;
    E.rows.forEach(function (r) {
      if (hiddenRow(r.id)) { hidden++; return; }
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
      if (hiddenRow(r.id)) return;
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
    return { byPkg: byPkg, order: order, extOrder: extOrder, edges: edges, plugin: plugin, hidden: hidden };
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

  // Layers are stacked columns; each column gets a clickable header so a
  // crowded column can fold down to its header instead of stacking dozens of
  // cards on top of each other. Folded layers shrink to CW and their nodes
  // are skipped both in the canvas and in the edge draw.
  function layerFolded(l) { return G.collapsed[l] === true; }

  function layoutGraph(model) {
    var ci = {}, colOrder = [];
    model.order.forEach(function (pkg) {
      var l = model.byPkg[pkg].layer;
      if (ci[l] === undefined) { ci[l] = colOrder.length; colOrder.push(l); }
    });
    var perCol = colOrder.map(function () { return []; });
    model.order.forEach(function (pkg) { perCol[ci[model.byPkg[pkg].layer]].push(pkg); });
    var colX = [], x = M;
    colOrder.forEach(function (l) {
      colX.push(x);
      x += (layerFolded(l) ? CW : GW) + M;
    });
    var yat = colOrder.map(function () { return 0; });
    var maxRows = 0;
    model.order.forEach(function (pkg) {
      var g = model.byPkg[pkg], c = ci[g.layer];
      g.x = colX[c]; g.y = TOP + yat[c] * (GH + 8); g.ext = false;
      if (!layerFolded(g.layer)) { yat[c]++; if (yat[c] > maxRows) maxRows = yat[c]; }
    });
    model.layerCols = colOrder.map(function (l, i) {
      return { layer: l, x: colX[i], w: layerFolded(l) ? CW : GW, folded: layerFolded(l), count: perCol[i].length };
    });
    var pluginBottom = TOP + maxRows * (GH + 8);
    var perRow = 9;
    model.extOrder.forEach(function (dep, i) {
      var g = { pkg: dep, ext: true, sev: 'low', disabled: false, rows: [] };
      g.x = M + (i % perRow) * (EXT_W + 12);
      g.y = pluginBottom + 60 + Math.floor(i / perRow) * (EXT_H + 8);
      model.byPkg[dep] = g;
    });
    // Manual layout wins over the layer grid: once a node was dragged its
    // coordinates are restored verbatim (ComfyUI keeps the canvas as-is).
    model.order.concat(model.extOrder).forEach(function (p) {
      var q = G.pos[p], g = model.byPkg[p];
      if (q && g && typeof q.x === 'number' && typeof q.y === 'number') { g.x = q.x; g.y = q.y; }
    });
    var extRows = Math.ceil(model.extOrder.length / perRow);
    model.svgW = x + M;
    model.svgH = Math.max(pluginBottom, TOP) + 60 + (G.showExt ? extRows * (EXT_H + 8) + 44 : 44);
    // Dragged nodes can sit outside the computed grid -> grow the viewport box.
    var maxX = model.svgW, maxY = model.svgH;
    model.order.concat(model.extOrder).forEach(function (p) {
      var g = model.byPkg[p];
      if (!g) return;
      maxX = Math.max(maxX, g.x + (g.ext ? EXT_W : GW) + M);
      maxY = Math.max(maxY, g.y + (g.ext ? EXT_H : GH) + 44);
    });
    model.svgW = maxX; model.svgH = maxY;
  }

  // One clickable pill above each layer column (folded state included).
  function layerHeadMarkup(col) {
    var w = col.w, l = col.layer;
    var label = fitText(l, 10, w - 46);
    return '<g class="g-lh" data-layer="' + esc(l) + '" transform="translate(' + col.x + ',' + LH_Y + ')">' +
      '<rect width="' + w + '" height="' + LH + '" rx="7" fill="#141a23" stroke="#39424e" stroke-width="1"></rect>' +
      '<text x="7" y="15" font-size="10" fill="#9aa4ae">' + (col.folded ? '▸' : '▾') + '</text>' +
      '<text x="19" y="15" font-size="10" fill="#c9d1d9">' + esc(label) + '</text>' +
      '<text x="' + (w - 7) + '" y="15" font-size="9" fill="#7d8794" text-anchor="end">' + col.count + (col.folded ? ' 收起' : '') + '</text>' +
      '<title>点击' + (col.folded ? '展开' : '收起') + '「' + esc(l) + '」层的 ' + col.count + ' 个节点</title></g>';
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

  function causalId(e) { return 'depends_on:plugin:' + e.from + '→plugin:' + e.to; }

  // Inverse of causalId(): recover the two packages from a clicked edge.
  function parseCausalId(id) {
    var s = String(id == null ? '' : id), pre = 'depends_on:plugin:', sep = '→plugin:';
    if (s.indexOf(pre) !== 0) return null;
    var rest = s.slice(pre.length), i = rest.indexOf(sep);
    if (i < 0) return null;
    return { from: rest.slice(0, i), to: rest.slice(i + sep.length) };
  }

  function causalEdge(id) {
    var c = E.causal || {};
    return (c.edges || []).filter(function (x) { return x.id === id; })[0] || null;
  }

  function edgeMarkup(e, model, selected, focused, incoming, density) {
    var byPkg = model.byPkg;
    var p = edgePath(e.from, e.to, byPkg);
    if (!p || e.from === e.to) return '';
    var color = e.sat === false ? '#d64545' : '#8892a0', op = 0.38, w = 1.2, label = false, arrow = false;
    var edgeMode = !selected && G.edge;
    var edgeOn = edgeMode && G.edge === causalId(e);
    if (edgeOn) { color = '#4da3ff'; op = 1; w = 2.4; }
    else if (edgeMode) { op = 0.12; w = 1; }
    if (selected) {
      if (focused) { color = incoming ? '#3fbf7f' : '#4da3ff'; op = 1; w = 2.2; label = true; arrow = true; }
      else { color = '#6e7681'; op = 0.1; w = 1; }
    } else if (e.fake) {
      color = '#8b949e'; op = 0.5; w = 1.2;
    }
    if (!selected && density >= 1 && !e.sat && !e.fake) {
      op = Math.max(0.1, op * 0.6);
      w = 1;
      if (density >= 2) { op = 0.06; w = 0.8; }
    }
    var idAttr = ' data-edge="' + esc(causalId(e)) + '"';
    var s = '<path d="' + p + '" fill="none" stroke="' + color + '" stroke-opacity="' + op + '" stroke-width="' + w + '"' +
      (e.sat === false ? ' stroke-dasharray="5,4"' : '') + (arrow ? ' marker-end="url(#arrow-att)"' : '') + idAttr +
      ' style="pointer-events:stroke"></path>' +
      '<path d="' + p + '" fill="none" stroke="transparent" stroke-width="11" style="pointer-events:stroke"' + idAttr + '></path>';
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

  function nodeMarkup(g, selected, rel, clipDefs, edgeFocus) {
    var w = g.ext ? EXT_W : GW, h = g.ext ? EXT_H : GH;
    var color = g.ext ? '#6e7681' : (SEV_C[g.sev] || '#27ae60');
    var dim = (selected && g.pkg !== selected && !rel.out[g.pkg] && !rel.in[g.pkg]) ||
      (edgeFocus && !selected && g.pkg !== edgeFocus.from && g.pkg !== edgeFocus.to);
    var isSel = !g.ext && selected === g.pkg;
    var dash = g.disabled ? ' stroke-dasharray="3,2"' : '';
    var op = dim ? ' opacity="0.28"' : '';
    var title = esc(g.pkg) + ((g.rows && g.rows.length) ? ' rows: ' + esc(g.rows.join(', ')) : '');
    var clipId = 'clip-node-' + clipDefs.length;
    clipDefs.push('<clipPath id="' + clipId + '"><rect width="' + w + '" height="' + h + '"></rect></clipPath>');
    if (g.ext) {
      var extLabel = fitText(shortName(g.pkg), 10, w - 18);
      return '<g class="g-node g-ext" data-pkg="' + esc(g.pkg) + '" transform="translate(' + g.x + ',' + g.y + ')"' + op + '>' +
        '<rect width="' + w + '" height="' + h + '" rx="5" fill="#20242b" stroke="#6e7681" stroke-opacity="0.85" stroke-width="1"' + dash + '></rect>' +
        '<circle cx="0" cy="' + (h / 2) + '" r="3" fill="#6e7681"></circle>' +
        '<g clip-path="url(#' + clipId + ')"><text x="9" y="' + (h / 2 + 3.5) + '" font-size="10" fill="#9aa4ae">' + esc(extLabel) + '</text></g>' +
        '<title>' + title + '</title></g>';
    }
    var headLabel = (g.sev || 'low') + (g.layer ? ' · ' + g.layer : '');
    var bodyLabel = fitText(shortName(g.pkg), 11.5, w - 18);
    var rowTag = (g.rows && g.rows.length > 1) ? '×' + g.rows.length : '';
    return '<g class="g-node' + (isSel ? ' g-sel' : '') + '" data-pkg="' + esc(g.pkg) + '" transform="translate(' + g.x + ',' + g.y + ')"' + op + '>' +
      (isSel ? '<rect x="-3" y="-3" width="' + (w + 6) + '" height="' + (h + 6) + '" rx="9" fill="none" stroke="#4da3ff" stroke-opacity="0.55" stroke-width="1"></rect>' : '') +
      '<rect width="' + w + '" height="' + h + '" rx="7" fill="#1b2027" stroke="' + color + '" stroke-width="' + (isSel ? 2.2 : 1.2) + '"' + dash + '></rect>' +
      '<rect width="' + w + '" height="19" rx="7" fill="' + color + '" fill-opacity="0.9"></rect>' +
      '<rect y="12" width="' + w + '" height="7" fill="' + color + '" fill-opacity="0.9"></rect>' +
      '<g clip-path="url(#' + clipId + ')"><text x="7" y="13.5" font-size="9" font-weight="700" fill="#101318">' + esc(fitText(headLabel, 9, w - 26)) + '</text></g>' +
      (rowTag ? '<text x="' + (w - 7) + '" y="13.5" font-size="9" fill="#101318" text-anchor="end">' + esc(rowTag) + '</text>' : '') +
      '<g clip-path="url(#' + clipId + ')"><text x="7" y="' + (h - 6) + '" font-size="11.5" fill="#e6edf3">' + esc(bodyLabel) + '</text></g>' +
      '<circle cx="0" cy="' + (h / 2) + '" r="3.5" fill="#0f1216" stroke="' + color + '" stroke-width="1.5"></circle>' +
      '<circle cx="' + w + '" cy="' + (h / 2) + '" r="3.5" fill="#0f1216" stroke="' + color + '" stroke-width="1.5"></circle>' +
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

  function renderEdgeDetail(edgeFocus) {
    var id = causalId(edgeFocus);
    var c = causalEdge(id);
    var head = '<h4>' + esc(edgeFocus.from) + ' → ' + esc(edgeFocus.to) + '</h4>';
    if (!c) {
      return head +
        '<p class="meta"><b>关系：</b>清单声明依赖（depends_on）</p>' +
        '<p class="meta"><b>版本范围：</b>' + esc(edgeFocus.range || '—') + (edgeFocus.sat === false ? ' ✗ 不满足' : '') + '</p>' +
        '<p class="ev">该边指向外部库等非因果节点：因果图只把插件配对建成 depends_on，因此这里只显示清单声明，不额外推断行为。</p>' +
        '<p class="ev">颜色：插件包=风险级色 · 外部库=灰 · 灰虚线=forge-ui↔forge 关联 · 红虚线=未满足</p>';
    }
    var obs = c.observed ? '是（运行期探针确认）' : '否（静态推断，未观测运行期行为）';
    return head +
      '<p class="meta"><b>关系：</b>' + esc(c.relation) + (edgeFocus.peer ? ' · peerDependencies' : '') + '</p>' +
      '<p class="meta"><b>证据层级：</b>' + esc(c.tier || '—') + ' · <b>置信度：</b>' + esc(c.confidence || '—') + '</p>' +
      '<p class="meta"><b>运行期观测：</b>' + obs + '</p>' +
      '<p class="meta"><b>证据来源：</b>' + esc(c.provenance || '—') + '</p>' +
      '<p class="meta"><b>为什么建立：</b>' + esc(c.why || '—') + '</p>' +
      '<p class="ev">' + esc(c.caveat || '静态关系不等于运行期因果。') + '</p>' +
      '<p class="ev">点空白或「重置」返回总览；点节点查看它的前置/后置依赖。</p>';
  }

  function renderDetail(selected, model, edgeSelLen, density, edgeFocus) {
    var el = document.getElementById('gDetail');
    if (!el) return;
    if (edgeFocus && !selected) { el.innerHTML = renderEdgeDetail(edgeFocus); el.onclick = null; return; }
    if (!selected) {
      var note = '';
      if (density === 1) note = '<p class="ev" style="color:#e67e22">密度自适应：边数较多，已淡化非关键边以保证流畅</p>';
      if (density === 2) note = '<p class="ev" style="color:#d64545">密度自适应：边数过多，已过滤插件→外部库边以保证流畅。点击节点可查看完整依赖</p>';
      var causalNote = E.causal && E.causal.counts
        ? '<p class="ev">因果投影：' + E.causal.counts.plugins + ' 个插件节点 · ' + E.causal.counts.services + ' 个 service 节点 · ' +
          E.causal.counts.outcomes + ' 个发现节点 · ' + E.causal.counts.edges + ' 条带证据关系。</p>'
        : '';
      var hiddenNote = model.hidden
        ? '<p class="ev" style="color:#e67e22">有 ' + model.hidden + ' 个组合行被禁用/移除（推演），已从画布隐藏；可在左侧「已移除」恢复。</p>'
        : '';
      el.innerHTML = '<h4>依赖图谱 · 总览</h4>' +
        '<p class="meta">当前显示 <b>' + model.order.length + '</b> 个组合插件包 · <b>' + (G.showExt ? model.extOrder.length : 0) + '</b> 个外部库包 · <b>' + model.edges.length + '</b> 条依赖边。</p>' +
        '<p class="meta">左侧调色板把「已安装未组合」的包<b>拖入画布</b>或点击添加（推演，不改真实组合）；把节点拖到调色板下方回收区＝从画布移除，移除项在调色板「已移除」里可恢复。节点可拖动并记住位置。</p>' +
        '<p class="meta">总览仅保留<b>组合插件主干</b>关系线（' + edgeSelLen + ' 条）。滚轮缩放、拖空白平移；点击任意节点查看<b>前置依赖</b>(→, 它需要什么)与<b>后置依赖</b>(←, 谁需要它)；<b>点击任意连杆</b>查看该关系的证据层级、来源与置信度。</p>' +
        causalNote + hiddenNote + note +
        '<p class="ev">颜色：卡片头=风险级 · 外部库=灰卡 · 红虚线=未满足 · 蓝线=选中关系 · 绿线=被依赖方向</p>';
      el.onclick = null;
      return;
    }
    var g = model.byPkg[selected];
    var pre = [], dep = [];
    model.edges.forEach(function (e) {
      if (e.from === selected) pre.push({ other: e.to, range: e.range, sat: e.sat, fake: e.fake });
      if (e.to === selected) dep.push({ other: e.from, range: e.range, sat: e.sat, fake: e.fake });
    });
    function row(a, t) { return '<li>' + escDetail(a.other) + ' <span class="ev">' + escDetail(a.range) + (a.sat === false ? ' ✗' : '') + '</span></li>'; }
    var meta = g ? '<p class="meta"><b>层：</b>' + esc(g.layer || '—') + ' · <b>级别：</b>' + esc(g.sev || 'low') +
      ' · <b>组合行：</b>' + esc((g.rows || []).join(', ') || '—') + (g.ext ? ' · 外部库' : '') + '</p>' : '';
    var actions = g && !g.ext
      ? '<div class="g-actions"><button type="button" class="g-act danger" data-act="remove" data-pkg="' + esc(selected) + '">从画布移除（推演）</button></div>'
      : '';
    el.innerHTML = '<h4>' + escDetail(selected) + '</h4>' + actions + meta +
      '<div class="pre"><b>前置依赖（它需要 →）：' + pre.length + '</b></div><ul>' + (pre.map(function (a) { return row(a, 'pre'); }).join('') || '<li class="ev">无</li>') + '</ul>' +
      '<div class="post"><b>后置依赖（← 谁需要它）：' + dep.length + '</b></div><ul>' + (dep.map(function (a) { return row(a, 'post'); }).join('') || '<li class="ev">无</li>') + '</ul>';
    el.onclick = function (e) {
      var t = e.target;
      while (t && t !== el) {
        if (t.getAttribute) {
          if (t.getAttribute('data-act') === 'remove') { removeNode(t.getAttribute('data-pkg')); return; }
        }
        t = t.parentNode;
      }
    };
  }

  function applyView() {
    var host = document.getElementById('dshGraph');
    if (!host) return;
    var vp = host.querySelector('#vp');
    if (vp && vp.setAttribute) vp.setAttribute('transform', 'translate(' + G.tx + ',' + G.ty + ') scale(' + G.k + ')');
    // The dot grid tracks pan/zoom so the canvas keeps a stable world origin
    // (ComfyUI-style editor feel) instead of looking like a static wallpaper.
    if (host.style) {
      var s = 20 * G.k, big = s * 5;
      host.style.backgroundSize = s + 'px ' + s + 'px,' + big + 'px ' + big + 'px,' + big + 'px ' + big + 'px';
      host.style.backgroundPosition = G.tx + 'px ' + G.ty + 'px';
    }
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

  function graphHost() { return document.getElementById('dshGraph'); }

  // Screen px -> world coordinates under the current pan/zoom.
  function svgPoint(host, cx, cy) {
    var r = (host && host.getBoundingClientRect) ? host.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: ((cx - (r.left || 0)) - G.tx) / G.k, y: ((cy - (r.top || 0)) - G.ty) / G.k };
  }

  function overTrash(cx, cy) {
    var t = document.getElementById('gTrash');
    if (!t || !t.getBoundingClientRect) return false;
    var r = t.getBoundingClientRect();
    var right = r.right !== undefined ? r.right : (r.left || 0) + (r.width || 0);
    var bottom = r.bottom !== undefined ? r.bottom : (r.top || 0) + (r.height || 0);
    return cx >= (r.left || 0) && cx <= right && cy >= (r.top || 0) && cy <= bottom;
  }

  function setTrashHot(on) {
    if (on === G.trashHot) return;
    G.trashHot = on;
    var t = document.getElementById('gTrash');
    if (t && t.classList && t.classList.toggle) t.classList.toggle('hot', on);
  }

  function pkgFromTarget(t, host) {
    while (t && t !== host) {
      if (t.getAttribute) {
        var p = t.getAttribute('data-pkg');
        if (p) return p;
      }
      t = t.parentNode;
    }
    return null;
  }

  function canvasCenter() {
    var host = graphHost();
    var w = (host && host.clientWidth) || 800, h = (host && host.clientHeight) || 600;
    return { x: (w / 2 - G.tx) / G.k, y: (h / 2 - G.ty) / G.k };
  }

  // Packages that left the canvas through table toggles / hypothetical removal.
  function removedPkgs() {
    var onCanvas = {};
    if (G.model) {
      Object.keys(G.model.byPkg).forEach(function (p) {
        if (!G.model.byPkg[p].ext) onCanvas[p] = true;
      });
    }
    var map = {};
    E.rows.forEach(function (r) {
      if (onCanvas[r.pkg]) return;
      if (state.disabled[r.id] || state.removed.indexOf(r.id) >= 0) map[r.pkg] = true;
    });
    return Object.keys(map);
  }

  // Palette drop-in: same 假设模拟 path as addRow(), so the table, risk
  // recompute and graph all agree on one hypothetical source of truth.
  function addCandidateByName(name, pt) {
    var cand = (E.candidates || []).filter(function (c) { return c.name === name; })[0];
    if (!cand) return;
    var base = shortName(cand.name).replace(/^dsh-/, '') || shortName(cand.name);
    var id = base, n = 2;
    while (E.rows.some(function (r) { return r.id === id; }) ||
           state.added.some(function (a) { return a.id === id; })) { id = base + '-' + n; n++; }
    state.added.push({ id: id, name: cand.name, ver: cand.ver, deps: cand.deps });
    if (pt) G.pos[cand.name] = { x: Math.round(pt.x - GW / 2), y: Math.round(pt.y - GH / 2) };
    renderTable();
    initGraph();
    savePositions();
  }

  function removeNode(pkg) {
    var g = G.model && G.model.byPkg[pkg];
    if (g && g.ext) return; // external libraries are not composition rows
    var simulated = state.added.filter(function (a) { return a.name === pkg; });
    if (simulated.length) {
      state.added = state.added.filter(function (a) { return a.name !== pkg; });
    } else {
      E.rows.forEach(function (r) {
        if (r.pkg === pkg && state.removed.indexOf(r.id) < 0) state.removed.push(r.id);
      });
    }
    if (G.selected === pkg) { G.selected = null; G.edge = null; }
    delete G.pos[pkg];
    renderTable();
    initGraph();
    savePositions();
  }

  function restoreNode(pkg) {
    var keep = [];
    state.removed.forEach(function (id) {
      var owner = E.rows.filter(function (r) { return r.id === id; })[0];
      if (owner && owner.pkg === pkg) return;
      keep.push(id);
    });
    state.removed = keep;
    E.rows.forEach(function (r) { if (r.pkg === pkg && state.disabled[r.id]) state.disabled[r.id] = false; });
    renderTable();
    initGraph();
    savePositions();
  }

  function renderPalette() {
    var addEl = document.getElementById('gPalAdd');
    var remEl = document.getElementById('gPalRemoved');
    if (!addEl || !remEl) return;
    var q = (G.palSearch || '').toLowerCase();
    var composed = {};
    if (G.model) G.model.order.forEach(function (p) { composed[p] = true; });
    var cands = (E.candidates || []).filter(function (c) {
      if (composed[c.name]) return false;
      return !q || String(c.name).toLowerCase().indexOf(q) >= 0;
    });
    addEl.innerHTML = cands.length ? cands.map(function (c) {
      return '<div class="gp-item" draggable="true" data-add="' + esc(c.name) + '" title="' + esc(c.name) + '@' + esc(c.ver) + '">' +
        '<span class="gp-dot" style="background:#27ae60"></span>' +
        '<span class="gp-name">' + esc(shortName(c.name)) + '</span>' +
        '<span class="gp-ver">' + esc(c.ver) + '</span></div>';
    }).join('') : '<div class="gp-empty">' + ((E.candidates && E.candidates.length) ? '没有匹配的候选包' : '无已安装未组合的包') + '</div>';
    var rems = removedPkgs().filter(function (p) { return !q || p.toLowerCase().indexOf(q) >= 0; });
    remEl.innerHTML = rems.length ? rems.map(function (p) {
      return '<div class="gp-item gp-restore" data-restore="' + esc(p) + '" title="恢复 ' + esc(p) + '">' +
        '<span class="gp-dot"></span><span class="gp-name">' + esc(shortName(p)) + '</span><span class="gp-ver">↺</span></div>';
    }).join('') : '<div class="gp-empty">无</div>';
    var ac = document.getElementById('gPalAddCount'); if (ac) ac.textContent = cands.length;
    var rc = document.getElementById('gPalRemCount'); if (rc) rc.textContent = rems.length;
    addEl.onclick = remEl.onclick = function (e) {
      var t = e.target;
      while (t && t !== this) {
        if (t.getAttribute) {
          var a = t.getAttribute('data-add');
          var r2 = t.getAttribute('data-restore');
          if (a) { addCandidateByName(a, canvasCenter()); return; }
          if (r2) { restoreNode(r2); return; }
        }
        t = t.parentNode;
      }
    };
    addEl.ondragstart = function (e) {
      var t = e.target;
      while (t && t !== addEl) {
        if (t.getAttribute && t.getAttribute('data-add')) break;
        t = t.parentNode;
      }
      var name = (t && t.getAttribute) ? t.getAttribute('data-add') : null;
      if (!name) return;
      try { e.dataTransfer.setData('text/plain', name); e.dataTransfer.effectAllowed = 'copy'; } catch (err) { /* older browsers */ }
    };
  }

  // During a node drag only the moved card and its links are rewritten, so
  // large ecosystems stay responsive without re-rendering 400+ nodes.
  function updateNodeVisual(host, pkg) {
    if (!host || !host.querySelector) return;
    var g = G.model.byPkg[pkg];
    if (!g) return;
    var el = host.querySelector('.g-node[data-pkg="' + pkg + '"]');
    if (el && el.setAttribute) el.setAttribute('transform', 'translate(' + g.x + ',' + g.y + ')');
    if (!host.querySelectorAll) return;
    var paths = host.querySelectorAll('[data-edge]');
    for (var i = 0; i < paths.length; i++) {
      var id = paths[i].getAttribute('data-edge');
      var f = parseCausalId(id);
      if (!f || (f.from !== pkg && f.to !== pkg)) continue;
      paths[i].setAttribute('d', edgePath(f.from, f.to, G.model.byPkg));
    }
  }

  function renderGraphInto(host, model) {
    var rel = G.selected ? relation(model) : { out: {}, in: {} };
    var density = 0;
    function foldedPkg(pkg) {
      var g = model.byPkg[pkg];
      return !!(g && !g.ext && layerFolded(g.layer));
    }
    var baseEdges = model.edges.filter(function (e) {
      if (foldedPkg(e.from) || foldedPkg(e.to)) return false;
      return G.showExt || (!isExtPkg(e.from, model) && !isExtPkg(e.to, model));
    });
    var edgesSel;
    if (G.selected || G.edge) {
      // A selected edge may live below the density filter; render the full set
      // so the highlighted relationship is always present.
      edgesSel = baseEdges;
    } else {
      var adapted = adaptiveFilter(baseEdges, model);
      edgesSel = adapted.edges;
      density = adapted.density;
    }
    var edgeFocus = G.edge && !G.selected ? parseCausalId(G.edge) : null;
    var parts = [];
    var clipDefs = [];
    parts.push('<svg id="gSvg" width="100%" height="100%" style="display:block" preserveAspectRatio="xMidYMid meet">');
    parts.push('<defs><marker id="arrow-att" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#4da3ff"></path></marker></defs>');
    parts.push('<rect width="100%" height="100%" fill="transparent"></rect>');
    parts.push('<g id="vp">');
    edgesSel.forEach(function (e) {
      var focused = false, incoming = false;
      if (G.selected) { if (e.from === G.selected) { focused = true; } else if (e.to === G.selected) { focused = true; incoming = true; } }
      parts.push(edgeMarkup(e, model, G.selected, focused, incoming, density));
    });
    (model.layerCols || []).forEach(function (col) { parts.push(layerHeadMarkup(col)); });
    model.order.forEach(function (pkg) {
      if (layerFolded(model.byPkg[pkg].layer)) return;
      parts.push(nodeMarkup(model.byPkg[pkg], G.selected, rel, clipDefs, edgeFocus));
    });
    if (G.showExt) {
      model.extOrder.forEach(function (dep) { var g = model.byPkg[dep]; if (g && g.ext) parts.push(nodeMarkup(g, G.selected, rel, clipDefs, edgeFocus)); });
    }
    // Merge clipPath defs into the existing marker <defs> (single defs).
    if (clipDefs.length > 0) {
      parts[1] = parts[1].replace('</defs>', '' + clipDefs.join('') + '</defs>');
    }
    parts.push('</g></svg>');
    host.innerHTML = parts.join('');
    renderDetail(G.selected, model, edgesSel.length, density, edgeFocus);
    host.onwheel = function (e) { e.preventDefault(); var w = host.clientWidth || 800, h = host.clientHeight || 600; var rect = host.getBoundingClientRect ? host.getBoundingClientRect() : null; var px = rect ? (e.clientX - rect.left) : w / 2; var py = rect ? (e.clientY - rect.top) : h / 2; zoomAt(px, py, e.deltaY < 0 ? 1.15 : 0.87); };
    host.onmousedown = function (e) {
      var pkg = pkgFromTarget(e.target, host);
      G.moved = false; G.sx = e.clientX; G.sy = e.clientY;
      if (pkg) {
        var g = G.model.byPkg[pkg];
        var p = svgPoint(host, e.clientX, e.clientY);
        G.nodeDrag = { pkg: pkg, ox: g.x, oy: g.y, sx: p.x, sy: p.y };
      } else {
        G.nodeDrag = null;
        G.dragging = true; G.ox = G.tx; G.oy = G.ty;
      }
    };
    host.onclick = function (e) {
      if (G.moved) return;
      var t = e.target, pkg = null, edge = null, layer = null;
      while (t && t !== host) {
        if (t.getAttribute) {
          if (!layer && t.getAttribute('data-layer')) { layer = t.getAttribute('data-layer'); break; }
          if (!edge && t.getAttribute('data-edge')) { edge = t.getAttribute('data-edge'); break; }
          if (!pkg && t.getAttribute('data-pkg')) { pkg = t.getAttribute('data-pkg'); break; }
        }
        t = t.parentNode;
      }
      if (layer) { toggleLayer(layer); return; }
      if (edge) { G.edge = G.edge === edge ? null : edge; G.selected = null; }
      else if (pkg) { G.selected = G.selected === pkg ? null : pkg; G.edge = null; }
      else { G.selected = null; G.edge = null; }
      renderGraphInto(host, G.model);
    };
    host.ondragover = function (e) { if (e.preventDefault) e.preventDefault(); };
    host.ondrop = function (e) {
      if (e.preventDefault) e.preventDefault();
      var name = '';
      try { name = e.dataTransfer.getData('text/plain') || ''; } catch (err) { name = ''; }
      if (!name) return;
      addCandidateByName(name, svgPoint(host, e.clientX, e.clientY));
    };
    applyView();
  }

  // Toolbar label follows the real fold state: it offers the bulk action
  // that is still available (fold all vs unfold all).
  function syncFoldBtn() {
    var btn = document.getElementById('gFold');
    if (!btn) return;
    var cols = (G.model && G.model.layerCols) || [];
    var allFolded = cols.length > 0 && cols.every(function (c) { return c.folded; });
    btn.textContent = allFolded ? '展开全部层' : '折叠全部层';
    if (btn.classList && btn.classList.toggle) btn.classList.toggle('on', allFolded);
  }

  function toggleLayer(l) {
    var host = graphHost();
    if (!host || !G.model) return;
    G.collapsed[l] = !G.collapsed[l];
    var sel = G.model.byPkg[G.selected];
    if (G.selected && sel && !sel.ext && sel.layer === l) { G.selected = null; G.edge = null; }
    layoutGraph(G.model); fitView(host); renderGraphInto(host, G.model); syncFoldBtn();
  }

  function wireGraphControls() {
    var zi = document.getElementById('gZoomIn'), zo = document.getElementById('gZoomOut');
    var fit = document.getElementById('gFit'), auto = document.getElementById('gAuto');
    var ext = document.getElementById('gExt'), clr = document.getElementById('gClear');
    if (zi) zi.onclick = function () { var host = graphHost(); if (!host) return; var w = host.clientWidth || 800, h = host.clientHeight || 600; zoomAt(w / 2, h / 2, 1.25); };
    if (zo) zo.onclick = function () { var host = graphHost(); if (!host) return; var w = host.clientWidth || 800, h = host.clientHeight || 600; zoomAt(w / 2, h / 2, 0.8); };
    if (fit) fit.onclick = function () { var host = graphHost(); if (!host || !G.model) return; fitView(host); applyView(); };
    if (auto) auto.onclick = function () {
      var host = graphHost(); if (!host || !G.model) return;
      G.pos = {}; savePositions(); layoutGraph(G.model); fitView(host); renderGraphInto(host, G.model);
    };
    if (ext) ext.onclick = function () {
      var host = graphHost(); if (!host || !G.model) return;
      G.showExt = !G.showExt;
      ext.textContent = G.showExt ? '隐藏外部库' : '显示外部库';
      if (ext.classList && ext.classList.toggle) ext.classList.toggle('on', !G.showExt);
      layoutGraph(G.model); fitView(host); renderGraphInto(host, G.model);
    };
    if (clr) clr.onclick = function () { var host = graphHost(); if (!host || !G.model) return; G.selected = null; G.edge = null; renderGraphInto(host, G.model); };
    var fold = document.getElementById('gFold');
    if (fold) fold.onclick = function () {
      var host = graphHost(); if (!host || !G.model) return;
      var cols = G.model.layerCols || [];
      var anyOpen = cols.some(function (c) { return !c.folded; });
      cols.forEach(function (c) { G.collapsed[c.layer] = anyOpen; });
      var sel = G.model.byPkg[G.selected];
      if (G.selected && sel && !sel.ext && layerFolded(sel.layer)) { G.selected = null; G.edge = null; }
      layoutGraph(G.model); fitView(host); renderGraphInto(host, G.model); syncFoldBtn();
    };
    var ps = document.getElementById('gPalSearch');
    if (ps) {
      ps.value = G.palSearch;
      ps.oninput = function () { G.palSearch = ps.value || ''; renderPalette(); };
    }

    document.addEventListener('mousemove', function (e) {
      var host = graphHost();
      if (G.nodeDrag) {
        var dx = e.clientX - G.sx, dy = e.clientY - G.sy;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) G.moved = true;
        var g = G.model.byPkg[G.nodeDrag.pkg];
        if (!g) return;
        var p = svgPoint(host, e.clientX, e.clientY);
        g.x = Math.round(G.nodeDrag.ox + (p.x - G.nodeDrag.sx));
        g.y = Math.round(G.nodeDrag.oy + (p.y - G.nodeDrag.sy));
        updateNodeVisual(host, G.nodeDrag.pkg);
        setTrashHot(!g.ext && overTrash(e.clientX, e.clientY));
        return;
      }
      setTrashHot(false);
      if (!G.dragging) return;
      var pdx = e.clientX - G.sx, pdy = e.clientY - G.sy;
      if (Math.abs(pdx) > 2 || Math.abs(pdy) > 2) G.moved = true;
      G.tx = G.ox + pdx; G.ty = G.oy + pdy; applyView();
    });
    document.addEventListener('mouseup', function (e) {
      var host = graphHost();
      if (G.nodeDrag) {
        var nd = G.nodeDrag; G.nodeDrag = null;
        setTrashHot(false);
        if (G.moved) {
          if (!(G.model.byPkg[nd.pkg] && G.model.byPkg[nd.pkg].ext) && overTrash(e.clientX, e.clientY)) {
            removeNode(nd.pkg);
            G.dragging = false;
            return;
          }
          G.pos[nd.pkg] = { x: G.model.byPkg[nd.pkg].x, y: G.model.byPkg[nd.pkg].y };
          savePositions();
          layoutGraph(G.model); renderGraphInto(host, G.model);
        }
      }
      G.dragging = false;
    });
    document.addEventListener('keydown', function (e) {
      var k = e.key || '';
      if (k !== 'Delete' && k !== 'Backspace') return;
      var tag = e.target && e.target.tagName ? String(e.target.tagName).toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (!G.selected || !G.model) return;
      e.preventDefault();
      removeNode(G.selected);
    });
  }

  function initGraph() {
    var host = graphHost();
    if (!host || typeof host.querySelector !== 'function') return;
    if (!G.posLoaded) { G.pos = loadPositions(); G.posLoaded = true; }
    G.model = graphModel(); layoutGraph(G.model);
    G.selected = null;
    G.edge = null;
    fitView(host);
    renderGraphInto(host, G.model);
    syncFoldBtn();
    renderPalette();
    if (!G.wired) { G.wired = true; wireGraphControls(); }
  }

  window.__DSH_APP__ = { apply: apply, addRow: addRow, removeRow: removeRow, reset: reset, toggle: toggle, toggleFbGroup: toggleFbGroup, refresh: refresh, toggleSkin: toggleSkin, startAuto: startAuto, stopAuto: stopAuto, toggleAuto: toggleAuto, opsArchive: opsArchive, opsSimulate: opsSimulate, opsUpgrade: opsUpgrade, opsPlan: opsPlan, opsApply: opsApply, opsCheckVersions: opsCheckVersions, loadBridge: loadBridge, state: state };
})();