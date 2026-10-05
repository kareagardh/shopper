// Admin: loppisdagar, provision, köp, varor, stationer och Excel-export.
(function () {
  const { CFG, fmt, hhmm, pad3, dayName, $, esc, rpc, errText } = window.L;
  const PW_KEY = 'rbl-admin-pw';
  let pw = null, events = [], evId = null, data = null, tab = 'sellers', limit = 300;
  const f = { seller: '', code: '', check: 'all' };

  $('store1').textContent = CFG.storeName; $('store2').textContent = CFG.storeName;
  try { pw = sessionStorage.getItem(PW_KEY); } catch (e) {}

  function msg(text, ok) {
    const m = $('msg');
    if (!text) { m.hidden = true; return; }
    m.hidden = false; m.className = 'msg ' + (ok ? 'ok' : 'bad'); m.textContent = text;
  }

  // ---------- inloggning ----------
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('loginBtn').disabled = true; $('loginErr').textContent = '';
    try {
      await rpc('admin_login', { p_password: $('pw').value });
      pw = $('pw').value; try { sessionStorage.setItem(PW_KEY, pw); } catch (e) {}
      await start();
    } catch (err) { $('loginErr').textContent = errText(err); }
    finally { $('loginBtn').disabled = false; }
  });
  $('logoutBtn').onclick = () => { pw = null; try { sessionStorage.removeItem(PW_KEY); } catch (e) {} location.reload(); };

  async function start() {
    $('vLogin').hidden = true; $('vMain').hidden = false;
    await loadEvents();
    await loadData();
  }

  // ---------- loppisdagar ----------
  async function loadEvents() {
    const r = await rpc('admin_events', { p_password: pw });
    events = r.events;
    if (!evId || (evId !== 'all' && !events.some(e => e.id === evId))) {
      const a = events.find(e => e.active) || events[0];
      evId = a ? a.id : 'all';
    }
    const sel = $('evSel');
    sel.innerHTML = events.map(e => `<option value="${e.id}">${esc(dayName(e.date))}${e.name ? ' · ' + esc(e.name) : ''}${e.active ? ' (aktiv)' : ''}</option>`).join('') +
      '<option value="all">Alla loppisdagar</option>';
    sel.value = evId;
    const act = events.find(e => e.active);
    $('evSummary').textContent = act ? `Aktiv: ${dayName(act.date)} · ${act.commission_pct} %, minst ${act.commission_min} kr${act.has_station_code ? '' : ' · ingen stationskod satt!'}` : 'Ingen aktiv loppisdag – kunder kan inte registrera köp.';
    $('editEvBtn').disabled = evId === 'all';
    if (!events.length) openEvForm(null);
  }
  $('evSel').onchange = async e => { evId = e.target.value; $('editEvBtn').disabled = evId === 'all'; limit = 300; await loadData(); };

  let editing = null;
  function openEvForm(ev) {
    editing = ev;
    $('evForm').hidden = false;
    $('fDate').value = ev ? ev.date : new Date().toISOString().slice(0, 10);
    $('fName').value = ev ? ev.name : '';
    $('fPct').value = ev ? ev.commission_pct : 10;
    $('fMin').value = ev ? ev.commission_min : 30;
    $('fCode').value = '';
    $('fCode').placeholder = ev && ev.has_station_code ? 'oförändrad' : 'välj en kod';
    $('fActive').checked = ev ? ev.active : !events.some(e => e.active);
  }
  $('newEvBtn').onclick = () => openEvForm(null);
  $('editEvBtn').onclick = () => openEvForm(events.find(e => e.id === evId));
  $('evCancel').onclick = () => { $('evForm').hidden = true; };
  $('evForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!editing && !$('fCode').value.trim()) { msg('Välj en stationskod för den nya loppisdagen.'); return; }
    $('evSave').disabled = true;
    try {
      const r = await rpc('admin_save_event', { p_password: pw, p: {
        id: editing ? editing.id : null, date: $('fDate').value, name: $('fName').value.trim(),
        commission_pct: $('fPct').value, commission_min: $('fMin').value,
        active: $('fActive').checked, station_code: $('fCode').value.trim()
      } });
      evId = r.id; $('evForm').hidden = true; msg('Loppisdagen är sparad.', true);
      await loadEvents(); await loadData();
    } catch (err) { msg(errText(err)); }
    finally { $('evSave').disabled = false; }
  });

  // ---------- data ----------
  async function loadData() {
    $('refreshBtn').disabled = true;
    try {
      data = await rpc('admin_data', { p_password: pw, p_event: evId === 'all' ? null : evId }, 60000);
      $('fetched').textContent = 'Hämtat ' + new Date(data.fetched_at).toLocaleString('sv-SE') + '. Sidan uppdateras inte av sig själv – tryck Hämta senaste.';
      render();
    } catch (err) {
      if (err.code === 'wrong_password') { pw = null; location.reload(); return; }
      msg(errText(err));
    } finally { $('refreshBtn').disabled = false; }
  }
  $('refreshBtn').onclick = () => { msg(''); loadData(); };

  const diff = c => c.checked_total != null && c.checked_total !== c.total;
  const checkPill = c => c.checked_station
    ? `<span class="status ${diff(c) ? 'st-bad' : 'st-ok'}" title="${diff(c) ? 'Volontären såg ' + fmt(c.checked_total) : ''}">✓ Station ${c.checked_station} ${hhmm(c.checked_at)}${diff(c) ? ' · avvikelse' : ''}</span>`
    : '<span class="status st-open">Ej kontrollerad</span>';

  function render() {
    const C = data.carts, S = data.sellers;
    const sales = S.reduce((a, s) => a + s.sales, 0), comm = S.reduce((a, s) => a + s.commission, 0);
    $('sCarts').textContent = C.length;
    $('sUnchecked').textContent = C.filter(c => !c.checked_station).length;
    $('sDiff').textContent = C.filter(diff).length;
    $('sSales').textContent = fmt(sales); $('sComm').textContent = fmt(comm);
    $('sPayout').textContent = fmt(sales - comm); $('sSellers').textContent = S.length;
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
    renderFilters(); renderTable();
  }

  function renderFilters() {
    const F = $('filters');
    if (tab === 'sellers') F.innerHTML = `<div class="ctl"><label for="ffSeller">Säljare nr</label><input id="ffSeller" inputmode="numeric" value="${esc(f.seller)}" style="width:110px"></div>`;
    else if (tab === 'carts') F.innerHTML = `<div class="ctl"><label for="ffCode">Kundkod</label><input id="ffCode" value="${esc(f.code)}" placeholder="t.ex. 7F3Q" style="width:140px"></div>
      <div class="ctl"><label for="ffCheck">Visa</label><select id="ffCheck">
        <option value="all">Alla köp</option><option value="unchecked">Ej kontrollerade</option><option value="checked">Kontrollerade</option><option value="diff">Summa avviker</option></select></div>`;
    else if (tab === 'items') F.innerHTML = `<div class="ctl"><label for="ffSeller">Säljare nr</label><input id="ffSeller" inputmode="numeric" value="${esc(f.seller)}" style="width:110px"></div>
      <div class="ctl"><label for="ffCheck">Visa</label><select id="ffCheck"><option value="all">Alla varor</option><option value="unchecked">Ej kontrollerade köp</option><option value="checked">Kontrollerade köp</option></select></div>`;
    else F.innerHTML = '<span class="small">Senaste synk per station. En station som stängts med osynkade köp syns som en gammal tid.</span>';
    const s = $('ffSeller'), c = $('ffCode'), k = $('ffCheck');
    if (s) s.oninput = () => { f.seller = s.value.replace(/\D/g, ''); limit = 300; renderTable(); };
    if (c) c.oninput = () => { f.code = c.value.trim().toUpperCase(); limit = 300; renderTable(); };
    if (k) { if ([...k.options].some(o => o.value === f.check)) k.value = f.check; else f.check = 'all'; k.onchange = () => { f.check = k.value; limit = 300; renderTable(); }; }
  }

  function renderTable() {
    const T = $('tbl'), all = evId === 'all';
    let moreAvail = false;
    if (tab === 'sellers') {
      let rows = data.sellers;
      if (f.seller) rows = rows.filter(s => String(s.seller) === String(+f.seller));
      const t = k => rows.reduce((a, s) => a + s[k], 0);
      T.innerHTML = `<thead><tr><th>Säljare nr</th><th class="n">Sålda varor</th><th class="n">Försäljning</th><th class="n">Provision</th><th class="n">Att betala ut</th></tr></thead><tbody>` +
        (rows.length ? rows.map(s => `<tr><td><span class="sid">${pad3(s.seller)}</span></td><td class="n">${s.items}</td><td class="n">${fmt(s.sales)}</td><td class="n">${fmt(s.commission)}${s.min_applied ? '<span class="minflag">MIN</span>' : ''}</td><td class="n">${fmt(s.payout)}</td></tr>`).join('')
          : '<tr><td colspan="5" class="small">Inga köp ännu.</td></tr>') +
        `</tbody><tfoot><tr><td>Totalt</td><td class="n">${t('items')}</td><td class="n">${fmt(t('sales'))}</td><td class="n">${fmt(t('commission'))}</td><td class="n">${fmt(t('payout'))}</td></tr></tfoot>`;
    } else if (tab === 'carts') {
      let rows = data.carts;
      if (f.code) rows = rows.filter(c => c.code.toUpperCase().includes(f.code));
      if (f.check === 'unchecked') rows = rows.filter(c => !c.checked_station);
      if (f.check === 'checked') rows = rows.filter(c => c.checked_station);
      if (f.check === 'diff') rows = rows.filter(diff);
      moreAvail = rows.length > limit;
      T.innerHTML = `<thead><tr><th>Kundkod</th>${all ? '<th>Dag</th>' : ''}<th>Kunden tryckte Klart</th><th>Volontärkontroll</th><th>Betalsätt</th><th class="n">Varor</th><th class="n">Summa</th><th></th></tr></thead><tbody>` +
        rows.slice(0, limit).map(c => `<tr data-id="${c.id}"><td class="mono">${esc(c.code)}</td>${all ? `<td>${c.date}</td>` : ''}<td>${c.done_at ? hhmm(c.done_at) : '–'}</td><td>${checkPill(c)}</td><td>${c.checked_method === 'kontant' ? 'Kontant' : 'Swish'}</td><td class="n">${c.count}</td><td class="n">${fmt(c.total)}</td>
          <td><button class="b ghost small" data-act="show">Varor</button> <button class="b ghost small" data-act="del">Ta bort</button></td></tr>`).join('') + '</tbody>';
      T.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => cartAction(b.closest('tr'), b.dataset.act));
    } else if (tab === 'items') {
      let rows = [];
      for (const c of data.carts) for (const [s, p, t] of (c.items || [])) rows.push({ s, p, t, c });
      if (f.seller) rows = rows.filter(r => r.s === +f.seller);
      if (f.check === 'unchecked') rows = rows.filter(r => !r.c.checked_station);
      if (f.check === 'checked') rows = rows.filter(r => r.c.checked_station);
      moreAvail = rows.length > limit;
      T.innerHTML = `<thead><tr>${all ? '<th>Dag</th>' : ''}<th>Tillagd</th><th>Säljare nr</th><th class="n">Pris</th><th>Kundkod</th><th>Volontärkontroll</th></tr></thead><tbody>` +
        rows.slice(0, limit).map(r => `<tr>${all ? `<td>${r.c.date}</td>` : ''}<td>${hhmm(r.t)}</td><td><span class="sid">${pad3(r.s)}</span></td><td class="n">${fmt(r.p)}</td><td class="mono">${esc(r.c.code)}</td><td>${checkPill(r.c)}</td></tr>`).join('') +
        `</tbody><tfoot><tr>${all ? '<td></td>' : ''}<td>${rows.length} varor</td><td></td><td class="n">${fmt(rows.reduce((a, r) => a + r.p, 0))}</td><td></td><td></td></tr></tfoot>`;
    } else {
      const rows = data.stations;
      T.innerHTML = `<thead><tr>${all ? '<th>Dag</th>' : ''}<th>Station</th><th>Senaste synk</th><th class="n">Kontrollerade köp</th></tr></thead><tbody>` +
        (rows.length ? rows.map(s => `<tr>${all ? `<td>${s.date}</td>` : ''}<td>Station ${s.station}</td><td>${hhmm(s.last_sync)}</td><td class="n">${s.checked}</td></tr>`).join('') : '<tr><td colspan="4" class="small">Ingen station har synkat ännu.</td></tr>') + '</tbody>';
    }
    $('more').hidden = !moreAvail;
  }
  $('moreBtn').onclick = () => { limit += 1000; renderTable(); };
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.tab; f.check = 'all'; limit = 300; render(); });

  function cartAction(tr, act) {
    const c = data.carts.find(x => x.id === tr.dataset.id);
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('sub')) { next.remove(); if (act === 'show') return; }
    const sub = document.createElement('tr'); sub.className = 'sub';
    const cols = tr.children.length;
    if (act === 'show') {
      sub.innerHTML = `<td colspan="${cols}" class="itemsline">${(c.items || []).map(([s, p]) => `<span class="sid" style="min-width:40px">${pad3(s)}</span> ${fmt(p)}`).join(' &nbsp; ')}</td>`;
    } else {
      sub.innerHTML = `<td colspan="${cols}"><span>Ta bort köpet ${esc(c.code)} på ${fmt(c.total)} permanent?</span> <button class="b danger small" data-x="yes">Ja, ta bort</button> <button class="b ghost small" data-x="no">Avbryt</button></td>`;
      sub.querySelector('[data-x=no]').onclick = () => sub.remove();
      sub.querySelector('[data-x=yes]').onclick = async () => {
        try { await rpc('admin_delete_cart', { p_password: pw, p_cart: c.id }); msg(`Köpet ${c.code} är borttaget.`, true); await loadData(); }
        catch (err) { msg(errText(err)); }
      };
    }
    tr.after(sub);
  }

  // ---------- Excel ----------
  function loadXLSX() {
    return new Promise((res, rej) => {
      if (window.XLSX) return res(window.XLSX);
      const s = document.createElement('script'); s.src = window.L.BASE + 'vendor/xlsx.full.min.js';
      s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('xlsx'));
      document.head.appendChild(s);
    });
  }
  const dt = v => v ? new Date(v).toLocaleString('sv-SE') : '';
  $('exportBtn').onclick = async () => {
    $('exportBtn').disabled = true;
    try {
      const X = await loadXLSX();
      const wb = X.utils.book_new();
      const add = (name, rows, widths) => { const ws = X.utils.json_to_sheet(rows); ws['!cols'] = widths.map(w => ({ wch: w })); X.utils.book_append_sheet(wb, ws, name); };
      add('Per säljare', data.sellers.map(s => ({ 'Säljare nr': s.seller, 'Sålda varor': s.items, 'Försäljning (kr)': s.sales, 'Provision (kr)': s.commission, 'Minimiprovision': s.min_applied ? 'Ja' : '', 'Att betala ut (kr)': s.payout })), [11, 12, 16, 15, 16, 18]);
      add('Köp', data.carts.map(c => ({ 'Kundkod': c.code, 'Loppisdag': c.date, 'Påbörjad': dt(c.created_at), 'Kunden tryckte Klart': dt(c.done_at),
        'Volontärkontroll': c.checked_station ? 'Ja' : 'Nej', 'Station': c.checked_station || '', 'Kontrollerad': dt(c.checked_at),
        'Betalsätt': c.checked_method === 'kontant' ? 'Kontant' : 'Swish', 'Antal varor': c.count, 'Summa (kr)': c.total,
        'Summa volontären såg (kr)': c.checked_total == null ? '' : c.checked_total, 'Avvikelse': diff(c) ? 'Ja' : '', 'Köp-id': c.id })), [10, 11, 19, 19, 16, 8, 19, 10, 11, 11, 22, 10, 38]);
      const items = [];
      for (const c of data.carts) for (const [s, p, t] of (c.items || [])) items.push({ 'Loppisdag': c.date, 'Säljare nr': s, 'Pris (kr)': p, 'Tillagd': dt(t), 'Kundkod': c.code, 'Volontärkontroll': c.checked_station ? 'Ja' : 'Nej' });
      add('Varor', items, [11, 11, 10, 19, 10, 16]);
      const evs = evId === 'all' ? events : events.filter(e => e.id === evId);
      add('Inställningar', evs.map(e => ({ 'Loppisdag': e.date, 'Namn': e.name, 'Provision (%)': e.commission_pct, 'Minst per säljare och dag (kr)': e.commission_min, 'Exporterad': new Date().toLocaleString('sv-SE') })), [11, 20, 13, 28, 19]);
      const name = evId === 'all' ? 'alla-dagar' : (events.find(e => e.id === evId) || {}).date;
      X.writeFile(wb, `loppis-${name}.xlsx`);
    } catch (err) { msg('Exporten misslyckades. Ladda om sidan och försök igen.'); }
    finally { $('exportBtn').disabled = false; }
  };

  // ---------- start ----------
  if (pw) start().catch(() => { pw = null; $('vLogin').hidden = false; $('vMain').hidden = true; });
})();
