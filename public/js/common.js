// Gemensamma hjälpfunktioner för kund, station och admin.
(function () {
  const CFG = window.LOPPIS_CONFIG || {};
  // Appens rotadress, t.ex. https://forening.github.io/barnloppis/ – räknas fram från var common.js ligger,
  // så att samma filer fungerar både på en egen domän och under en GitHub Pages-undermapp.
  const BASE = new URL('..', document.currentScript.src).href;

  const fmt = n => Math.round(n || 0).toLocaleString('sv-SE') + ' kr';
  const hhmm = ts => ts ? new Date(ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '–';
  const pad3 = n => String(n).padStart(3, '0');
  const dayName = d => new Date(d + (String(d).length === 10 ? 'T12:00:00' : '')).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  // Kundkod: BL- + 4 tecken utan förväxlingsbara tecken (0/O, 1/I osv.)
  const ALPH = 'ACDEFHJKLMNPRTUVWXY34679';
  function newCode() {
    const r = crypto.getRandomValues(new Uint8Array(4));
    return 'BL-' + [...r].map(x => ALPH[x % ALPH.length]).join('');
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  class ApiError extends Error { constructor(code, network) { super(code); this.code = code; this.network = !!network; } }

  // Anropar en databasfunktion i Supabase. Kastar ApiError.
  async function rpc(fn, args, timeoutMs = 10000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey, Authorization: `Bearer ${CFG.supabaseAnonKey}` },
        body: JSON.stringify(args || {})
      });
    } catch (e) {
      throw new ApiError('network', true);
    } finally { clearTimeout(t); }
    if (!res.ok) throw new ApiError(res.status >= 500 ? 'server' : 'http_' + res.status, res.status >= 500);
    const data = await res.json();
    if (data && data.error) throw new ApiError(data.error, false);
    return data;
  }

  const ERR = {
    network: 'Ingen kontakt med servern. Kontrollera nätet och försök igen.',
    server: 'Servern svarar inte just nu. Försök igen om en stund.',
    wrong_code: 'Fel stationskod.',
    wrong_password: 'Fel lösenord.',
    too_many_attempts: 'För många felaktiga försök. Vänta 10 minuter.',
    no_active_event: 'Ingen loppisdag är aktiv. Admin behöver aktivera dagens loppis.',
    invalid_station: 'Välj ett stationsnummer mellan 1 och 8.',
    invalid_date: 'Ange ett datum.',
    invalid_commission: 'Provisionen måste vara 0–100 % och minimibeloppet hela kronor.',
    short_station_code: 'Stationskoden måste vara minst 4 tecken.'
  };
  const errText = e => ERR[e && e.code] || ('Något gick fel (' + (e && e.code || e) + ').');

  // QR-format: RBL1|<kundkod>|<köp-id>|<säljare:pris,säljare:pris,...>
  function encodeCart(c) {
    return ['RBL1', c.code, c.id, c.items.map(i => i.s + ':' + i.p).join(',')].join('|');
  }
  function decodeCart(text) {
    const parts = String(text || '').trim().split('|');
    if (parts.length !== 4 || parts[0] !== 'RBL1') return null;
    const [, code, id, list] = parts;
    if (!/^[A-Za-z0-9-]{1,16}$/.test(code) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const items = [];
    for (const pair of list.split(',')) {
      const m = /^(\d{1,3}):(\d{1,5})$/.exec(pair);
      if (!m) return null;
      const s = +m[1], p = +m[2];
      if (s < 1 || s > 999 || p < 1) return null;
      items.push({ s, p });
    }
    if (!items.length) return null;
    return { code, id, items };
  }

  function swishLink(amount, message) {
    const data = { version: 1, payee: { value: CFG.swishNumber, editable: false }, amount: { value: amount, editable: false }, message: { value: message, editable: false } };
    return 'swish://payment?data=' + encodeURIComponent(JSON.stringify(data));
  }
  const swishPretty = () => {
    const n = String(CFG.swishNumber || '');
    return n.length === 10 ? `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 8)} ${n.slice(8)}` : n;
  };

  function registerSW() {
    const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && secure) navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE }).catch(() => {});
  }

  window.L = { CFG, BASE, fmt, hhmm, pad3, dayName, $, esc, uuid, newCode, store, rpc, ApiError, errText, encodeCart, decodeCart, swishLink, swishPretty, registerSW };
})();
