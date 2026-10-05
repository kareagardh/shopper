// Kundappen. Allt sparas i telefonen; nät behövs bara när kunden trycker Klart.
(function () {
  const { CFG, fmt, hhmm, pad3, dayName, $, uuid, newCode, store, rpc, encodeCart, swishLink, swishPretty } = window.L;
  const KEY = 'rbl-kund-v1';

  const newCart = () => ({ id: uuid(), code: newCode(), created: Date.now(), stage: 'shop', items: [] });
  const st = store.get(KEY, null) || {};
  st.cart = st.cart && Array.isArray(st.cart.items) ? st.cart : newCart();
  st.outbox = Array.isArray(st.outbox) ? st.outbox : [];
  st.sort = st.sort || 'time';
  st.event = st.event || null;          // { id, date, name } – senast kända aktiva loppisdag
  st.eventAt = st.eventAt || 0;
  let lastDone = st.lastDone || null;   // id på senast avslutade köp (för kvittoskärmen)
  const save = () => { st.lastDone = lastDone; store.set(KEY, st); };

  const total = items => items.reduce((a, i) => a + i.p, 0);

  // ---------- rendera ----------
  $('storeName').textContent = CFG.storeName;
  $('payStore').textContent = CFG.storeName;
  document.title = CFG.storeName;

  function renderShop() {
    const c = st.cart;
    $('codeChip').textContent = c.code;
    $('dayLabel').textContent = st.event ? 'Varukorg · ' + dayName(st.event.date) : 'Din varukorg';
    const list = c.items.map((it, idx) => ({ ...it, idx }));
    list.sort(st.sort === 'seller' ? (a, b) => a.s - b.s || a.t - b.t : (a, b) => b.t - a.t);
    const box = $('items');
    box.textContent = '';
    if (!list.length) box.innerHTML = '<div class="empty">Inga varor än.<br>Skriv säljarnummer och pris ovan.</div>';
    for (const i of list) {
      const r = document.createElement('div');
      r.className = 'row';
      r.innerHTML = `<span class="sid">${pad3(i.s)}</span><span class="t">${hhmm(i.t)}</span><span class="p">${fmt(i.p)}</span><button class="x" type="button" aria-label="Ta bort vara från säljare ${i.s}">×</button>`;
      r.querySelector('button').onclick = () => removeItem(i.t, i.s, i.p);
      box.appendChild(r);
    }
    const n = c.items.length;
    $('listCount').textContent = n + (n === 1 ? ' vara' : ' varor');
    $('sum').textContent = fmt(total(c.items));
    $('cnt').textContent = n ? n + (n === 1 ? ' vara' : ' varor') : 'Inga varor än';
    $('goPay').disabled = !n;
    $('sortTime').setAttribute('aria-pressed', st.sort !== 'seller');
    $('sortSeller').setAttribute('aria-pressed', st.sort === 'seller');
  }

  function show(which) {
    $('scr-shop').style.display = which === 'shop' ? 'contents' : 'none';
    $('scr-pay').hidden = which !== 'pay';
    $('scr-done').hidden = which !== 'done';
  }

  // ---------- lägga till / ta bort ----------
  let lastRemoved = null, toastTimer = null;
  function removeItem(t, s, p) {
    const items = st.cart.items;
    const idx = items.findIndex(i => i.t === t && i.s === s && i.p === p);
    if (idx < 0) return;
    lastRemoved = { item: items.splice(idx, 1)[0], idx };
    save(); renderShop();
    $('toastMsg').textContent = `Tog bort ${fmt(lastRemoved.item.p)} (säljare ${lastRemoved.item.s})`;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
  }
  $('undo').onclick = () => {
    if (lastRemoved) { st.cart.items.splice(lastRemoved.idx, 0, lastRemoved.item); lastRemoved = null; save(); renderShop(); }
    $('toast').hidden = true;
  };

  $('inSeller').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('inPrice').focus(); } });
  ['inSeller', 'inPrice'].forEach(id => $(id).addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); }));
  $('addForm').addEventListener('submit', e => {
    e.preventDefault();
    const sRaw = $('inSeller').value.trim(), pRaw = $('inPrice').value.trim();
    const s = parseInt(sRaw, 10), p = parseInt(pRaw, 10);
    if (!sRaw || isNaN(s) || s < 1 || s > 999) { $('err').textContent = 'Ange ett säljarnummer mellan 1 och 999.'; $('inSeller').focus(); return; }
    if (!pRaw || isNaN(p) || p < 1 || p > 99999) { $('err').textContent = 'Ange ett pris i hela kronor, minst 1 kr.'; $('inPrice').focus(); return; }
    if (st.cart.items.length >= 500) { $('err').textContent = 'Max 500 varor per köp. Betala och starta ett nytt köp.'; return; }
    $('err').textContent = '';
    st.cart.items.push({ s, p, t: Date.now() });
    save();
    $('inSeller').value = ''; $('inPrice').value = '';
    $('inSeller').focus();
    renderShop();
  });
  $('sortTime').onclick = () => { st.sort = 'time'; save(); renderShop(); };
  $('sortSeller').onclick = () => { st.sort = 'seller'; save(); renderShop(); };

  // ---------- betala ----------
  function drawQR(text) {
    const box = $('qr');
    try {
      const q = qrcode(0, 'M');
      q.addData(text);
      q.make();
      box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (e) {
      box.innerHTML = '<span class="small">QR-koden kunde inte skapas. Visa kundkoden i stället.</span>';
    }
  }
  function fillPay() {
    const c = st.cart, sum = total(c.items);
    $('codeChip2').textContent = c.code;
    $('paySum').textContent = fmt(sum);
    $('payTotal2').textContent = fmt(sum);
    $('payCnt').textContent = c.items.length + (c.items.length === 1 ? ' vara' : ' varor');
    $('payCode').textContent = c.code;
    $('payMsg').textContent = c.code;
    $('swishNr').textContent = swishPretty();
    $('openSwish').href = swishLink(sum, c.code);
    drawQR(encodeCart(c));
  }
  $('goPay').onclick = () => { st.cart.stage = 'pay'; save(); fillPay(); show('pay'); window.scrollTo(0, 0); };
  $('backShop').onclick = () => { st.cart.stage = 'shop'; save(); show('shop'); renderShop(); };

  $('klart').onclick = () => { $('askSum').textContent = fmt(total(st.cart.items)); $('klartAsk').hidden = false; };
  $('klartNo').onclick = () => { $('klartAsk').hidden = true; };
  $('klartYes').onclick = () => {
    $('klartAsk').hidden = true;
    const c = st.cart;
    st.outbox.push({
      id: c.id, code: c.code, event_id: st.event ? st.event.id : null,
      created: c.created, done: Date.now(), items: c.items.map(i => ({ s: i.s, p: i.p, t: i.t })),
      sum: total(c.items)
    });
    lastDone = c.id;
    st.cart = newCart();
    save();
    showDone();
    flush();
  };
  $('newCart').onclick = () => { lastDone = null; save(); show('shop'); renderShop(); };

  function showDone() {
    const o = st.outbox.find(x => x.id === lastDone);
    if (o) st.doneInfo = { id: o.id, code: o.code, sum: o.sum };
    const info = st.doneInfo && st.doneInfo.id === lastDone ? st.doneInfo : {};
    $('dCode').textContent = info.code || '';
    $('dSum').textContent = fmt(info.sum);
    renderDoneState();
    show('done');
    save();
  }
  function renderDoneState() {
    const queued = st.outbox.some(x => x.id === lastDone);
    const el = $('dState');
    el.className = 'note ' + (queued ? 'warn' : 'ok');
    el.textContent = queued
      ? 'Sparat i telefonen. Köpet skickas till loppisen automatiskt när du har nät. Låt sidan vara öppen en stund om du kan.'
      : 'Registrerat hos loppisen ✓';
  }

  // ---------- utkorg: skicka avslutade köp ----------
  let flushing = false;
  async function flush() {
    if (flushing || !st.outbox.length) return;
    flushing = true;
    try {
      while (st.outbox.length) {
        const o = st.outbox[0];
        try {
          await rpc('submit_cart', { p: o });
          st.outbox.shift();
          save();
        } catch (e) {
          if (e.network || e.code === 'no_active_event' || e.code === 'server' || e.code === 'http_429') break; // försök igen senare
          console.warn('Köpet avvisades av servern', e.code, o);
          st.rejected = (st.rejected || []).concat([{ ...o, error: e.code }]).slice(-20);
          st.outbox.shift();
          save();
        }
      }
    } finally {
      flushing = false;
      if (!$('scr-done').hidden) renderDoneState();
    }
  }
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
  setInterval(() => { if (st.outbox.length) flush(); }, 30000);

  // ---------- loppisdag: hämtas när nät finns, högst var 3:e timme ----------
  async function refreshEvent() {
    if (Date.now() - st.eventAt < 3 * 3600 * 1000 && st.event) return;
    try {
      const ev = await rpc('get_active_event', {}, 6000);
      st.event = ev || null; st.eventAt = Date.now(); save(); renderShop();
    } catch (e) { /* inget nät – det gör inget */ }
  }

  // ---------- start ----------
  if (lastDone) showDone();
  else if (st.cart.stage === 'pay' && st.cart.items.length) { fillPay(); show('pay'); }
  else show('shop');
  renderShop();
  flush();
  refreshEvent();
  window.L.registerSW();

  // för automatiska tester
  window.__kund = { state: () => st, flush };
})();
