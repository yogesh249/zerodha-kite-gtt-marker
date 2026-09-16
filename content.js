/**
 * Kite GTT Marker
 *
 * /orders/gtt   -> suitcase (💼) on active GTT rows with a matching holding/position
 * /holdings*    -> rocket (🚀) on holdings that have an active GTT; clickable to expand GTT details
 * /positions*   -> rocket (🚀) on positions that have an active GTT; clickable to expand GTT details
 */
(function () {
  'use strict';

  const ICON_SUITCASE = '💼';
  const ICON_ROCKET = '🚀';
  const MARK_ATTR = 'data-kgm-icon';
  const EXPAND_ROW_ATTR = 'data-kgm-expand';

  const API_REFRESH_MS = 20000;
  const DOM_DEBOUNCE_MS = 250;

  // For positions/holdings:
  //   cache.map: Map<rowKey, GTT[]>  (rowKey -> all matching active GTT triggers)
  // For gtt:
  //   cache.keys: Set<string> of trigger ids to mark with suitcase
  let cache = { mode: null, map: new Map(), keys: new Set(), icon: null };
  let domDebounceTimer = null;

  // ---------- auth ----------

  function getEncToken() {
    const m = document.cookie.match(/(?:^|;\s*)enctoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function apiGet(path) {
    const token = getEncToken();
    if (!token) { console.warn('[KGM] no enctoken', path); return null; }
    try {
      const res = await fetch(`https://kite.zerodha.com${path}`, {
        credentials: 'include',
        headers: { Authorization: `enctoken ${token}` }
      });
      if (!res.ok) { console.warn('[KGM] request failed', path, res.status); return null; }
      const json = await res.json();
      return json.status === 'success' ? json.data : null;
    } catch (e) { console.warn('[KGM] fetch error', path, e); return null; }
  }

  // ---------- fetchers ----------

  async function fetchActiveGttTriggers() {
    const data = await apiGet('/oms/gtt/triggers');
    return (data || []).filter((t) => t.status === 'active');
  }

  async function fetchHoldings() {
    return (await apiGet('/oms/portfolio/holdings')) || [];
  }

  async function fetchPositions() {
    const data = await apiGet('/oms/portfolio/positions');
    if (!data) return [];
    return [...(data.net || []), ...(data.day || [])];
  }

  // ---------- page ----------

  function detectMode() {
    const p = location.pathname;
    if (p.startsWith('/orders/gtt')) return 'gtt';
    if (p.startsWith('/holdings')) return 'holdings';
    if (p.startsWith('/positions')) return 'positions';
    return null;
  }

  // ---------- DOM helpers ----------

  function instrumentCell(row) {
    return row.querySelector('td[class*="instrument"]');
  }

  function rowKey(row, mode) {
    const uid = row.getAttribute('data-uid');
    if (!uid) return null;
    if (mode === 'positions') {
      const m = uid.match(/^position\.(\d+)\./);
      return m ? Number(m[1]) : null;
    }
    return uid; // holdings -> isin, gtt -> trigger id
  }

  // ---------- GTT detail formatting ----------

  function formatDate(str) {
    // "2026-09-11 15:27:35" -> "11 Sep 2026"
    const d = new Date(str.replace(' ', 'T'));
    return isNaN(d) ? str : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatGttRow(t) {
	

    const o = t.orders && t.orders[0];
    if (!o) return null;
    const trigger = (t.condition.trigger_values || [])[0];
    const txn = o.transaction_type; // BUY / SELL
	const color = txn === 'SELL' ? '#e04040' : '#2196f3';
    const qty = o.quantity;
    const limitPrice = o.price;
    const orderType = o.order_type; // LIMIT / MARKET
    const date = formatDate(t.created_at);
    const triggerStr = trigger != null ? trigger : '—';
    return {
      id: t.id,
      date,
	  line: `<span style="font-weight:700;color:${color}">${txn}</span> ${qty} @ trigger ${triggerStr}, ${orderType} ${limitPrice}`    };
  }

  // ---------- expand row ----------

  function expandRowId(row) {
    return `kgm-expand-${row.getAttribute('data-uid')}`;
  }

  function removeExpandRow(row) {
    const id = expandRowId(row);
    const old = document.getElementById(id);
    if (old) old.remove();
    row.removeAttribute(EXPAND_ROW_ATTR);
  }

  function insertExpandRow(row, gtts) {
    removeExpandRow(row); // clear any old one first
    const colCount = row.querySelectorAll('td').length || 8;
    const id = expandRowId(row);

    const details = gtts.map(formatGttRow).filter(Boolean);
    if (!details.length) return;

    const html = details.map((d) =>
      `<div class="kgm-gtt-entry">
        <span class="kgm-gtt-id">GTT #${d.id}</span>
        <span class="kgm-gtt-date">${d.date}</span>
        <span class="kgm-gtt-line">${d.line}</span>
      </div>`
    ).join('');

    const tr = document.createElement('tr');
    tr.id = id;
    tr.className = 'kgm-expand-row';
    tr.innerHTML = `<td colspan="${colCount}" class="kgm-expand-td">${html}</td>`;

    row.after(tr);
    row.setAttribute(EXPAND_ROW_ATTR, '1');
  }

  function toggleExpand(row, gtts) {
    if (row.getAttribute(EXPAND_ROW_ATTR)) {
      removeExpandRow(row);
    } else {
      insertExpandRow(row, gtts);
    }
  }

  // ---------- icon injection ----------

  function injectSuitcase(cell) {
    if (!cell || cell.getAttribute(MARK_ATTR) === 'suitcase') return;
    const ex = cell.querySelector('span.kgm-icon');
    if (ex) ex.remove();
    const span = document.createElement('span');
    span.className = 'kgm-icon';
    span.textContent = ICON_SUITCASE;
    cell.prepend(span);
    cell.setAttribute(MARK_ATTR, 'suitcase');
  }

  function injectRocket(cell, row, gtts) {
    if (!cell) return;
    // If already injected for this exact row, just refresh the gtts reference on the btn
    const existing = cell.querySelector('button.kgm-rocket-btn');
    if (existing) {
      existing._kgmGtts = gtts;
      cell.setAttribute(MARK_ATTR, 'rocket');
      return;
    }
    const oldIcon = cell.querySelector('span.kgm-icon');
    if (oldIcon) oldIcon.remove();

    const btn = document.createElement('button');
    btn.className = 'kgm-icon kgm-rocket-btn';
    btn.textContent = ICON_ROCKET;
    btn.title = 'Toggle GTT details';
    btn._kgmGtts = gtts;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleExpand(row, btn._kgmGtts);
    });
    cell.prepend(btn);
    cell.setAttribute(MARK_ATTR, 'rocket');
  }

  function clearAllIcons() {
    // remove expand rows
    document.querySelectorAll('tr.kgm-expand-row').forEach((el) => el.remove());
    // remove icon spans/buttons and attrs
    document.querySelectorAll(`[${MARK_ATTR}]`).forEach((el) => {
      el.querySelector('.kgm-icon')?.remove();
      el.removeAttribute(MARK_ATTR);
      el.removeAttribute(EXPAND_ROW_ATTR);
    });
  }

  // ---------- apply ----------

  function applyMarkers() {
    const { mode, map, keys, icon } = cache;
    if (!mode) return;

    const rows = document.querySelectorAll('tr[data-uid]');
    rows.forEach((row) => {
      const key = rowKey(row, mode);
      if (key == null) return;
      const cell = instrumentCell(row);

      if (mode === 'gtt') {
        if (keys.has(key)) injectSuitcase(cell);
      } else {
        const gtts = map.get(key);
        if (gtts && gtts.length) injectRocket(cell, row, gtts);
      }
    });
  }

  // ---------- refresh ----------

  async function refreshData() {
    const mode = detectMode();
    if (!mode) { cache = { mode: null, map: new Map(), keys: new Set(), icon: null }; return; }

    const activeTriggers = await fetchActiveGttTriggers();

    if (mode === 'gtt') {
      const [holdings, positions] = await Promise.all([fetchHoldings(), fetchPositions()]);
      const ownedTokens = new Set();
      for (const h of holdings) {
        const qty = (h.quantity || 0) || (h.opening_quantity || 0) || (h.collateral_quantity || 0);
        if (qty && h.instrument_token != null) ownedTokens.add(h.instrument_token);
      }
      for (const p of positions) {
        if ((p.quantity || 0) !== 0 && p.instrument_token != null) ownedTokens.add(p.instrument_token);
      }
      const keys = new Set();
      for (const t of activeTriggers) {
        const tok = t.condition && t.condition.instrument_token;
        if (tok != null && ownedTokens.has(tok)) keys.add(String(t.id));
      }
      cache = { mode, map: new Map(), keys, icon: ICON_SUITCASE };

    } else if (mode === 'holdings') {
      // Build token -> [gtts] map
      const tokenMap = new Map();
      for (const t of activeTriggers) {
        const tok = t.condition && t.condition.instrument_token;
        if (tok == null) continue;
        if (!tokenMap.has(tok)) tokenMap.set(tok, []);
        tokenMap.get(tok).push(t);
      }
      const holdings = await fetchHoldings();
      const map = new Map(); // isin -> [gtts]
      for (const h of holdings) {
        if (!h.isin || !h.instrument_token) continue;
        const gtts = tokenMap.get(h.instrument_token);
        if (gtts && gtts.length) map.set(h.isin, gtts);
      }
      cache = { mode, map, keys: new Set(), icon: ICON_ROCKET };

    } else {
      // positions: instrument_token -> [gtts]
      const map = new Map();
      for (const t of activeTriggers) {
        const tok = t.condition && t.condition.instrument_token;
        if (tok == null) continue;
        if (!map.has(tok)) map.set(tok, []);
        map.get(tok).push(t);
      }
      cache = { mode, map, keys: new Set(), icon: ICON_ROCKET };
    }

    applyMarkers();
  }

  function scheduleDomApply() {
    clearTimeout(domDebounceTimer);
    domDebounceTimer = setTimeout(applyMarkers, DOM_DEBOUNCE_MS);
  }

  function startObserving() {
    const observer = new MutationObserver(scheduleDomApply);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function watchUrlChanges() {
    let last = location.href;
    setInterval(() => {
      if (location.href !== last) {
        last = location.href;
        clearAllIcons();
        setTimeout(refreshData, 500);
      }
    }, 800);
  }

  function init() {
    refreshData();
    setInterval(refreshData, API_REFRESH_MS);
    startObserving();
    watchUrlChanges();
  }

  init();
})();
