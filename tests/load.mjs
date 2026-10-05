// Lasttest: 1 000 köp à 15 varor via submit_cart, 8 stationer som synkar 800 kontroller, sedan admin_data.
const BASE = process.env.BASE || 'http://localhost:8787';
const rpc = async (fn, body) => {
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (j && j.error || !r.ok) throw new Error(fn + ' ' + JSON.stringify(j)); return j;
};
const ev = await rpc('get_active_event', {});
const carts = Array.from({ length: 1000 }, (_, n) => ({
  id: crypto.randomUUID(), code: 'BL-L' + String(n).padStart(3, '0'), event_id: ev.id, created: Date.now() - 3600e3, done: Date.now(),
  items: Array.from({ length: 15 }, () => ({ s: 1 + Math.floor(Math.random() * 400), p: 5 + 5 * Math.floor(Math.random() * 40), t: Date.now() - 1800e3 }))
}));
let t0 = Date.now(), bytes = 0, i = 0;
await Promise.all(Array.from({ length: 25 }, async () => {
  while (i < carts.length) { const c = carts[i++]; const body = { p: c }; bytes += JSON.stringify(body).length; await rpc('submit_cart', body); }
}));
console.log(`1000 kunders Klart: ${Date.now() - t0} ms totalt, ${(bytes / 1000 / 1000).toFixed(2)} MB uppladdat, ${(bytes / 1000).toFixed(0) / 1000} kB per köp i snitt`);

t0 = Date.now();
await Promise.all(Array.from({ length: 8 }, async (_, st) => {
  const mine = carts.slice(st * 100, st * 100 + 100);
  for (let b = 0; b < 4; b++) { // fyra synkomgångar à 25 köp per station
    const batch = mine.slice(b * 25, b * 25 + 25).map(c => ({ id: c.id, code: c.code, checked: Date.now(), method: 'swish', items: c.items.map(x => ({ s: x.s, p: x.p })) }));
    await rpc('station_sync', { p_event: ev.id, p_code: 'sol42', p_station: st + 1, p_carts: batch });
  }
}));
console.log(`8 stationer × 4 synkomgångar (800 kontroller): ${Date.now() - t0} ms`);

t0 = Date.now();
const r = await fetch(`${BASE}/rest/v1/rpc/admin_data`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_password: 'hemligt-losen-123', p_event: ev.id }) });
const txt = await r.text(); const d = JSON.parse(txt);
console.log(`admin_data: ${Date.now() - t0} ms, ${(txt.length / 1e6).toFixed(2)} MB, ${d.carts.length} köp, ${d.carts.reduce((a, c) => a + c.count, 0)} varor, ${d.sellers.length} säljare, ${d.carts.filter(c => !c.checked_station).length} okontrollerade`);
