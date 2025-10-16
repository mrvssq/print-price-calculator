// business-cards.js — калькулятор визиток (productKey = 'business-cards')
// Требует common.js (window.Common)

(() => {
  'use strict';

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

  const PRODUCT_KEY = 'business-cards';
  const PRICES_URL  = './prices.json';

  // ===== DOM helpers =====
  const $ = window.jQuery;
  const byId = (id) => document.getElementById(id);
  const $priceJson = () => byId('priceJson');
  const $testBadge = () => byId('testBadge');
  const $btnLoadDevPrices = () => byId('btnLoadDevPrices');
  const $priceFileInput   = () => byId('priceFile');

  // ===== State =====
  let PRICES = null; // весь файл
  let CONF   = null; // конфиг продукта (merged shared → product)

  // ===== JSONC парсер (для ручной загрузки в DEV) =====
  function parseJsonWithComments(text) {
    const withoutBom = text.replace(/^\uFEFF/, '');
    const noComments = withoutBom
      .replace(/\/\*[\s\S]*?\*\//g, '')       // /* ... */
      .replace(/(^|\s)\/\/.*$/gm, '');        // // ...
    const noTrailing = noComments.replace(/,\s*([}\]])/g, '$1'); // хвостовые запятые
    return JSON.parse(noTrailing);
  }

  // ===== Валидация конфига визиток =====
  function validateProductConfigCards(conf) {
    const errs = [];
    if (!conf) errs.push('Конфиг продукта отсутствует.');
    if (!conf?.base) errs.push('Нет секции base.');
    if (!conf?.base?.basePerItem) errs.push('Нет base.basePerItem (матрица цен по материалам/сторонам).');
    // options желательно:
    if (!conf?.options) errs.push('Нет секции options (доплаты).');
    if (!conf?.urgencyK) errs.push('Нет секции urgencyK.');
    if (!conf?.discountByAmount) errs.push('Нет секции discountByAmount (скидки по сумме).');
    return errs;
  }

  // ===== Карточки: отображаемые названия материалов =====
  const matNames = {
    paper300: 'Бумага 300 г/м²',
    designer: 'Дизайнерская',
    plastic:  'Пластик'
  };

  // ===== Qty rules per material =====
  const QTY_RULES = {
    paper300: { min: 120, step: 24, label: 'Бумага 300' },
    designer: { min: 120, step: 24, label: 'Дизайнерская' },
    plastic:  { min: 30,  step: 1,  label: 'Пластик' }
  };
  const DEFAULT_QTY = 120; // дефолт, если ввод нечисловой

  function toInt(v){
    const n = parseInt(String(v ?? '').replace(/[^\d\-]/g,''), 10);
    return Number.isFinite(n) ? n : NaN;
  }
  function normalizeQtyByMaterial(n, material){
    const rule = QTY_RULES[material] || { min: 1, step: 1 };
    const min  = rule.min ?? 1;
    const step = rule.step ?? 1;

    const base = Math.max(Number.isFinite(n) ? n : min, min);
    if (step <= 1) return base;

    const packs = Math.ceil(base / step);
    return packs * step;
  }
  /** Возвращает { qtyNorm, hint, needsAdjust } */
  function evalQtyForMaterial(rawInput, material){
    const rule = QTY_RULES[material] || { min: 1, step: 1 };
    const min  = rule.min ?? 1;
    const step = rule.step ?? 1;

    const n = toInt(rawInput);

    if (Number.isNaN(n)) {
      const fallback = material === 'plastic' ? Math.max(30, DEFAULT_QTY) : DEFAULT_QTY;
      const norm = normalizeQtyByMaterial(fallback, material);
      const stepTxt = step > 1 ? `, кратно ${step}` : '';
      return {
        qtyNorm: norm,
        hint: `Некорректное значение, расчёт выполнен как ${norm} шт (минимум ${min}${stepTxt}).`,
        needsAdjust: true
      };
    }

    const violatesMin  = n < min;
    const violatesStep = step > 1 && (n % step !== 0);
    if (violatesMin || violatesStep) {
      const norm = normalizeQtyByMaterial(n, material);
      const stepTxt = step > 1 ? `, шаг ${step}` : '';
      return {
        qtyNorm: norm,
        hint: `Тираж скорректирован для расчёта до ${norm} шт (минимум ${min}${stepTxt}).`,
        needsAdjust: true
      };
    }

    const okTxt = step > 1 ? `Кратно ${step}.` : '';
    return { qtyNorm: n, hint: okTxt, needsAdjust: false };
  }
  function setQtyHint(text){
    const el = document.getElementById('qtyHint');
    if (el) el.textContent = text || '';
  }

    // ——— пластик: без ламинации и без скругления ———
  function normalizeOptionsByMaterial(s){
    if (s.material === 'plastic'){
      s.lamination = false;
      s.rounded = false;
    }
    return s;
  }

  function applyMaterialOptionAvailability(material){
    const isPlastic = material === 'plastic';

    const lam = document.getElementById('lamination');
    const rnd = document.getElementById('rounded');

    if (lam){
      if (isPlastic) lam.checked = false;
      lam.disabled = isPlastic;
      lam.closest('.form-check, .form-switch, .btn')?.classList.toggle('disabled', isPlastic);
    }
    if (rnd){
      if (isPlastic) rnd.checked = false;
      rnd.disabled = isPlastic;
      rnd.closest('.form-check, .form-switch, .btn')?.classList.toggle('disabled', isPlastic);
    }
  }

  // ===== URL <-> State =====
  function readState() {
    const pick = (name, def) => $('input[name="'+name+'"]:checked').val() || def;

    const material = pick('material','paper300');
    const qtyRaw   = $('#qty').val();
    const { qtyNorm, hint } = evalQtyForMaterial(qtyRaw, material);
    setQtyHint(hint);

    const s = {
      size:     pick('size','90x50'),
      print:    pick('print','double'),
      material: pick('material','paper300'),
      lamination: $('#lamination').is(':checked'),
      rounded:    $('#rounded').is(':checked'),
      urgency:  $('#urgency').val() || 'oneday',
      design:   $('input[name="design"]:checked').val() || 'none',
      qty:      evalQtyForMaterial($('#qty').val(), pick('material','paper300')).qtyNorm
    };

    return normalizeOptionsByMaterial(s);
  }

  function queryToState() {
    const q = new URLSearchParams(location.search);
    const material = q.get('material') || 'paper300';
    const qtyRaw = q.get('qty');

    const { qtyNorm } = evalQtyForMaterial(qtyRaw, material);

    const s = {
      size:      q.get('size')     || '90x50',
      print:     q.get('print')    || 'double',
      material,
      lamination: truthy(q.get('lam')),
      rounded:    truthy(q.get('rnd')),
      urgency:    q.get('urgency') || 'oneday',
      design:     q.get('design')  || 'none',
      qty:        qtyNorm
    };

    return normalizeOptionsByMaterial(s);
  }

  $(document).on('change','input[name="material"]', function(){
    const s = readState();                 // тут lam/rnd уже сброшены для plastic
    applyMaterialOptionAvailability(s.material);
    updateUrlFromState(stateToQuery(s));
    recalc();
  });

  function stateToQuery(s) {
    const q = new URLSearchParams(location.search);
    if (q.get('env') === 'dev') q.set('env','dev'); else q.delete('env');

    q.set('size', s.size);
    q.set('print', s.print);
    q.set('material', s.material);
    q.set('urgency', s.urgency);
    q.set('design', s.design);
    q.set('qty', String(Math.max(1, Math.floor(s.qty))));

    s.lamination ? q.set('lam','1') : q.delete('lam');
    s.rounded    ? q.set('rnd','1') : q.delete('rnd');

    return q.toString();
  }

  let _urlTimer=null;
  function syncUrl(s){
    clearTimeout(_urlTimer);
    _urlTimer = setTimeout(()=> updateUrlFromState(stateToQuery(s)), 0);
  }

  // ===== Скидка по сумме (плавная) =====
  function discountRateByAmount(sum, conf) {
    const d = conf?.discountByAmount || {};
    const A1 = d.startAmount ?? 1500;
    const R1 = d.startRate   ?? 0.05;
    const A2 = d.midAmount   ?? 4000;
    const R2 = d.midRate     ?? 0.15;
    const A3 = d.capAmount   ?? 20000;
    const R3 = d.capRate     ?? 0.30;

    if (sum < A1) return 0;
    if (sum <= A2) {
      const t = (sum - A1) / Math.max(1, (A2 - A1));
      return R1 + t * (R2 - R1);
    }
    if (sum < A3) {
      const t = (sum - A2) / Math.max(1, (A3 - A2));
      return R2 + t * (R3 - R2);
    }
    return R3;
  }

  // ===== Compute (визитки) =====
  function computeTotal(s){
    if(!CONF) throw new Error('Цены не загружены');

    const B = CONF.base || {};
    const O = CONF.options || {};
    const fees = (CONF.designFee || window.PRICES?.shared?.fees || {});

    // 1) База на 1 шт по материалу/сторонам
    const baseMatrix = B.basePerItem || {};
    const base = +(baseMatrix?.[s.material]?.[s.print] ?? 0);

    // 2) Допы на 1 шт
    const lamMult    = s.lamination ? +(O.laminationMultiplier || 1) : 1;
    const roundedAdd = s.rounded ? +(O.roundedCornersPerItem || 0) : 0;

    const perItem = base * lamMult + roundedAdd;

    // 3) Количество (уже нормализованное)
    const qty = Math.max(1, Math.floor(s.qty));

    // 4) Сумма до скидки
    const gross = perItem * qty;

    // 5) Скидка по сумме (плавная, из конфигурации карты)
    const discRate = discountRateByAmount(gross, CONF);
    const discValue = gross * discRate;
    const afterDiscount = gross - discValue;

    // 6) Дизайн (показываем цену только если >0)
    const designFee = +(
      (fees[s.design]) ??
      (fees[s.design]) ??
      0
    );

    // 7) Срочность в конце
    const urgencyK = +(CONF.urgencyK?.[s.urgency] ?? 1);
    const subtotal = afterDiscount + designFee;
    const total = subtotal * urgencyK;

    return {
      perItem, qty,
      gross,
      discRate, discValue, afterDiscount,
      designFee,
      urgencyK,
      subtotal, total
    };
  }

  // ===== Render =====
  function render(s, r){
    $('#lineQty').text(`${r.qty} шт.`);
    $('#lineSize').text(s.size === '90x50' ? '90×50 мм' : '60×60 мм');
    $('#linePrint').text(s.print === 'single' ? 'Односторонняя' : 'Двусторонняя');
    $('#lineMaterial').text(matNames[s.material] || '—');

    $('#rowLamination').toggle(!!s.lamination);
    if (s.lamination) $('#lineLamination').text('Вкл');

    $('#rowRounded').toggle(!!s.rounded);
    if (s.rounded) $('#lineRounded').text('Вкл');

    if (r.discRate > 0) {
      $('#rowDiscount').show();
      $('#lineDiscount').text(`− ${fmtMoney(r.discValue)} (${Math.round(r.discRate*100)}%)`)
        .removeClass('text-danger').addClass('text-success fw-semibold');
    } else {
      $('#rowDiscount').hide();
    }

    $('#lineUrgency').text(s.urgency === 'express' ? '3–5 часов +50%' : '1–2 рабочих дня');

    $('#linePerItem').text(fmtMoney(r.perItem));

    // Дизайн: цена только если > 0, иначе прочерк
    if (r.designFee > 0) {
      $('#lineDesign').text(fmtMoney(r.designFee)).removeClass('text-success');
    } else {
      $('#lineDesign').text('—').removeClass('text-success');
    }

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
  }

  function recalc(){
    if(!CONF) return;
    const s = readState();
    syncUrl(s);
    const r = computeTotal(s);
    render(s, r);
    if (DEV_HINT && $priceJson()) $priceJson().textContent = JSON.stringify(PRICES, null, 2);
  }

  // ===== Tests (dev) =====
  function runTests(){
    const badge = $testBadge(); if(!badge) return;
    const set = (ok,txt)=>{ badge.className='badge '+(ok?'text-bg-success':'text-bg-danger'); badge.textContent=txt; };
    const approx=(a,b,eps=1e-6)=>Math.abs(a-b)<eps;
    try{
      // База: бумага 300, single
      const base={size:'90x50', print:'single', material:'paper300', lamination:false, rounded:false, urgency:'oneday', design:'none', qty:120};
      const r = computeTotal(base);

      // perItem = basePerItem[paper300][single] (+0)
      const expBase = +(CONF.base?.basePerItem?.paper300?.single || 0);
      if(!approx(r.perItem, expBase)) throw new Error('perItem base mismatch');

      // lamination увеличивает total
      if(!(computeTotal({...base,lamination:true}).total > r.total)) throw new Error('lamination up');

      // rounded увеличивает total
      if(!(computeTotal({...base,rounded:true}).total > r.total)) throw new Error('rounded up');

      // double печать увеличивает perItem
      const rd = computeTotal({...base, print:'double'});
      const expDouble = +(CONF.base?.basePerItem?.paper300?.double || 0);
      if(!(rd.perItem > r.perItem && approx(rd.perItem, expDouble))) throw new Error('double price mismatch');

      // срочность 1.5 увеличивает total
      if(!(computeTotal({...base, urgency:'express'}).total > r.total)) throw new Error('express up');

      // нормализация qty для пластика: min=30
      const rPlastic = computeTotal({...base, material:'plastic', qty:1});
      if(rPlastic.qty !== 30) throw new Error('plastic min qty must be 30');

      set(true,'Тесты пройдены ✅');
    }catch(e){ console.error(e); set(false,'Тесты провалены ❌'); }
  }

  // ===== Events =====
  // qty — подсказки и пересчёт, НО поле не перезаписываем во время ввода
  $(document).on('input change', '#qty', function(){
    const material = $('input[name="material"]:checked').val() || 'paper300';
    const { hint } = evalQtyForMaterial(this.value, material);
    setQtyHint(hint);

    const s = readState();
    updateUrlFromState(stateToQuery(s));
    recalc();
  });

  // пресеты (опционально, оставляем как есть)
  $(document).on('change input','input,select',function(e){
    if(!CONF) return;
    if(this.id==='qtyPreset'){
      const v=$('#qtyPreset').val();
      if(v==='custom') $('#qty').trigger('focus'); else $('#qty').val(v);
    }
    recalc();
  });

  // DEV: ручная загрузка файла цен
  $btnLoadDevPrices()?.addEventListener('click',()=> $priceFileInput()?.click());
  $priceFileInput()?.addEventListener('change', async e=>{
    const f=e.target.files?.[0]; if(!f) return;
    try{
      const json = parseJsonWithComments(await f.text());
      PRICES = json;
      CONF = getProductConfig(PRICES, PRODUCT_KEY);

      const errs = validateProductConfigCards(CONF);
      if (errs.length) { lockUI('Некорректный файл цен', errs.join(' ')); return; }

      unlockUI(); showDevUIIfNeeded(); recalc(); if(DEV_HINT) runTests();
      const hint = document.getElementById('lockHint'); if (hint) hint.textContent = `Источник цен: file:${f.name}`;
      if (DEV_HINT && $priceJson()) $priceJson().textContent = JSON.stringify(PRICES, null, 2);
    }catch(err){
      console.error(err);
      lockUI('Не удалось прочитать файл цен','Проверьте JSON (комментарии поддерживаются).');
    }
  });

  function applyStateToUI(s) {
    const check = (name, val) => $('input[name="'+name+'"][value="'+val+'"]').prop('checked', true);
    check('size', s.size);
    check('print', s.print);
    check('material', s.material);
    applyMaterialOptionAvailability(s.material);
    $('#lamination').prop('checked', !!s.lamination);
    $('#rounded').prop('checked', !!s.rounded);
    $('#urgency').val(s.urgency);
    $('input[name="design"][value="'+s.design+'"]').prop('checked', true);
    const $qty = $('#qty');
    if (!$qty.val()) $qty.val(s.qty);
    const { hint } = evalQtyForMaterial($qty.val(), s.material);
    setQtyHint(hint);
    const preset=[120,240,480,960,1920].includes(s.qty.qtyNorm)?String(s.qty.qtyNorm):'custom';
    $('#qtyPreset').val(preset);
  }

  // Share / Copy / Print
  byId('btnShare')?.addEventListener('click', async () => {
    updateUrlFromState(stateToQuery(readState()));
    const res = await shareUrlOrCopy(location.href, 'Визитки — расчёт');
    // фидбек — как у Copy, по желанию (можно оставить без визуалки)
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

        btn.textContent = 'Скопировано';
        btn.classList.remove('btn-outline-secondary','btn-outline-primary','btn-outline-dark','btn-outline-light');
        btn.classList.add('btn-success');
        btn.disabled = true;

        setTimeout(() => {
          btn.className   = prevClass;
          btn.textContent = prevText;
          btn.disabled    = false;
        }, 1500);
      }

    } catch {
      prompt('Скопируйте ссылку:', location.href);
    }
  });

  byId('btnDownload')?.addEventListener('click', () => {
    updateUrlFromState(stateToQuery(readState()));
    enterPrintMode('totalBlock');
    setTimeout(() => window.print(), 0);
  });

  // ===== Bootstrap init =====
  document.addEventListener('DOMContentLoaded', ()=>{
    bindMaxDigits(byId('qty'), 10);
    initTooltips();
  });

  // ===== Bootstrap sequence =====
  (async function bootstrap(){
    showDevUIIfNeeded();

    // восстановить state из URL до загрузки
    const restored = queryToState();
    applyStateToUI(restored);
    syncUrl(restored);

    if (IS_FILE_PROTOCOL) {
      lockUI('Открыт локальный файл','Выберите prices.dev.json через кнопку выше.');
      return;
    }

    try{
      lockUI('Загружаем цены…', DEV_HINT ? 'DEV режим активен' : '');
      PRICES = await loadPricesFromUrl(PRICES_URL);
      CONF   = getProductConfig(PRICES, PRODUCT_KEY);

      // базовый рендер + тесты в DEV
      unlockUI(); showDevUIIfNeeded();
      recalc(); if (DEV_HINT) runTests();

      if (PRICES?.meta?.updated) byId('totalBlock')?.setAttribute('data-updated', PRICES.meta.updated);
    }catch(e){
      console.error(e);
      lockUI(DEV_HINT ? 'Не удалось загрузить цены' : 'Калькулятор недоступен',
             DEV_HINT ? 'В DEV можно выбрать файл вручную.' : 'Попробуйте позже.');
    }
  })();

})();
