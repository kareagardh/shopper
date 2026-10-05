// Testserver: serverar public/ och efterliknar Supabase RPC (/rest/v1/rpc/<funktion>) mot en lokal Postgres.
// Används bara för automatiska tester – i drift sköts detta av Supabase.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require(process.env.PG_MODULE || 'pg');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public');
const PORT = +(process.env.PORT || 8787);
const pool = new pg.Pool({ host: '/tmp', port: 54329, user: 'postgres', database: process.env.PGDATABASE || 'loppis', max: 10 });
const FNS = new Set(['get_active_event', 'submit_cart', 'station_login', 'station_sync', 'admin_login', 'admin_events', 'admin_save_event', 'admin_data', 'admin_delete_cart']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let offline = false;
// BASE_PATH=/barnloppis efterliknar GitHub Pages, där sidan ligger under /<repo>/
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
export const stats = { rpc: 0, bytesIn: 0 };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (BASE_PATH && url.pathname.startsWith(BASE_PATH + '/')) url.pathname = url.pathname.slice(BASE_PATH.length);
  else if (BASE_PATH && url.pathname === BASE_PATH) { res.writeHead(301, { Location: BASE_PATH + '/' }); res.end(); return; }
  if (url.pathname === '/__offline') { offline = url.searchParams.get('v') === '1'; res.end('ok'); return; }
  if (url.pathname === '/__stats') { res.end(JSON.stringify(stats)); return; }
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    if (offline) { req.socket.destroy(); return; }
    const fn = url.pathname.split('/').pop();
    let body = '';
    for await (const ch of req) body += ch;
    stats.rpc++; stats.bytesIn += body.length;
    if (!FNS.has(fn)) { res.writeHead(404); res.end('{}'); return; }
    const args = body ? JSON.parse(body) : {};
    const keys = Object.keys(args);
    const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    const vals = keys.map(k => (args[k] !== null && typeof args[k] === 'object') ? JSON.stringify(args[k]) : args[k]);
    const c = await pool.connect();
    try {
      await c.query('begin'); await c.query('set local role anon');
      const r = await c.query(sql, vals);
      await c.query('commit');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.rows[0].r));
    } catch (e) {
      await c.query('rollback').catch(() => {});
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: e.message }));
    } finally { c.release(); }
    return;
  }
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(`window.LOPPIS_CONFIG={supabaseUrl:location.origin+'${BASE_PATH}',supabaseAnonKey:'test',swishNumber:'1234567890',storeName:'Rydebäcks Barnloppis',stationSyncMinutes:5};`);
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
server.listen(PORT, () => console.log('test server on', PORT));
