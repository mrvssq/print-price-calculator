/* common.js — общие утилиты проекта (универсальный prices.json)
   Экспорт: window.Common
*/
;(function () {
  'use strict';

  // ============ ENV ============
  const IS_FILE_PROTOCOL = location.protocol === 'file:';
  const IS_LOCALHOST = /(^localhost$)|(^127\.0\.0\.1$)/i.test(location.hostname);
  const DEV_PARAM = new URLSearchParams(location.search).get('env') === 'dev';
  const DEV_HINT = IS_FILE_PROTOCOL || IS_LOCALHOST || DEV_PARAM;

  // ============ DOM HELPERS ============
  const $ = window.jQuery;
  const byId = (id) => document.getElementById(id);

  // ============ FORMAT / PARSE ============
  const fmtMoney = (n) =>
    new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })
      .format(Number(n) || 0);

  const fmtNumber = (n) =>
    new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(n) || 0);

  const num = (v) => Number.parseFloat(v) || 0;
  const truthy = (v) => /^(1|true|yes)$/i.test(String(v ?? ''));

  // Ограничение ввода до N цифр (возвращает функцию-отписку)
  function bindMaxDigits(inputEl, maxDigits = 10) {
    if (!inputEl) return () => {};
    const handler = () => {
      const raw = String(inputEl.value || '');
      const fixed = raw.replace(/\D/g, '').slice(0, maxDigits);
      if (fixed !== raw) inputEl.value = fixed || '1';
    };
    inputEl.addEventListener('input', handler);
    return () => inputEl.removeEventListener('input', handler);
  }

  // ============ PRICES I/O ============
  async function loadPricesFromUrl(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Слить shared → product (неглубоко). product имеет приоритет.
  function getProductConfig(PRICES, productKey) {
    const product = PRICES?.products?.[productKey] || {};
    return {
      urgencyK: PRICES?.shared?.urgencyK,
      designFee: PRICES?.shared?.fees?.designFee,
      ...product,
    };
  }

  // ============ UI LOCK / DEV UI ============
  function lockUI(msg = 'Загружаем цены…', hint = '') {
    const o = byId('lockOverlay');
    if (!o) return;
    o.classList.remove('d-none'); o.classList.add('d-flex');
    const m = byId('lockMessage'); if (m) m.textContent = msg;
    const h = byId('lockHint');    if (h) h.textContent = hint || '';
  }

  function unlockUI() {
    const o = byId('lockOverlay');
    if (!o) return;
    o.classList.add('d-none'); o.classList.remove('d-flex');
    const m = byId('lockMessage'); if (m) m.textContent = '';
    const h = byId('lockHint');    if (h) h.textContent = '';
  }

  // Показ/скрытие dev-панелей по стандартным id; можно кинуть свои ids
  function showDevUIIfNeeded(extraIds = []) {
    const ids = ['devPanel', 'testBadge', 'devPricesDetails_', ...extraIds];
    ids.forEach((id) => {
      const el = byId(id);
      if (!el) return;
      el.classList.toggle('d-none', !DEV_HINT);
    });
  }

  // ============ ETA ============
  // +N рабочих дней (без праздников; Сб/Вс пропускаем)
  function addWorkDays(date, days = 1) {
    const d = new Date(date);
    let left = Number(days) || 0;
    while (left > 0) {
      d.setDate(d.getDate() + 1);
      const wd = d.getDay(); // 0=Вс,6=Сб
      if (wd !== 0 && wd !== 6) left--;
    }
    return d;
  }

  // «1 день» или «+3 часа»
  function calcETA(urgency) {
    const d = new Date();
    if (urgency === 'oneday') return addWorkDays(d, 1);
    if (urgency === 'express') { d.setHours(d.getHours() + 3); return d; }
    return d;
  }

  // ============ URL HELPERS ============
  // Без знания бизнес-полей — просто атомарная замена query-строки
  function updateUrlFromState(qsOrObject) {
    const qs = typeof qsOrObject === 'string'
      ? qsOrObject
      : new URLSearchParams(Object.entries(qsOrObject || {})).toString();
    const url = `${location.pathname}?${qs}${location.hash || ''}`;
    // micro-task достаточно; при желании можно добавить debounce
    Promise.resolve().then(() => history.replaceState(null, '', url));
  }

  // ============ SHARE ============
  async function shareUrlOrCopy(url = location.href, title = document.title) {
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return 'shared';
      }
      await navigator.clipboard.writeText(url);
      return 'copied';
    } catch {
      return 'unavailable';
    }
  }

  // ============ PRINT ONLY RECEIPT ============
  let __printHolder = null;
  function enterPrintMode(elementId = 'totalBlock') {
    const el = byId(elementId);
    if (!el) return;
    __printHolder = document.createElement('div');
    __printHolder.style.display = 'none';
    el.parentNode.insertBefore(__printHolder, el);
    document.body.appendChild(el);
    document.body.classList.add('print-mode');
  }
  function exitPrintMode(elementId = 'totalBlock') {
    const el = byId(elementId);
    if (!el) return;
    if (__printHolder && __printHolder.parentNode) {
      __printHolder.parentNode.insertBefore(el, __printHolder);
      __printHolder.remove();
    }
    __printHolder = null;
    document.body.classList.remove('print-mode');
  }
  // Автовозврат после системной печати
  if (window.matchMedia) {
    const mqp = window.matchMedia('print');
    const handler = (e) => { if (!e.matches) exitPrintMode(); };
    mqp.addEventListener ? mqp.addEventListener('change', handler) : mqp.addListener(handler);
  }
  window.addEventListener('afterprint', () => exitPrintMode());

  // ============ BOOTSTRAP TOOLTIP SAFE INIT ============
  function initTooltips() {
    const TooltipClass = window.bootstrap && window.bootstrap.Tooltip;
    if (!TooltipClass) return;
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
      if (!el._bsTooltip) el._bsTooltip = new TooltipClass(el);
    });
  }

  // ============ THEME (Bootstrap 5.3 data-bs-theme) ============
const THEME_STORAGE_KEY = 'bsTheme';

/** Прочитать текущую тему из атрибута <html data-bs-theme> или из localStorage */
function getTheme(root = document.documentElement) {
  return root.getAttribute('data-bs-theme') || localStorage.getItem(THEME_STORAGE_KEY) || 'light';
}

/** Установить тему ('light' | 'dark'), сохранить в localStorage и (опц.) обновить label */
function setTheme(theme = 'light', { root = document.documentElement, labelEl } = {}) {
  const next = (theme === 'dark') ? 'dark' : 'light';
  root.setAttribute('data-bs-theme', next);
  try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch {}
  if (labelEl) labelEl.textContent = (next === 'dark' ? 'Dark' : 'Light');
  return next;
}

/** Переключить тему и вернуть новую */
function toggleTheme(opts = {}) {
  const cur = getTheme(opts.root);
  return setTheme(cur === 'dark' ? 'light' : 'dark', opts);
}

/**
 * Инициализировать тему на странице.
 * @param {Object} options
 * @param {'light'|'dark'} [options.defaultTheme='light'] — дефолт, если в storage ничего нет
 * @param {string} [options.buttonId='themeToggle'] — id кнопки-тогглера
 * @param {string} [options.labelId='themeLabel'] — id подписи ("Light"/"Dark")
 * @param {string} [options.storageKey='bsTheme'] — ключ хранилища
 */
function initTheme({
  defaultTheme = 'light',
  buttonId = 'themeToggle',
  labelId = 'themeLabel',
  storageKey = THEME_STORAGE_KEY
} = {}) {
  // если ключ переопределён — обновим глобальную константу для совместимости
  if (storageKey && storageKey !== THEME_STORAGE_KEY) {
    try { localStorage.setItem(storageKey, localStorage.getItem(THEME_STORAGE_KEY) || defaultTheme); } catch {}
  }

  const root = document.documentElement;
  const saved = localStorage.getItem(storageKey) || defaultTheme;
  setTheme(saved, { root, labelEl: document.getElementById(labelId) });

  const btn = document.getElementById(buttonId);
  if (btn) {
    btn.addEventListener('click', () => {
      const labelEl = document.getElementById(labelId);
      toggleTheme({ root, labelEl });
    });
  }
}

  // ============ EXPORT ============
  window.Common = {
    // env
    IS_FILE_PROTOCOL,
    IS_LOCALHOST,
    DEV_PARAM,
    DEV_HINT,

    // io
    loadPricesFromUrl,
    getProductConfig,

    // ui lock & dev
    lockUI,
    unlockUI,
    showDevUIIfNeeded,

    // fmt/parse
    fmtMoney,
    fmtNumber,
    num,
    truthy,
    bindMaxDigits,

    // eta
    addWorkDays,
    calcETA,

    // url/share
    updateUrlFromState,
    shareUrlOrCopy,

    // print helpers
    enterPrintMode,
    exitPrintMode,

    // bootstrap
    initTooltips,

    getTheme,
    setTheme,
    toggleTheme,
    initTheme,

    // meta
    __version: '1.0.0'
  };
})();

// перенести ?env=dev в ссылки
  const qs = new URLSearchParams(location.search);
  const keepDev = qs.get('env') === 'dev';
  const withDev = (url) => {
    if (!keepDev) return url;
    const u = new URL(url, location.origin);
    const p = new URLSearchParams(u.search);
    p.set('env','dev'); u.search = p.toString();
    return u.pathname + (u.search ? '?' + p.toString() : '');
  };

  const map = [
    ['linkLeaflets', 'leaflets.html'],
    ['linkCards',    'business-cards.html']
  ];
  for (const [id, url] of map) {
    const a = document.getElementById(id);
    if (a) a.setAttribute('href', withDev(url));
  }

  // Подсветка активного
  const path = location.pathname.split('/').pop().toLowerCase();
  const activeIds = [];
  if (path.includes('leaflets'))   activeIds.push('linkLeaflets');
  if (path.includes('business-cards')) activeIds.push('linkCards');
  activeIds.forEach(id => document.getElementById(id)?.classList.add('active'));