/**
 * Kite GTT Marker
 *
 * Runs inside the already-logged-in kite.zerodha.com tab, so it never
 * stores or hardcodes any token/cookie itself. At call time it reads the
 * `enctoken` cookie the page already has (same technique the page's own
 * JS uses) and calls Kite's internal endpoints with it.
 *
 * Pages:
 *   /orders/gtt   -> suitcase (💼) before any ACTIVE GTT row whose
 *                    tradingsymbol also shows up in holdings or positions
 *   /holdings*    -> rocket (🚀) before any holding that has an ACTIVE GTT
 *   /positions*   -> rocket (🚀) before any position that has an ACTIVE GTT
 */
(function () {
  'use strict';

  const ICON_SUITCASE = '💼';
  const ICON_ROCKET = '🚀';
  const MARK_ATTR = 'data-kgm-icon';

  const API_REFRESH_MS = 20000; // how often we re-hit the Kite API
  const DOM_DEBOUNCE_MS = 250; // how fast we re-apply cached markers after DOM churn

  // cache.keys holds the set of "matching" row keys for the current page:
  //   positions -> Set<number> of instrument_token
  //   holdings  -> Set<string> of isin
  //   gtt       -> Set<string> of trigger id
  let cache = { mode: null, keys: new Set(), icon: null };
  let domDebounceTimer = null;
  let apiTimer = null;

  // ---------- auth ----------

  function getEncToken() {
    const m = document.cookie.match(/(?:^|;\s*)enctoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function apiGet(path) {
    const token = getEncToken();
    if (!token) {
      console.warn('[Kite GTT Marker] no enctoken cookie found, skipping', path);
      return null;
    }
    try {
      const res = await fetch(`https://kite.zerodha.com${path}`, {
        credentials: 'include',
        headers: { Authorization: `enctoken ${token}` }
      });
      if (!res.ok) {
        console.warn('[Kite GTT Marker] request failed', path, res.status);
        return null;
      }
      const json = await res.json();
      if (json.status !== 'success') return null;
      return json.data;
    } catch (e) {
      console.warn('[Kite GTT Marker] fetch error', path, e);
      return null;
    }
  }

  // ---------- data fetchers ----------
  // Kite's DOM doesn't render the raw tradingsymbol string (e.g.
  // "NIFTY2691523000PE") anywhere — it shows a human-readable label
  // instead. So instead of text-matching, we join rows to API data via
  // stable identifiers already present in each row's data-uid attribute:
  //   positions row data-uid: "position.{instrument_token}.{product}{n}"
  //   holdings row data-uid:  "{isin}"
  //   gtt row data-uid:       "{trigger_id}"

  async function fetchActiveGttTriggers() {
    const data = await apiGet('/oms/gtt/triggers');
    if (!data) return [];
    return data.filter((t) => t.status === 'active');
  }

  async function fetchHoldings() {
    const data = await apiGet('/oms/portfolio/holdings');
    return data || [];
  }

  async function fetchPositions() {
    const data = await apiGet('/oms/portfolio/positions');
    if (!data) return [];
    return [...(data.net || []), ...(data.day || [])];
  }

  // ---------- page detection ----------

  function detectMode() {
    const path = location.pathname;
    if (path.startsWith('/orders/gtt')) return 'gtt';
    if (path.startsWith('/holdings')) return 'holdings';
    if (path.startsWith('/positions')) return 'positions';
    return null;
  }

  // ---------- matching / DOM ----------

  // Every row across positions/holdings/gtt has a td whose class list
  // includes "instrument" (verified against the real Kite DOM) — this is
  // where we prepend the icon, regardless of which page we're on.
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
    // holdings: uid is the isin. gtt: uid is the trigger id. Both used as-is.
    return uid;
  }

  function injectIcon(cell, icon) {
    if (!cell) return;
    if (cell.getAttribute(MARK_ATTR) === icon) return; // already marked with this icon
    // remove any stale icon from a previous mode/refresh
    const existing = cell.querySelector(`span.kgm-icon`);
    if (existing) existing.remove();
    const span = document.createElement('span');
    span.className = 'kgm-icon';
    span.textContent = icon;
    cell.prepend(span);
    cell.setAttribute(MARK_ATTR, icon);
  }

  function clearAllIcons() {
    document.querySelectorAll(`[${MARK_ATTR}]`).forEach((el) => {
      const icon = el.querySelector('span.kgm-icon');
      if (icon) icon.remove();
      el.removeAttribute(MARK_ATTR);
    });
  }

  function applyMarkers() {
    if (!cache.mode || !cache.keys.size) return;
    const rows = document.querySelectorAll('tr[data-uid]');
    rows.forEach((row) => {
      const key = rowKey(row, cache.mode);
      if (key == null) return;
      if (!cache.keys.has(key)) return;
      injectIcon(instrumentCell(row), cache.icon);
    });
  }

  // ---------- refresh cycle ----------

  async function refreshData() {
    const mode = detectMode();
    if (!mode) {
      cache = { mode: null, keys: new Set(), icon: null };
      return;
    }

    const activeTriggers = await fetchActiveGttTriggers();
    let keys;
    let icon;

    if (mode === 'gtt') {
      // suitcase on a GTT row if its instrument_token shows up in a real
      // holding or an open position
      const [holdings, positions] = await Promise.all([fetchHoldings(), fetchPositions()]);
      const ownedTokens = new Set();
      for (const h of holdings) {
        const qty = (h.quantity || 0) || (h.opening_quantity || 0) || (h.collateral_quantity || 0);
        if (qty && h.instrument_token != null) ownedTokens.add(h.instrument_token);
      }
      for (const p of positions) {
        if ((p.quantity || 0) !== 0 && p.instrument_token != null) ownedTokens.add(p.instrument_token);
      }
      keys = new Set();
      for (const t of activeTriggers) {
        const tok = t.condition && t.condition.instrument_token;
        if (tok != null && ownedTokens.has(tok)) keys.add(String(t.id));
      }
      icon = ICON_SUITCASE;
    } else if (mode === 'holdings') {
      // rocket on a holding row (keyed by isin) if that instrument has an
      // active GTT
      const activeTokens = new Set(
        activeTriggers.map((t) => t.condition && t.condition.instrument_token).filter((x) => x != null)
      );
      const holdings = await fetchHoldings();
      keys = new Set();
      for (const h of holdings) {
        if (h.isin && activeTokens.has(h.instrument_token)) keys.add(h.isin);
      }
      icon = ICON_ROCKET;
    } else {
      // positions: rocket if the row's instrument_token has an active GTT
      keys = new Set(
        activeTriggers.map((t) => t.condition && t.condition.instrument_token).filter((x) => x != null)
      );
      icon = ICON_ROCKET;
    }

    cache = { mode, keys, icon };
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
        // give the SPA a moment to render the new page before refetching
        setTimeout(refreshData, 500);
      }
    }, 800);
  }

  function init() {
    refreshData();
    apiTimer = setInterval(refreshData, API_REFRESH_MS);
    startObserving();
    watchUrlChanges();
  }

  init();
})();
