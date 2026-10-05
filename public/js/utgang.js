// Utgångsstation: skanna kundens QR-kod, kontrollera Swish-kvittot, synka i omgångar.
(function () {
  const { CFG, fmt, hhmm, pad3, dayName, $, esc, store, rpc, errText, decodeCart } = window.L;
  const KEY = 'rbl-station-v1';
  const SYNC_MS = (CFG.stationSyncMinutes || 5) * 60000;

  const st = store.get(KEY, null) || {};
  st.login = st.login || null;             // { code, station, event:{id,date,name} }
  st.queue = Array.isArray(st.queue) ? st.queue : [];
  st.lastSync = st.lastSync || 0;          // senaste lyckade synk
  st.lastAttempt = st.lastAttempt || 0;
  const save = () => store.set(KEY, st);

  const total = c => c.items.reduce((a, i) => a + i.p, 0);
  const pending = () => st.queue.filter(q => q.checked && !q.synced && st.login && q.event_id === st.login.event.id);
  const pendingAll = () => st.queue.filter(q => q.checked && !q.synced);
  let selected = null, scanner = null, syncing = false, lastError = '';

  $('store1').textContent = CFG.storeName;

  // ---------- inloggning ----------
  function showLogin() {
    $('vLogin').hidden = false; $('vMain').hidden = true;
    const left = pendingAll().length;
    $('leftover').hidden = !left;
    $('leftover').textContent = left ? `${left} kontrollerade köp från ett tidigare pass är inte skickade. De skickas när du loggar in igen på samma loppisdag.` : '';
  }
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('inCode').value.trim(), station = +$('inStation').value;
    if (!code) { $('loginErr').textContent = 'Skriv in stationskoden.'; return; }
    $('loginBtn').disabled = true; $('loginErr').textContent = '';
    try {
      const r = await rpc('station_login', { p_code: code, p_station: station });
      st.login = { code, station, event: r.event };
      // rensa redan skickade köp från andra loppisdagar
      st.queue = st.queue.filter(q => !q.synced || q.event_id === r.event.id);
      save(); showMain(); trySync(true);
    } catch (err) {
      $('loginErr').textContent = errText(err);
    } finally { $('loginBtn').disabled = false; }
  });

  // ---------- huvudvy ----------
  function showMain() {
    $('vLogin').hidden = true; $('vMain').hidden = false;
    $('stTitle').firstChild.textContent = 'Station ' + st.login.station;
    $('stDay').textContent = dayName(st.login.event.date) + (st.login.event.name ? ' · ' + st.login.event.name : '');
    render();
  }
  function render() {
    const p = pending().length;
    $('syncChip').textContent = p ? `${p} ej skickade` : 'Allt skickat';
    $('syncChip').style.background = p ? 'var(--warn-soft)' : '';
    $('syncChip').style.color = p ? 'var(--warn)' : '';
    $('syncText').textContent = (syncing ? 'Skickar… ' : '') +
      (lastError ? lastError + ' ' : '') +
      (st.lastSync ? 'Senast skickat ' + hhmm(st.lastSync) + '.' : 'Inget skickat än.') +
      (p ? ` Nästa försök inom ${Math.max(1, Math.ceil((st.lastAttempt + SYNC_MS - Date.now()) / 60000))} min.` : '');
    $('syncBtn').disabled = !p || syncing;

    const mine = st.queue.filter(q => q.event_id === st.login.event.id).slice(0, 40);
    $('list').innerHTML = mine.length ? mine.map(q => {
      const s = q.checked ? (q.synced ? '<span class="status st-ok">Skickad</span>' : '<span class="status st-wait">Ej skickad</span>') : '<span class="status st-open">Ej kontrollerad</span>';
      return `<button class="qitem" data-id="${esc(q.id)}"><span class="c">${esc(q.code)}</span><span class="s">${fmt(total(q))}</span><span class="small">${q.items.length} varor · ${hhmm(q.scanned)}${q.method === 'kontant' ? ' · kontant' : ''}</span><span>${s}</span></button>`;
    }).join('') : '<div class="empty">Inga kunder skannade än.</div>';
    $('list').querySelectorAll('.qitem').forEach(b => b.onclick = () => { selected = b.dataset.id; renderDetail(); window.scrollTo(0, 0); });
    renderDetail();
  }

  function renderDetail() {
    const q = st.queue.find(x => x.id === selected);
    const D = $('detail');
    if (!q) { D.hidden = true; return; }
    D.hidden = false;
    const sum = total(q);
    const items = [...q.items].sort((a, b) => a.s - b.s);
    D.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div><div class="small">Kundkod</div><div class="codebig">${esc(q.code)}</div></div>
        <div class="small" style="text-align:right">Skannad ${hhmm(q.scanned)}<br>${q.items.length} varor</div>
      </div>
      ${q.checked
        ? `<div class="paystate paid"><span>✓ ${q.method === 'kontant' ? 'Betald kontant' : 'Swish kontrollerad'} ${hhmm(q.checked)}</span><span class="big">${fmt(sum)}</span></div>`
        : `<div class="paystate wait"><span>Kontrollera betalningen</span><span class="big">${fmt(sum)}</span></div>
           <div><div class="small" style="font-weight:600;margin-bottom:4px">Titta på kundens Swish-kvitto</div>
             <ol class="checklist"><li>Mottagare: ${esc(CFG.storeName)}</li><li>Belopp: <b>${fmt(sum)}</b></li><li>Meddelande: <span class="mono">${esc(q.code)}</span>, tid från nyss</li></ol></div>
           <div class="two"><button class="btn btn-primary" id="okSwish">Swish kontrollerad</button><button class="btn btn-ghost" id="okCash">Betald kontant</button></div>`}
      <div class="small" style="font-weight:600">Varor, sorterade på säljare</div>
      <div class="ilist">${items.map(i => `<div class="ichip"><span class="sid">${pad3(i.s)}</span><span>${fmt(i.p)}</span></div>`).join('')}</div>
      <button class="btn btn-ghost" id="detailClose">Klar, nästa kund</button>`;
    if (!q.checked) { $('okSwish').onclick = () => mark(q, 'swish'); $('okCash').onclick = () => mark(q, 'kontant'); }
    $('detailClose').onclick = () => { selected = null; render(); };
  }

  function mark(q, method) {
    q.checked = Date.now(); q.method = method; q.synced = false;
    save(); render(); trySync(false);
  }

  // ---------- skanning ----------
  function onScan(text) {
    const c = decodeCart(text);
    if (!c) { $('scanErr').textContent = 'Det här är inte en QR-kod från loppisappen.'; return false; }
    let q = st.queue.find(x => x.id === c.id);
    if (!q) {
      q = { id: c.id, code: c.code, items: c.items, scanned: Date.now(), checked: null, method: null, synced: false, event_id: st.login.event.id };
      st.queue.unshift(q);
    } else if (!q.checked) {
      q.items = c.items; q.code = c.code; // kunden kan ha ändrat korgen
    }
    selected = q.id; save();
    stopScan(); render();
    return true;
  }
  async function startScan() {
    $('scanErr').textContent = ''; $('scanBox').hidden = false; $('scanBtn').hidden = true; $('detail').hidden = true;
    if (!window.Html5Qrcode) { $('scanErr').textContent = 'Kameraskannern kunde inte laddas.'; return; }
    try {
      scanner = scanner || new Html5Qrcode('reader', { verbose: false });
      await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } },
        text => { onScan(text); }, () => {});
    } catch (e) {
      $('scanErr').textContent = 'Kameran gick inte att starta. Tillåt kameran för den här sidan i webbläsarens inställningar.';
    }
  }
  async function stopScan() {
    $('scanBox').hidden = true; $('scanBtn').hidden = false;
    try { if (scanner && scanner.isScanning) await scanner.stop(); } catch (e) {}
  }
  $('scanBtn').onclick = startScan;
  $('scanCancel').onclick = () => { stopScan(); render(); };

  // ---------- synk ----------
  async function trySync(force) {
    if (!st.login || syncing) return;
    const list = pending();
    if (!list.length) { render(); return; }
    if (!force && Date.now() - st.lastAttempt < SYNC_MS) { render(); return; }
    syncing = true; st.lastAttempt = Date.now(); save(); render();
    try {
      const r = await rpc('station_sync', {
        p_event: st.login.event.id, p_code: st.login.code, p_station: st.login.station,
        p_carts: list.map(q => ({ id: q.id, code: q.code, checked: q.checked, method: q.method, items: q.items.map(i => ({ s: i.s, p: i.p })) }))
      }, 20000);
      const rejected = new Set(r.rejected || []);
      list.forEach(q => { if (!rejected.has(q.id)) q.synced = true; });
      st.lastSync = Date.now(); lastError = rejected.size ? `${rejected.size} köp avvisades.` : '';
    } catch (e) {
      lastError = e.code === 'wrong_code' ? 'Stationskoden har ändrats. Stäng stationen och logga in igen.' : (e.network ? 'Inget nät just nu.' : errText(e));
    } finally { syncing = false; save(); render(); }
    return pending().length === 0;
  }
  $('syncBtn').onclick = () => trySync(true);
  setInterval(() => trySync(false), 30000);
  window.addEventListener('online', () => trySync(false));

  // ---------- stäng station ----------
  async function closeStation() {
    $('closeSheet').hidden = false;
    $('closeTitle').textContent = 'Stänger station…';
    $('closeText').textContent = 'Skickar kontrollerade köp.';
    ['closeRetry', 'closeAnyway', 'closeCancel'].forEach(id => $(id).hidden = true);
    await trySync(true);
    const left = pending().length;
    if (!left) { await stopScan(); logout(); return; }
    $('closeTitle').textContent = `${left} köp är inte skickade`;
    $('closeText').textContent = 'Försök igen när du har nät. Stänger du ändå ligger köpen kvar i den här telefonen och skickas nästa gång någon loggar in här samma loppisdag. Kunderna som tryckt Klart finns redan hos admin.';
    ['closeRetry', 'closeAnyway', 'closeCancel'].forEach(id => $(id).hidden = false);
  }
  function logout() {
    $('closeSheet').hidden = true;
    st.login = null; selected = null; save();
    $('inCode').value = '';
    showLogin();
  }
  $('closeBtn').onclick = closeStation;
  $('closeRetry').onclick = closeStation;
  $('closeAnyway').onclick = () => { stopScan(); logout(); };
  $('closeCancel').onclick = () => { $('closeSheet').hidden = true; };

  // ---------- start ----------
  if (st.login) showMain(); else showLogin();
  window.L.registerSW();
  window.__station = { scan: onScan, sync: () => trySync(true), state: () => st };
})();
