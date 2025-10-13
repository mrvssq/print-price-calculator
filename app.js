// =========================================
// ОПРЕДЕЛЕНИЕ ОКРУЖЕНИЯ (prod/dev/local)
// =========================================
const IS_FILE_PROTOCOL = location.protocol === 'file:';
const IS_LOCALHOST = /(^localhost$)|(^127\.0\.0\.1$)/i.test(location.hostname);
const DEV_PARAM = new URLSearchParams(location.search).get('env') === 'dev';
const DEV_HINT = IS_FILE_PROTOCOL || IS_LOCALHOST || DEV_PARAM;

// prod -> prices.json; dev (не file:) -> prices.dev.json; file: -> просим выбрать файл вручную
const PRICES_URL = DEV_HINT && !IS_FILE_PROTOCOL ? './prices.dev.json' : './prices.json';

// Глобальное хранилище прайса (пока не загружен — null)
let PRICES = null;

// Кэш DOM-элементов
const $lockOverlay = () => document.getElementById('lockOverlay');
const $lockMessage = () => document.getElementById('lockMessage');
const $lockHint = () => document.getElementById('lockHint');
const $devPanel = () => document.getElementById('devPanel');
const $testBadge = () => document.getElementById('testBadge');
const $devPricesDetails = () => document.getElementById('devPricesDetails');
const $priceJson = () => document.getElementById('priceJson');
const $btnLoadDevPrices = () => document.getElementById('btnLoadDevPrices');
const $priceFileInput = () => document.getElementById('priceFile');

// =======================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =======================
function deepMerge(target, source) {
  for (const k of Object.keys(source || {})) {
    if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
      if (!target[k]) target[k] = {};
      deepMerge(target[k], source[k]);
    } else {
      target[k] = source[k];
    }
  }
  return target;
}

function num(v) { return Number.parseFloat(v) || 0; }
function fmtMoney(n) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n);
}
function fmtNumber(n) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);
}

function calcETA(urgency) {
  const d = new Date();
  if (urgency === 'standard') d.setDate(d.getDate() + 2);
  if (urgency === 'urgent')   d.setDate(d.getDate() + 1);
  if (urgency === 'express')  d.setHours(d.getHours() + 3);

  // локальные настройки пользователя
  const locale = navigator.language || 'ru-RU';
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; // локальный TZ

  const fmt = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return fmt.format(d);
}


// =======================
// ЛОГИКА ЗАГРУЗКИ ПРАЙСА
// =======================
async function loadPricesFromUrl(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json;
}

function showDevUIIfNeeded() {
  if (DEV_HINT) {
    // показать дев-инструменты
    $devPanel()?.classList.remove('d-none');
    $testBadge()?.classList.remove('d-none');
    $devPricesDetails()?.classList.remove('d-none');
  } else {
    // скрыть дев-инструменты
    $devPanel()?.classList.add('d-none');
    $testBadge()?.classList.add('d-none');
    $devPricesDetails()?.classList.add('d-none');
  }
}

function lockUI(msg = 'Загружаем цены…', hint = '') {
  const o = $lockOverlay();
  const m = $lockMessage();
  const h = $lockHint();
  if (m) m.textContent = msg;
  if (h) h.textContent = hint;
  if (o) o.classList.add('show');
}

function unlockUI() {
  const o = $lockOverlay();
  if (o) o.classList.remove('show');
}

// =======================
// РАСЧЁТ
// =======================
function volumeDiscountRate(qty) {
  if (qty >= 1000) return 0.15;
  if (qty >= 700) return 0.12;
  if (qty >= 500) return 0.10;
  if (qty >= 300) return 0.07;
  if (qty >= 200) return 0.05;
  if (qty >= 100) return 0.03;
  return 0.0;
}

function computeTotal(s) {
  if (!PRICES) throw new Error('Цены не загружены');
  const basePerItem = PRICES.basePerItem_A6 * PRICES.sizeK[s.size] * PRICES.printK[s.print];
  const stockAdd = PRICES.stockSurchargePerItem[s.stock] || 0;
  const gsmAdd = PRICES.gsmSurchargePerItem[s.gsm] || 0;

  const perItem = basePerItem + stockAdd + gsmAdd;
  const qty = Math.max(50, Math.floor(s.qty / 50) * 50);
  const discount = volumeDiscountRate(qty);

  const printPart = perItem * qty;
  const discountValue = printPart * discount;
  const afterDiscount = printPart - discountValue;

  const urgencyK = PRICES.urgencyK[s.urgency];
  const afterUrgency = afterDiscount * urgencyK;

  const designFee = PRICES.designFee[s.design] || 0;
  const subtotalNoVat = afterUrgency + designFee;
  const vatValue = subtotalNoVat * PRICES.vat;
  const total = subtotalNoVat + vatValue;

  return { perItem, qty, discount, discountValue, afterDiscount, urgencyK, afterUrgency, designFee, subtotalNoVat, vatValue, total };
}

// =======================
// UI state <-> DOM
// =======================
function readState() {
  return {
    design: $('input[name="design"]:checked').val(),
    size: $('input[name="size"]:checked').val(),
    stock: $('input[name="stock"]:checked').val(),
    gsm: $('input[name="gsm"]:checked').val(),
    print: $('#print').val(),
    qty: num($('#qty').val()),
    urgency: $('#urgency').val()
  };
}

function applyStateToUI(s) {
  $('input[name="design"][value="' + s.design + '"]').prop('checked', true);
  $('input[name="size"][value="' + s.size + '"]').prop('checked', true);
  $('input[name="stock"][value="' + s.stock + '"]').prop('checked', true);
  $('input[name="gsm"][value="' + s.gsm + '"]').prop('checked', true);
  $('#print').val(s.print);
  $('#qty').val(s.qty);
  const preset = [50, 100, 200, 300, 400, 500, 700, 1000].includes(s.qty) ? String(s.qty) : 'custom';
  $('#qtyPreset').val(preset);
  $('#urgency').val(s.urgency);
}

function serializeToQuery(s) { return '?' + new URLSearchParams(s).toString(); }
function parseFromQuery() {
  const p = new URLSearchParams(location.search);
  if (!p || [...p.keys()].length === 0) return null;
  return {
    design: p.get('design') || 'none',
    size: p.get('size') || 'A6',
    stock: p.get('stock') || 'gloss',
    gsm: p.get('gsm') || '130',
    print: p.get('print') || 'single',
    qty: num(p.get('qty') || '500'),
    urgency: p.get('urgency') || 'standard'
  };
}

function recalc() {
  if (!PRICES) return; // ещё заблокировано
  const s = readState();
  const r = computeTotal(s);

  $('#qty').val(r.qty);
  $('#lineSize').text(s.size === 'EURO' ? 'Евро (210×98)' : s.size);
  $('#lineStock').text({ gloss: 'Глянцевая', matte: 'Матовая', ccg: 'Color Copy Gloss', dns: 'DNS без покрытия' }[s.stock]);
  $('#lineGsm').text(s.gsm + (PRICES.gsmSurchargePerItem[s.gsm] > 0 ? ` (+${fmtMoney(PRICES.gsmSurchargePerItem[s.gsm] * r.qty)})` : ''));
  $('#linePrint').text({ single: 'Односторонняя', double: 'Двусторонняя' }[s.print]);
  $('#lineDiscount').text(r.discount > 0 ? `− ${fmtMoney(r.discountValue)}` : '—');
  $('#lineUrgency').text('×' + fmtNumber(r.urgencyK));
  $('#lineDesign').text(r.designFee > 0 ? fmtMoney(r.designFee) : '—');

  $('#subtotal').text(fmtMoney(r.subtotalNoVat));
  $('#vat').text(fmtMoney(r.vatValue));
  $('#total').text(fmtMoney(r.total));
  $('#eta').text('Будет готово: ' + calcETA(s.urgency));

  // В дев-режиме покажем фактически загруженный прайс
  if (DEV_HINT && $priceJson()) {
    $priceJson().textContent = JSON.stringify(PRICES, null, 2);
  }

  history.replaceState(null, '', serializeToQuery(s));
}

// =======================
// ТЕСТЫ (только для локального/dev)
// =======================
function runTests() {
  const badge = $testBadge();
  if (!badge) return;
  function setBadge(ok, text) {
    badge.className = 'badge test-badge ' + (ok ? 'text-bg-success' : 'text-bg-danger');
    badge.textContent = text;
  }
  function approxEqual(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }
  function assert(name, cond) { if (!cond) throw new Error('❌ ' + name); console.debug('✅', name); }

  try {
    const s1 = { design: 'none', size: 'A6', stock: 'gloss', gsm: '130', print: 'single', qty: 100, urgency: 'standard' };
    const r1 = computeTotal(s1);
    const perItem1 = PRICES.basePerItem_A6 * PRICES.sizeK.A6 * PRICES.printK.single + 0 + 0;
    const qty1 = 100; const disc1 = 0.03;
    const expSubtotal1 = (perItem1 * qty1 * (1 - disc1)) * 1.0 + 0;
    const expVat1 = expSubtotal1 * PRICES.vat;
    const expTotal1 = expSubtotal1 + expVat1;
    assert('Case1 total', approxEqual(r1.total, expTotal1));

    const r2 = computeTotal({ ...s1, print: 'double' });
    assert('Double-sided > single-sided', r2.total > r1.total);

    const r3 = computeTotal({ ...s1, gsm: '300' });
    const delta3 = r3.subtotalNoVat - r1.subtotalNoVat;
    const expectedDelta3 = PRICES.gsmSurchargePerItem['300'] * qty1 * (1 - disc1) * 1.0;
    assert('GSM 300 delta pre-VAT correct', approxEqual(delta3, expectedDelta3));

    const r4 = computeTotal({ ...s1, urgency: 'express' });
    assert('Express about x2 vs standard', approxEqual(r4.subtotalNoVat, r1.subtotalNoVat * PRICES.urgencyK.express));

    const r5a = computeTotal({ ...s1, qty: 100 });
    const r5b = computeTotal({ ...s1, qty: 1000 });
    assert('Discount grows with qty', r5b.discount > r5a.discount);

    setBadge(true, 'Тесты пройдены ✅');
  } catch (e) {
    console.error(e);
    setBadge(false, 'Тесты провалены ❌');
  }
}

// =======================
// ОБРАБОТЧИКИ СОБЫТИЙ
// =======================
$(document).on('change input', 'input, select', function () {
  if (!PRICES) return; // игнор до загрузки
  if (this.id === 'qtyPreset') {
    const v = $('#qtyPreset').val();
    if (v === 'custom') $('#qty').trigger('focus'); else $('#qty').val(v);
  } else if (this.id === 'qty') {
    const v = num($('#qty').val());
    const match = [50, 100, 200, 300, 400, 500, 700, 1000].includes(v) ? String(v) : 'custom';
    $('#qtyPreset').val(match);
  }
  recalc();
});

$('#btnShare').on('click', async function () {
  if (!PRICES) return;
  try {
    await navigator.clipboard.writeText(location.href);
    this.textContent = 'Ссылка скопирована';
    setTimeout(() => this.textContent = 'Поделиться расчётом', 1500);
  } catch {
    alert('Не удалось скопировать ссылку. Скопируйте из адресной строки.');
  }
});

$('#btnReset').on('click', function () {
  if (!PRICES) return;
  applyStateToUI({ design: 'none', size: 'A6', stock: 'gloss', gsm: '130', print: 'single', qty: 500, urgency: 'standard' });
  recalc();
});

$('#btnDownload').on('click', function () {
  if (!PRICES) return;
  window.print(); // контраст для печати задаётся в @media print в app.css
});

// Дев-панель: ручная загрузка dev-прайса локально через FileReader (без CORS)
$btnLoadDevPrices()?.addEventListener('click', () => $priceFileInput()?.click());
$priceFileInput()?.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    PRICES = {};
    deepMerge(PRICES, json);
    console.info('✅ Цены загружены из локального файла', file.name, PRICES);
    afterPricesReady(/*source*/ `file:${file.name}`);
  } catch (err) {
    console.error('❌ Ошибка чтения файла прайса', err);
    lockUI('Не удалось прочитать файл цен', 'Выберите корректный JSON.');
  }
});

// =======================
// ЖИЗНЕННЫЙ ЦИКЛ
// =======================
function afterPricesReady(sourceLabel = PRICES_URL) {
  // Инициализируем тултипы
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.forEach(el => new bootstrap.Tooltip(el));

  // Применим состояние из URL (если есть)
  const fromQuery = parseFromQuery();
  if (fromQuery) applyStateToUI(fromQuery);

  // Снимем блокировку и пересчитаем
  unlockUI();
  recalc();

  // Дев-UI
  showDevUIIfNeeded();
  if (DEV_HINT) {
    // Заполним отладочный JSON прайса
    if ($priceJson()) $priceJson().textContent = JSON.stringify(PRICES, null, 2);
    // Автотесты только в деве
    runTests();
    // Подсказка, откуда загружено
    if ($lockHint()) $lockHint().textContent = `Источник цен: ${sourceLabel}`;
  }
}

(async function bootstrap() {
  // Покажем/спрячем дев-элементы заранее (частично), заблокируем UI
  showDevUIIfNeeded();
  lockUI('Загружаем цены…', DEV_HINT ? 'DEV режим активен' : '');

  // Особый случай: открытие по file:// — fetch к JSON обычно невозможен из-за CORS/FS политики.
  if (IS_FILE_PROTOCOL) {
    // Предложим загрузить файл вручную
    lockUI('Открыт локальный файл', 'Выберите prices.dev.json через кнопку выше.');
    return; // оставляем заблокированным до ручной загрузки
  }

  // Пытаемся загрузить цены из URL (prod/dev)
  try {
    const json = await loadPricesFromUrl(PRICES_URL);
    PRICES = {};
    deepMerge(PRICES, json);
    console.info('✅ Загружены цены из', PRICES_URL);
    afterPricesReady(PRICES_URL);
  } catch (err) {
    console.error(`❌ Не удалось загрузить ${PRICES_URL}`, err);
    if (DEV_HINT) {
      lockUI('Не удалось загрузить цены', 'В DEV можно выбрать файл prices.dev.json вручную.');
      // оставляем заблокированным, пользователь может выбрать файл на dev-панели
    } else {
      lockUI('Калькулятор недоступен', 'Не удалось загрузить цены. Попробуйте позже.');
    }
  }
})();
