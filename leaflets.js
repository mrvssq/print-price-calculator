// ===== Окружение / DEV =====
const IS_FILE_PROTOCOL = location.protocol === 'file:';
const IS_LOCALHOST = /(^localhost$)|(^127\.0\.0\.1$)/i.test(location.hostname);
const DEV_PARAM = new URLSearchParams(location.search).get('env') === 'dev';
const DEV_HINT = IS_FILE_PROTOCOL || IS_LOCALHOST || DEV_PARAM;

const PRICES_URL = './prices.json';

// ===== DOM helpers =====
const $lockOverlay=()=>document.getElementById('lockOverlay');
const $lockMessage=()=>document.getElementById('lockMessage');
const $lockHint=()=>document.getElementById('lockHint');
const $devPanel=()=>document.getElementById('devPanel');
const $testBadge=()=>document.getElementById('testBadge');
const $devPricesDetails=()=>document.getElementById('devPricesDetails');
const $priceJson=()=>document.getElementById('priceJson');
const $btnLoadDevPrices=()=>document.getElementById('btnLoadDevPrices');
const $priceFileInput=()=>document.getElementById('priceFile');

// ===== State =====
let PRICES = null;

// ===== Utils =====
function fmtMoney(n){return new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(n);}
function fmtNumber(n){return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n);}
function num(v){return Number.parseFloat(v)||0;}

function lockUI(msg='Загружаем цены…',hint=''){
  const o=$lockOverlay(); if(!o) return;
  o.classList.remove('d-none');
  o.classList.add('d-flex');
  if($lockMessage()) $lockMessage().textContent=msg;
  if($lockHint()) $lockHint().textContent=hint;
}
function unlockUI(){
  const o=$lockOverlay(); if(!o) return;
  o.classList.add('d-none');
  o.classList.remove('d-flex');
}

function showDevUIIfNeeded(){
  if(DEV_HINT){$devPanel()?.classList.remove('d-none');$testBadge()?.classList.remove('d-none');$devPricesDetails()?.classList.remove('d-none');}
  else{$devPanel()?.classList.add('d-none');$testBadge()?.classList.add('d-none');$devPricesDetails()?.classList.add('d-none');}
}

async function loadPricesFromUrl(url){
  const res=await fetch(url,{cache:'no-store'});
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function volumeDiscountRate(qty){
  if(qty>=1000) return 0.15;
  if(qty>=500)  return 0.10;
  if(qty>=200)  return 0.05;
  if(qty>=100)  return 0.03;
  return 0.0;
}

// ===== ETA локально =====
function calcETA(urgency){
  const d=new Date();
  if(urgency==='oneday') d.setDate(d.getDate()+1);
  if(urgency==='express') d.setHours(d.getHours()+3);
  const locale=navigator.language||'ru-RU';
  const {timeZone}=Intl.DateTimeFormat().resolvedOptions();
  return new Intl.DateTimeFormat(locale,{timeZone,weekday:'short',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
}

// ===== Read/apply state =====
function readState(){
  return {
    design:$('input[name="design"]:checked').val(),
    size:$('input[name="size"]:checked').val(),
    print:$('#print').val(),
    stock:$('input[name="stock"]:checked').val(),
    gsm:$('input[name="gsm"]:checked').val(),
    lamination:$('#lamination').is(':checked'),
    creasing:parseInt($('#creasing').val(),10)||0,
    rounded:$('#rounded').is(':checked'),
    qty:Math.max(1, num($('#qty').val())),
    urgency:$('#urgency').val()
  };
}
function applyStateToUI(s){
  $('input[name="design"][value="'+s.design+'"]').prop('checked',true);
  $('input[name="size"][value="'+s.size+'"]').prop('checked',true);
  $('#print').val(s.print);
  $('input[name="stock"][value="'+s.stock+'"]').prop('checked',true);
  $('input[name="gsm"][value="'+s.gsm+'"]').prop('checked',true);
  $('#lamination').prop('checked',!!s.lamination);
  $('#creasing').val(String(s.creasing));
  $('#rounded').prop('checked',!!s.rounded);
  $('#qty').val(s.qty);
  const preset=[1,10,50,100,200,500,1000].includes(s.qty)?String(s.qty):'custom';
  $('#qtyPreset').val(preset);
  $('#urgency').val(s.urgency);
}

// Обновление URL без перезагрузки (throttle, чтобы не спамить историю)
let _urlUpdateTimer = null;
function updateUrlFromState(s) {
  const qs = stateToQuery(s);
  const newUrl = `${location.pathname}?${qs}${location.hash||''}`;
  clearTimeout(_urlUpdateTimer);
  _urlUpdateTimer = setTimeout(() => {
    history.replaceState(null, '', newUrl);
  }, 0);
}

// ===== Calculation for leaflets (без НДС) =====
function computeTotal(s){
  if(!PRICES) throw new Error('Цены не загружены');

  const basePerItem = PRICES.basePerItem_A6 * PRICES.sizeK[s.size] * PRICES.printK[s.print];
  const stockAdd = PRICES.stockSurchargePerItem[s.stock] || 0;
  const gsmAdd = PRICES.gsmSurchargePerItem[s.gsm] || 0;

  const laminationAdd = s.lamination ? PRICES.laminationPerItem : 0;
  const creasingAdd = (PRICES.creasingPerItem || 0) * (s.creasing||0);
  const roundedAdd = s.rounded ? (PRICES.roundedCornersPerItem || 0) : 0;

  const perItem = basePerItem + stockAdd + gsmAdd + laminationAdd + creasingAdd + roundedAdd;

  const qty = Math.max(1, Math.floor(s.qty));
  const discount = volumeDiscountRate(qty);

  const printPart = perItem * qty;
  const discountValue = printPart * discount;
  const afterDiscount = printPart - discountValue;

  const urgencyK = PRICES.urgencyK[s.urgency];
  const afterUrgency = afterDiscount * urgencyK;

  const designFee = PRICES.designFee[s.design] || 0;

  // НДС отсутствует: итог = сумма после срочности + дизайн
  const subtotal = afterUrgency + designFee;
  const total = subtotal;

  return {
    perItem, qty, discount, discountValue, afterDiscount,
    urgencyK, afterUrgency, designFee, subtotal, total,
    adds:{laminationAdd,creasingAdd,roundedAdd,stockAdd,gsmAdd}
  };
}

// ===== Recalc & UI fill =====
function recalc(){
  if(!PRICES) return;
  const s=readState();
  const r=computeTotal(s);

  // базовые поля
  $('#lineSize').text(s.size==='EURO'?'Евро (210×98)':s.size);
  $('#linePrint').text(s.print==='single'?'Односторонняя':'Двусторонняя');
  $('#lineStock').text({gloss:'Глянцевая',matte:'Матовая',designer:'Дизайнерская'}[s.stock]);
  $('#lineGsm').text(s.gsm);

  // условные строки: показываем только если включено
  $('#rowLamination').toggle(!!s.lamination);
  if (s.lamination) $('#lineLamination').text('Вкл');

  $('#rowCreasing').toggle((s.creasing||0) > 0);
  if ((s.creasing||0) > 0) $('#lineCreasing').text(`${s.creasing}`);

  $('#rowRounded').toggle(!!s.rounded);
  if (s.rounded) $('#lineRounded').text('Вкл');

  // тираж и страницы (всего страниц = листы × стороны)
  $('#lineQty').text(r.qty);

  // скидка: зелёным и только если > 0
  const $discRow = $('#rowDiscount');
  if (r.discount > 0) {
    $('#lineDiscount')
      .text(`− ${fmtMoney(r.discountValue)}`)
      .removeClass('text-danger')
      .addClass('text-success fw-semibold');
    $discRow.show();
  } else {
    $discRow.hide();
  }

  // остальное
  $('#lineUrgency').text(
    s.urgency==='express'
      ? `× ${fmtNumber(r.urgencyK)} (2–3 часа)`
      : `× ${fmtNumber(r.urgencyK)} (1 день)`
  );
  $('#lineDesign').text(r.designFee>0?fmtMoney(r.designFee):'—');
  $('#total').text(fmtMoney(r.total));

  $('#eta').text('Время готовности: ' + calcETA(s.urgency) + (DEV_HINT?` (${Intl.DateTimeFormat().resolvedOptions().timeZone})`:''));  

  if(DEV_HINT && $priceJson()){
    $priceJson().textContent = JSON.stringify(PRICES,null,2);
  }
}


// ===== Tests (dev only) =====
function runTests(){
  const badge=$testBadge(); if(!badge) return;
  function setBadge(ok,text){badge.className='badge '+(ok?'text-bg-success':'text-bg-danger'); badge.textContent=text;}
  function approx(a,b,eps=1e-6){return Math.abs(a-b)<eps;}
  try{
    const base={design:'none',size:'A6',print:'single',stock:'gloss',gsm:'300',lamination:false,creasing:0,rounded:false,qty:100,urgency:'oneday'};
    const r=computeTotal(base);
    const perItemExp = PRICES.basePerItem_A6*PRICES.sizeK.A6*PRICES.printK.single + PRICES.stockSurchargePerItem.gloss + PRICES.gsmSurchargePerItem['300'];
    if(!approx(r.perItem, perItemExp)) throw new Error('perItem mismatch');

    const r2=computeTotal({...base,lamination:true});
    if(!(r2.total>r.total)) throw new Error('lamination should increase total');

    const r3=computeTotal({...base,creasing:3});
    if(!(r3.total>r.total)) throw new Error('creasing should increase total');

    const r4=computeTotal({...base,rounded:true});
    if(!(r4.total>r.total)) throw new Error('rounded should increase total');

    const r5=computeTotal({...base,urgency:'express'});
    if(!(r5.total>r.total)) throw new Error('express should increase total');

    const r6=computeTotal({...base,qty:1});
    if(!(r6.total>0 && r6.qty===1)) throw new Error('qty=1 must be allowed');

    setBadge(true,'Тесты пройдены ✅');
  }catch(e){console.error(e); setBadge(false,'Тесты провалены ❌');}
}

// ===== Events =====
$(document).on('change input','input,select',function(){
  if(!PRICES) return;
  if(this.id==='qtyPreset'){
    const v=$('#qtyPreset').val();
    if(v==='custom') $('#qty').trigger('focus'); else $('#qty').val(v);
  }else if(this.id==='qty'){
    const v=num($('#qty').val());
    $('#qtyPreset').val([1,10,50,100,200,500,1000].includes(v)?String(v):'custom');
  }
  recalc();
});

// DEV file load
$btnLoadDevPrices()?.addEventListener('click',()=> $priceFileInput()?.click());
$priceFileInput()?.addEventListener('change', async e=>{
  const f=e.target.files?.[0]; if(!f) return;
  try{
    const json=JSON.parse(await f.text());
    PRICES=json;
    unlockUI(); showDevUIIfNeeded(); recalc(); runTests();
    if($lockHint()) $lockHint().textContent=`Источник цен: file:${f.name}`;
  }catch(err){
    lockUI('Не удалось прочитать файл цен','Выберите корректный JSON.');
  }
});

// ===== Bootstrap init =====
document.addEventListener('DOMContentLoaded', function () {
  const TooltipClass = window.bootstrap && window.bootstrap.Tooltip;
  if (TooltipClass) {
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
      if (!el._bsTooltip) el._bsTooltip = new TooltipClass(el);
    });
  }
});

(async function bootstrap(){
  showDevUIIfNeeded();

  // 1) Применяем состояние из URL сразу, чтобы форма отобразилась корректно
  const restoredEarly = queryToState();
  applyStateToUI(restoredEarly);
  updateUrlFromState(restoredEarly);

  // 2) Локальный file:// — не рвём восстановление, просто блокируем калькулятор
  if (IS_FILE_PROTOCOL) {
    lockUI('Открыт локальный файл','Выберите prices.dev.json через кнопку выше.');
    return;
  }

  try{
    lockUI('Загружаем цены…', DEV_HINT ? 'DEV режим активен' : '');
    PRICES = await loadPricesFromUrl(PRICES_URL);

    // 3) После загрузки цен ещё раз читаем текущее состояние (оно уже из формы)
    const stateNow = readState();
    recalc();                  // пересчёт с реальными PRICES
    updateUrlFromState(stateNow);

    unlockUI();
    showDevUIIfNeeded();
    if (DEV_HINT) runTests();

    if (PRICES?.meta?.updated) {
      document.getElementById('totalBlock')?.setAttribute('data-updated', PRICES.meta.updated);
    }
  }catch(e){
    console.error(e);
    if (DEV_HINT) {
      lockUI('Не удалось загрузить цены','В DEV можно выбрать файл вручную.');
    } else {
      lockUI('Калькулятор недоступен','Не удалось загрузить цены. Попробуйте позже.');
    }
  }
})();

// Временный перенос блока на уровень <body> для печати
let __printHolder = null;
function enterPrintMode() {
  const total = document.getElementById('totalBlock');
  if (!total) return;

  // создаём «якорь», чтобы вернуть блок обратно
  __printHolder = document.createElement('div');
  __printHolder.style.display = 'none';
  total.parentNode.insertBefore(__printHolder, total);

  // переносим totalBlock в body
  document.body.appendChild(total);

  // даём CSS сигнал, что мы в print-режиме
  document.body.classList.add('print-mode');
}

function exitPrintMode() {
  const total = document.getElementById('totalBlock');
  if (!total) return;

  // возвращаем на место
  if (__printHolder && __printHolder.parentNode) {
    __printHolder.parentNode.insertBefore(total, __printHolder);
    __printHolder.remove();
  }
  __printHolder = null;

  document.body.classList.remove('print-mode');
}

// обработка системной печати (Ctrl+P / Cmd+P)
if (window.matchMedia) {
  const mqp = window.matchMedia('print');
  // старые браузеры: addListener; новые: addEventListener
  const handler = (e) => { if (!e.matches) exitPrintMode(); };
  mqp.addEventListener ? mqp.addEventListener('change', handler)
                       : mqp.addListener(handler);
}
window.addEventListener('afterprint', exitPrintMode);

// === ЗАМЕНИ обработчик кнопки печати на это ===
document.getElementById('btnDownload')?.addEventListener('click', () => {
  if (!PRICES) return;
  enterPrintMode();
  // печать в следующем тике, чтобы DOM успел перестроиться
  setTimeout(() => window.print(), 0);
});

// ===== URL <-> State =====

// Список ключей и преобразование булевых/чисел
function stateToQuery(s) {
  const q = new URLSearchParams(location.search);

  // сохраняем dev-режим, если был
  if (q.get('env') === 'dev') q.set('env', 'dev'); else q.delete('env');

  q.set('design', s.design);
  q.set('size', s.size);
  q.set('print', s.print);
  q.set('stock', s.stock);
  q.set('gsm', String(s.gsm));
  q.set('qty', String(Math.max(1, Math.floor(s.qty))));
  q.set('urgency', s.urgency);

  // опции: пишем только если включены/значимы -> короче ссылка
  if (s.lamination) q.set('lam', '1'); else q.delete('lam');
  if (s.rounded)   q.set('rnd', '1'); else q.delete('rnd');
  if ((s.creasing||0) > 0) q.set('cr', String(s.creasing)); else q.delete('cr');

  return q.toString();
}

function queryToState() {
  const q = new URLSearchParams(location.search);
  // базовые значения по умолчанию должны совпадать с дефолтом формы
  const s = {
    design: q.get('design') || $('input[name="design"]:checked').val() || 'none',
    size:   q.get('size')   || $('input[name="size"]:checked').val()   || 'A6',
    print:  q.get('print')  || $('#print').val()                       || 'single',
    stock:  q.get('stock')  || $('input[name="stock"]:checked').val()  || 'gloss',
    gsm:    q.get('gsm')    || $('input[name="gsm"]:checked').val()    || '300',
    lamination: q.has('lam'),
    creasing:   q.has('cr') ? parseInt(q.get('cr'), 10) || 0 : 0,
    rounded:    q.has('rnd'),
    qty:     q.get('qty') ? Math.max(1, parseInt(q.get('qty'), 10)||1) : num($('#qty').val())||100,
    urgency: q.get('urgency') || $('#urgency').val() || 'oneday'
  };
  return s;
}



$(document).on('change input','input,select',function(){
  if(!PRICES) return;
  if(this.id==='qtyPreset'){
    const v=$('#qtyPreset').val();
    if(v==='custom') $('#qty').trigger('focus'); else $('#qty').val(v);
  }else if(this.id==='qty'){
    const v=num($('#qty').val());
    $('#qtyPreset').val([1,10,50,100,200,500,1000].includes(v)?String(v):'custom');
  }
  // <-- добавлено:
  updateUrlFromState(readState());

  recalc();
});

// Кнопка "Поделиться" — копирует текущий URL (с параметрами)
document.getElementById('btnShare')?.addEventListener('click', async () => {
  try {
    // гарантируем, что URL актуален на момент клика
    updateUrlFromState(readState());
    await navigator.clipboard.writeText(location.href);
    // временный фидбек
    const btn = document.getElementById('btnShare');
    const prev = btn.textContent;
    btn.textContent = 'Ссылка скопирована';
    btn.classList.remove('btn-outline-secondary');
    btn.classList.add('btn-success');
    setTimeout(() => {
      btn.textContent = prev;
      btn.classList.remove('btn-success');
      btn.classList.add('btn-outline-secondary');
    }, 1500);
  } catch (e) {
    // запасной вариант: prompt (если запрещён clipboard API)
    prompt('Скопируйте ссылку:', location.href);
  }
});
