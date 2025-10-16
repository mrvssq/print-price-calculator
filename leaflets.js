// ================== ENV ==================

const PRODUCT_KEY = 'leaflets';        // <-- эта страница = Листовки
const PRICES_URL  = './prices.json';   // universal prices.json

  // ===== Shortcuts из Common =====
  const {
    IS_FILE_PROTOCOL, DEV_HINT,
    loadPricesFromUrl, getProductConfig,
    fmtMoney, fmtNumber, num, truthy,
    lockUI, unlockUI, showDevUIIfNeeded,
    calcETA, updateUrlFromState, bindMaxDigits,
    shareUrlOrCopy, enterPrintMode, exitPrintMode,
    initTooltips
  } = window.Common;

// ================== DOM helpers ==================
const $ = window.jQuery;
const byId = (id) => document.getElementById(id);
const $lockOverlay = () => document.getElementById('lockOverlay');
const $lockMessage = () => document.getElementById('lockMessage');
const $lockHint    = () => document.getElementById('lockHint');
const $devPanel    = () => document.getElementById('devPanel');
const $testBadge   = () => document.getElementById('testBadge');
const $devPricesDetails = () => document.getElementById('devPricesDetails');
const $priceJson   = () => document.getElementById('priceJson');
const $btnLoadDevPrices = () => document.getElementById('btnLoadDevPrices');
const $priceFileInput   = () => document.getElementById('priceFile');

// ================== STATE ==================
let PRICES = null;   // весь файл
let CONF   = null;   // слитая конфа конкретного продукта (shared → product)


const DEFAULTS = {
  design:  'none',
  size:    'A4',
  print:   'single',
  stock:   'gloss',
  gsm:     '300',
  urgency: 'oneday',
  qty:     100,
  lam:     false,
  rnd:     false,
  cr:      0
};


// ================== STATE <-> UI / URL ==================
function readState(){
  const pick = (name, fallbackSelector, def) =>
    $('input[name="'+name+'"]:checked').val()
    || (fallbackSelector ? $(fallbackSelector).val() : null)
    || def;

  const s = {
    design:   pick('design', null, 'none'),
    size:     pick('size',   null, 'A6'),
    print:    pick('print',  null, 'single'),
    stock:    pick('stock',  null, 'gloss'),
    gsm:      pick('gsm',    null, '300'),

    lamination: $('#lamination').is(':checked'),
    creasing:   parseInt($('input[name="creasing"]:checked').val() ?? $('#creasing').val() ?? '0', 10) || 0,
    rounded:    $('#rounded').is(':checked'),

    qty: Math.max(1, num($('#qty').val())),
    urgency: pick('urgency', '#urgency', 'oneday')
  };

  return normalizeGsmByStock(s);
}

function applyStateToUI(s){
  const check = (name, val) => $('input[name="'+name+'"][value="'+val+'"]').prop('checked', true);

  check('design', s.design); check('size', s.size); check('print', s.print);
  check('stock', s.stock);   check('gsm', s.gsm);

  if ($('input[name="creasing"]').length) check('creasing', String(s.creasing));
  else $('#creasing').val(String(s.creasing));

  $('#lamination').prop('checked', !!s.lamination);
  $('#rounded').prop('checked',   !!s.rounded);

  $('#qty').val(s.qty);
  const preset=[1,10,50,100,200,500,1000].includes(s.qty)?String(s.qty):'custom';
  $('#qtyPreset').val(preset);

  $('#urgency').val(s.urgency);
}

function queryToState(){
  const q = new URLSearchParams(location.search);
  let s = {
    design:   q.get('design')  || DEFAULTS.design,
    size:     q.get('size')    || DEFAULTS.size,
    print:    q.get('print')   || DEFAULTS.print,
    stock:    q.get('stock')   || DEFAULTS.stock,
    gsm:      q.get('gsm')     || DEFAULTS.gsm,

    lamination: truthy(q.get('lam')),
    rounded:    truthy(q.get('rnd')),
    creasing:   q.get('cr') ? Math.max(0, parseInt(q.get('cr'),10) || 0) : DEFAULTS.cr,

    qty:     q.get('qty') ? Math.max(1, parseInt(q.get('qty'),10)||1) : DEFAULTS.qty,
    urgency: q.get('urgency') || DEFAULTS.urgency
  };

  s = normalizeGsmByStock(s); // принудительно 300 для designer
  return s;
}

$(document).on('change','input[name="stock"]', function(){
  const s = readState();          // здесь уже будет gsm нормализован
  applyGsmAvailability(s.stock);  // сразу скрываем/показываем плотности
  updateUrlFromState(stateToQuery(s));
  recalc();
});

function stateToQuery(s){
  const q = new URLSearchParams(location.search);

  // сохраняем dev-режим, если был
  (q.get('env') === 'dev') ? q.set('env','dev') : q.delete('env');

  // Всегда пишем qty (это ключевое)
  q.set('qty', String(Math.max(1, Math.floor(s.qty))));

  // Остальные — только если не дефолт
  if (s.design  !== DEFAULTS.design)  q.set('design',  s.design);  else q.delete('design');
  if (s.size    !== DEFAULTS.size)    q.set('size',    s.size);    else q.delete('size');
  if (s.print   !== DEFAULTS.print)   q.set('print',   s.print);   else q.delete('print');
  if (s.stock   !== DEFAULTS.stock)   q.set('stock',   s.stock);   else q.delete('stock');
  if (String(s.gsm) !== String(DEFAULTS.gsm)) q.set('gsm', String(s.gsm)); else q.delete('gsm');
  if (s.urgency !== DEFAULTS.urgency) q.set('urgency', s.urgency); else q.delete('urgency');

  // Флаги и числа
  s.lamination ? q.set('lam','1') : q.delete('lam');
  s.rounded    ? q.set('rnd','1') : q.delete('rnd');
  (s.creasing||0) > 0 ? q.set('cr', String(s.creasing)) : q.delete('cr');

  return q.toString();
}


// --- GSM ограничения для дизайнерской бумаги ---
function normalizeGsmByStock(s){
  if (s.stock === 'designer') s.gsm = '300';
  return s;
}

// Визуально ограничиваем доступные плотности
function applyGsmAvailability(stock){
  const $radios = $('input[name="gsm"]');       // radio: 80,115,150,200,300
  const $wrpSel = (el)=> $(el).closest('.btn, .form-check, .form-check-inline');

  if (stock === 'designer'){
    $radios.each((_, el) => {
      const dis = el.value !== '300';
      el.disabled = dis;
      $wrpSel(el).toggleClass('disabled d-none', dis);
    });
    // гарантируем выбор 300
    $('input[name="gsm"][value="300"]').prop('checked', true);
  } else {
    $radios.each((_, el) => {
      el.disabled = false;
      $wrpSel(el).removeClass('disabled d-none');
    });
  }
}



byId('btnShare')?.addEventListener('click', async () => {
  updateUrlFromState(stateToQuery(readState()));
  const res = await shareUrlOrCopy(location.href, 'Визитки — расчёт');
  // ... тот же фидбек, как выше ...
});

byId('btnCopy')?.addEventListener('click', async () => {
  updateUrlFromState(stateToQuery(readState()));
  try {
    await navigator.clipboard.writeText(location.href);

    // визуальный отклик на кнопке
    const btn = byId('btnCopy');
    if (btn) {
      const prevText  = btn.textContent;
      const prevClass = btn.className;

      // сделать кнопку зелёной и на время заблокировать
      btn.textContent = 'Скопировано';
      btn.classList.remove('btn-outline-secondary','btn-outline-primary','btn-outline-dark','btn-outline-light');
      btn.classList.add('btn-success');
      btn.disabled = true;

      setTimeout(() => {
        // вернуть как было
        btn.className   = prevClass;
        btn.textContent = prevText;
        btn.disabled    = false;
      }, 1500);
    }

  } catch {
    // запасной вариант
    prompt('Скопируйте ссылку:', location.href);
  }
});


function discountRateByAmount(sum, CONF){
  const d = CONF?.discountByAmount || {};
  const A1 = d.startAmount ?? 1500, R1 = d.startRate ?? 0.05;
  const A2 = d.midAmount   ?? 4000, R2 = d.midRate   ?? 0.15;
  const A3 = d.capAmount   ?? 20000, R3 = d.capRate  ?? 0.30;
  if (sum < A1) return 0;
  if (sum <= A2) { const t=(sum-A1)/Math.max(1,(A2-A1)); return R1 + t*(R2-R1); }
  if (sum <  A3) { const t=(sum-A2)/Math.max(1,(A3-A2)); return R2 + t*(R3-R2); }
  return R3;
}

byId('btnDownload')?.addEventListener('click', () => {
  updateUrlFromState(stateToQuery(readState()));
  enterPrintMode('totalBlock');
  setTimeout(() => window.print(), 0);
});

// Безопасно получаем базовую цену за 1 лист (single) из конфига.
// Если нет в конфиге — используем ваше правило-фолбэк:
// A6/A5/A4/EURO: 80 г/м² -> 30 руб, >80 г/м² -> 50 руб
// A3:            80 г/м² -> 50 руб, >80 г/м² -> 100 руб
function resolveBaseSingle(CONF, s){
  const matrix = CONF?.base?.basePerItemSingle || {};
  const size = s.size;
  const gsmKey = String(s.gsm);           // ключи в JSON чаще строками
  const val = matrix?.[size]?.[gsmKey];

  if (typeof val === 'number' && val > 0) return val;

  // Фолбэк — по озвученным правилам
  const gsmNum = parseInt(gsmKey, 10) || 0;
  if (size === 'A3') {
    return gsmNum > 80 ? 100 : 50;
  } else {
    // A6, A5, A4, EURO
    return gsmNum > 80 ? 50 : 30;
  }
}


// ================== CALC (leaflets) ==================
function computeTotal(s){
  if(!CONF) throw new Error('Цены не загружены');

  const B = CONF.base || {};
  const O = CONF.options || {};

  // База single по size+gsm
  const baseMatrix = B.basePerItemSingle || {};
  const baseSingle = +((baseMatrix?.[s.size]||{})[String(s.gsm)] ?? 0);

  // Мультипликаторы (без дизайна/срочности)
  const printK = (s.print === 'double') ? +(B.doublePrintMultiplier ?? 1.40) : 1.0;
  const lamK   = s.lamination ? +(O.laminationMultiplier ?? 1.40) : 1.0;
  const stockK = (s.stock === 'designer') ? +(O.designerPaperMultiplier ?? 1.30) : 1.0; // gloss/matte = 1

  // Поштучные надбавки
  const roundedAddPerItem  = s.rounded ? +(O.roundedCornersPerItem ?? 2.0) : 0;
  const creasingAddPerItem = (+(O.creasingPerLine ?? 3.0)) * (s.creasing || 0);

  // Цена за 1 лист выбранного формата (без дизайна/срочности)
  const perItemRaw = baseSingle * stockK * printK * lamK + roundedAddPerItem + creasingAddPerItem;

  const qty = Math.max(1, Math.floor(+s.qty || 1));
  const grossRaw = perItemRaw * qty;

  // ---------- Порог "не ниже 1 A4" (той же плотности и опций) ----------
  let grossBeforeDiscount = grossRaw;
  let floorApplied = false;

  if (s.size !== 'A4' && s.size !== 'A3') {
    const baseSingleA4 = +((baseMatrix?.['A4']||{})[String(s.gsm)] ?? 0);
    const perItemA4 = baseSingleA4 * stockK * printK * lamK + roundedAddPerItem + creasingAddPerItem;
    const a4Floor = perItemA4; // всегда ровно 1 лист A4

    if (grossRaw < a4Floor) {
      grossBeforeDiscount = a4Floor;
      floorApplied = true;
    }
  }

  // Эффективная цена за шт (для чека) — фактическая тарифицируемая средняя
  const effectivePerItemForReceipt = grossBeforeDiscount / qty;

  // Скидка по сумме (плавная)
  const discRate      = discountRateByAmount(grossBeforeDiscount, CONF);
  const discountValue = grossBeforeDiscount * discRate;
  const afterDiscount = grossBeforeDiscount - discountValue;

  // Дизайн
  const designFee = +(
    (CONF.fees?.designFee?.[s.design]) ??
    (PRICES?.shared?.fees?.designFee?.[s.design]) ?? 0
  );

  // Срочность — в самом конце
  const urgencyK = +(CONF.urgencyK?.[s.urgency] ?? 1.0);

  const subtotal = afterDiscount + designFee;
  const total = subtotal * urgencyK;

  if (DEV_HINT && floorApplied) {
    console.info('[leaflets] Применён порог 1×A4: size=', s.size,
      'qty=', qty, 'grossRaw=', grossRaw.toFixed(2),
      '→ floor=', (grossBeforeDiscount).toFixed(2));
  }

  return {
    perItem: effectivePerItemForReceipt, // для чека (без дизайна/срочности)
    qty,
    perItemRaw,                          // справочно
    floorApplied,
    grossBeforeDiscount,
    discount: discRate,
    discountValue,
    afterDiscount,
    designFee,
    urgencyK,
    subtotal,
    total
  };
}




// ================== RENDER ==================
function recalc(){
  if(!CONF) return;
  const s=readState();
  const r=computeTotal(s);

  $('#lineSize').text(s.size==='EURO'?'Евро (210×98)':s.size);
  $('#linePrint').text(s.print==='single'?'Односторонняя':'Двусторонняя');
  $('#lineStock').text({gloss:'Глянцевая',matte:'Матовая',designer:'Дизайнерская'}[s.stock]);
  $('#lineGsm').text(`${s.gsm} г/м²`);

  $('#rowLamination').toggle(!!s.lamination);
  if (s.lamination) $('#lineLamination').text('Включено');

  const cre = s.creasing || 0;
  $('#rowCreasing').toggle(cre > 0);
  if (cre > 0) {
    const word = cre === 1 ? 'линия' : (cre >= 2 && cre <= 4 ? 'линии' : 'линий');
    $('#lineCreasing').text(`${cre} ${word}`);
  }

  $('#rowRounded').toggle(!!s.rounded);
  if (s.rounded) $('#lineRounded').text('Включено');

  $('#lineQty').text(`${r.qty} лист.`);

  const hasDisc = r.discount > 0;
  $('#rowDiscount').toggle(hasDisc);
  if (hasDisc){
    $('#lineDiscount').text(`− ${fmtMoney(r.discountValue)} (${Math.round(r.discount*100)}%)`).addClass('text-success fw-semibold');
  }

  $('#linePerItem').text(fmtMoney(r.perItem));

  $('#lineUrgency').text(
    s.urgency==='express'
      ? `3–5 часа + 50%`
      : `1-2 дня`
  );
  $('#lineDesign').text(r.designFee>0?fmtMoney(r.designFee):'—');
  $('#total').text(fmtMoney(r.total));

  // ETA: calcETA уже возвращает локализованную строку
    const etaVal  = calcETA(s.urgency);
    const etaDate = etaVal instanceof Date ? etaVal : new Date(etaVal);
    const etaText = new Intl.DateTimeFormat('ru-RU', {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(etaDate);
    
    $('#eta').text(
      'Время готовности: ' + etaText +
      (DEV_HINT ? ` (${Intl.DateTimeFormat().resolvedOptions().timeZone})` : '')
    );

  if(DEV_HINT && $priceJson()){
    $priceJson().textContent = JSON.stringify(PRICES,null,2);
  }
}


// ================== TESTS (DEV) ==================
// ================== TESTS (DEV) ==================
function runTests(){
  const badge=$testBadge(); if(!badge) return;
  const setBadge=(ok,text)=>{badge.className='badge '+(ok?'text-bg-success':'text-bg-danger'); badge.textContent=text;};
  const approx=(a,b,eps=1e-6)=>Math.abs(a-b)<eps;

  try{
    // Базовый кейс: A6, gsm=80, односторонняя, глянец/матт, без допов
    const base={design:'none', size:'A6', print:'single', stock:'gloss', gsm:'80',
                lamination:false, creasing:0, rounded:false, qty:10, urgency:'oneday'};

    const r = computeTotal(base);
    const baseMatrix = CONF.base?.basePerItem || {};
    const baseSingle = +(baseMatrix?.['A6']?.['80'] ?? 0);
    const expPerItem = baseSingle * (CONF.options?.designerPaperK ? 1 : 1) * (CONF.base?.printK?.single ?? 1) * 1 + 0 + 0;
    if (!approx(r.perItem, expPerItem)) throw new Error('perItem base mismatch');

    // Двусторонняя должна повышать perItem по printK.double
    const rDouble = computeTotal({...base, print:'double'});
    const mDouble = +(CONF.base?.printK?.double ?? 1.4);
    if (!(rDouble.perItem > r.perItem && approx(rDouble.perItem, baseSingle * mDouble))) {
      throw new Error('double print multiplier failed');
    }

    // Ламинация должна увеличивать perItem (по laminationMultiplier)
    const rLam = computeTotal({...base, lamination:true});
    if (!(rLam.perItem > r.perItem)) throw new Error('lamination multiplier failed');

    // Дизайнерская бумага должна увеличивать perItem (designerPaperK)
    const rDesigner = computeTotal({...base, stock:'designer'});
    if (!(rDesigner.perItem > r.perItem)) throw new Error('designer paper multiplier failed');

    // Скругление углов +2 руб/лист
    const rRounded = computeTotal({...base, rounded:true});
    if (!(rRounded.perItem - r.perItem >= (CONF.options?.roundedCornersPerItem ?? 2) - 1e-6)) {
      throw new Error('rounded add failed');
    }

    // Беговка: +3 руб/линия (по умолчанию)
    const rCreasing = computeTotal({...base, creasing:3});
    const expAdd = (CONF.options?.creasingPerLine ?? 3) * 3;
    if (!(rCreasing.perItem - r.perItem >= expAdd - 1e-6)) {
      throw new Error('creasing add failed');
    }

    // Срочность должна увеличивать total
    const rExpress = computeTotal({...base, urgency:'express'});
    if (!(rExpress.total > r.total)) throw new Error('express multiplier failed');

    setBadge(true,'Тесты пройдены ✅');
  }catch(e){
    console.error(e);
    setBadge(false,'Тесты провалены ❌');
  }
}


// ================== EVENTS ==================
$(document).on('change input','input,select',function(){
  if(!CONF) return;
  if(this.id==='qtyPreset'){
    const v=$('#qtyPreset').val();
    if(v==='custom') $('#qty').trigger('focus'); else $('#qty').val(v);
  }else if(this.id==='qty'){
    const v=num($('#qty').val());
    $('#qtyPreset').val([1,10,50,100,200,500,1000].includes(v)?String(v):'custom');
    // ограничение на 10 цифр
    const raw = String($('#qty').val()||'').replace(/\D/g,'').slice(0,10);
    //$('#qty').val(raw || '1');
  }
  updateUrlFromState(readState());
  recalc();
});

// Dev: загрузка файла цен вручную
$btnLoadDevPrices()?.addEventListener('click',()=> $priceFileInput()?.click());
$priceFileInput()?.addEventListener('change', async e=>{
  const f=e.target.files?.[0]; if(!f) return;
  try{
    const json=JSON.parse(await f.text());
    PRICES=json;
    CONF=getProductConfig(PRICES, PRODUCT_KEY);
    unlockUI(); showDevUIIfNeeded(); recalc(); if(DEV_HINT) runTests();
    $lockHint() && ($lockHint().textContent=`Источник цен: file:${f.name}`);
  }catch(err){
    lockUI('Не удалось прочитать файл цен','Выберите корректный JSON.');
  }
});

// Bootstrap tooltips (без ошибки «Tooltip is not a constructor»)
document.addEventListener('DOMContentLoaded', () => {
  const TooltipClass = window.bootstrap && window.bootstrap.Tooltip;
  if (TooltipClass) {
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
      if (!el._bsTooltip) el._bsTooltip = new TooltipClass(el);
    });
  }
});

// Сколько штук данного формата "вмещается" в один A4 (для минимальной тарификации)
// A6 → 4, A5 → 2, EURO ~ 3, A4 → 1, A3 → 0 (не применяем порог A4 для A3)
function unitsPerA4(size){
  switch(size){
    case 'A6':  return 4;
    case 'A5':  return 2;
    case 'EURO':return 3;   // прибл. 3 на А4
    case 'A4':  return 1;
    default:    return 0;   // A3 и прочее — без порога A4
  }
}


// ================== PRINT ONLY RECEIPT ==================

if (window.matchMedia){
  const mqp = window.matchMedia('print');
  const handler = e=>{ if(!e.matches) exitPrintMode(); };
  mqp.addEventListener ? mqp.addEventListener('change', handler) : mqp.addListener(handler);
}
window.addEventListener('afterprint', exitPrintMode);


// ================== BOOTSTRAP SEQUENCE ==================
(async function bootstrap(){
  showDevUIIfNeeded();

  const restoredEarly = queryToState();
  applyStateToUI(restoredEarly);
  updateUrlFromState(stateToQuery(restoredEarly));

  if (IS_FILE_PROTOCOL) {
    lockUI('Открыт локальный файл','Выберите prices.dev.json через кнопку выше.');
    return;
  }

  try{
    lockUI('Загружаем цены…', DEV_HINT ? 'DEV режим активен' : '');
    PRICES = await loadPricesFromUrl(PRICES_URL);
    CONF   = getProductConfig(PRICES, PRODUCT_KEY);

    unlockUI(); showDevUIIfNeeded();
    recalc(); if (DEV_HINT) runTests();

    if (PRICES?.meta?.updated) {
      document.getElementById('totalBlock')?.setAttribute('data-updated', PRICES.meta.updated);
    }
  }catch(e){
    console.error(e);
    lockUI( DEV_HINT ? 'Не удалось загрузить цены' : 'Калькулятор недоступен',
            DEV_HINT ? 'В DEV можно выбрать файл вручную.' : 'Попробуйте позже.' );
  }
})();