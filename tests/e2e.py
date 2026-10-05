"""Helflödestest: admin skapar loppisdag -> kund handlar (även offline) -> station kontrollerar -> admin ser och exporterar.
Kräver: lokal Postgres med schema.sql (se tests/README) och testservern (node tests/server.mjs)."""
import json, subprocess, urllib.parse, sys, os
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('BASE', 'http://localhost:8787')
PSQL = ['psql', '-h', '/tmp', '-p', '54329', '-U', 'postgres', '-d', 'loppis', '-qtAc']
def sql(q): return subprocess.run(PSQL + [q], capture_output=True, text=True, check=True).stdout.strip()

sql("truncate carts, events, station_syncs, auth_failures cascade; select set_admin_password('hemligt-losen-123');")
ok = lambda m: print('  ✓', m)

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------------- Admin skapar loppisdag ----------------
    adm = b.new_context(accept_downloads=True).new_page()
    errors = []
    adm.on('pageerror', lambda e: errors.append('admin: ' + str(e)))
    adm.goto(BASE + '/admin/')
    adm.fill('#pw', 'fel-losen'); adm.click('#loginBtn')
    expect(adm.locator('#loginErr')).to_have_text('Fel lösenord.'); ok('admin: fel lösenord avvisas')
    adm.fill('#pw', 'hemligt-losen-123'); adm.click('#loginBtn')
    expect(adm.locator('#evForm')).to_be_visible()
    adm.fill('#fDate', '2026-10-04'); adm.fill('#fName', 'Höstloppis'); adm.fill('#fCode', 'sol42')
    adm.click('#evSave')
    expect(adm.locator('#evSummary')).to_contain_text('10 %, minst 30 kr'); ok('admin: loppisdag skapad och aktiv')

    # ---------------- Kund ----------------
    kctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    k = kctx.new_page()
    k.on('pageerror', lambda e: errors.append('kund: ' + str(e)))
    k.goto(BASE + '/')
    k.evaluate("navigator.serviceWorker.ready.then(()=>true)")
    def add(s, pr):
        k.fill('#inSeller', str(s)); k.fill('#inPrice', str(pr)); k.click('#addForm button[type=submit]')
    add(0, 10); expect(k.locator('#err')).to_contain_text('mellan 1 och 999'); ok('kund: säljare 0 avvisas')
    add(112, 40); add(45, 75); add(640, 15); add(112, 25)
    expect(k.locator('#sum')).to_have_text('155 kr'); ok('kund: 4 varor, summa 155 kr')
    k.click('#sortSeller'); first = k.locator('.row .sid').first.inner_text(); assert first == '045', first; ok('kund: sortering på säljare')
    k.locator('.row .x').first.click(); expect(k.locator('#sum')).to_have_text('80 kr')
    k.click('#undo'); expect(k.locator('#sum')).to_have_text('155 kr'); ok('kund: ta bort + ångra')
    k.reload(); expect(k.locator('#sum')).to_have_text('155 kr'); ok('kund: korgen finns kvar efter omladdning')
    k.click('#goPay')
    href = k.get_attribute('#openSwish', 'href')
    data = json.loads(urllib.parse.unquote(href.split('data=')[1]))
    assert data['amount']['value'] == 155 and data['payee']['value'] == '1234567890' and data['message']['value'].startswith('BL-'), data
    ok('kund: Swish-länk ' + json.dumps(data, ensure_ascii=False))
    assert k.locator('#qr svg').count() == 1; ok('kund: QR-kod ritad')
    st = k.evaluate('window.__kund.state()')
    payload = k.evaluate('L.encodeCart(window.__kund.state().cart)')
    code1, id1 = st['cart']['code'], st['cart']['id']
    ok(f'kund: QR-innehåll {payload} ({len(payload)} tecken)')

    # offline: Klart läggs i utkorgen, sidan öppnas ändå utan nät
    kctx.set_offline(True)
    k.click('#klart'); k.click('#klartYes')
    expect(k.locator('#dState')).to_contain_text('Sparat i telefonen'); ok('kund: Klart utan nät → utkorgen')
    k.reload(); expect(k.locator('#dState')).to_contain_text('Sparat i telefonen'); ok('kund: sidan öppnas offline via service worker, utkorgen kvar')
    assert sql(f"select count(*) from carts where id='{id1}'") == '0'
    kctx.set_offline(False)
    k.evaluate("window.dispatchEvent(new Event('online'))")
    expect(k.locator('#dState')).to_contain_text('Registrerat hos loppisen'); ok('kund: utkorgen skickad när nätet kom tillbaka')
    assert sql(f"select total_sek||'/'||item_count from carts where id='{id1}'") == '155/4'
    k.click('#newCart'); expect(k.locator('#sum')).to_have_text('0 kr'); ok('kund: nytt köp startat')

    # andra kunden: Klart med nät, ingen volontär
    add(7, 100); add(8, 500); k.click('#goPay'); code2 = k.evaluate('window.__kund.state().cart.code')
    k.click('#klart'); k.click('#klartYes'); expect(k.locator('#dState')).to_contain_text('Registrerat'); ok('kund 2: registrerat direkt')

    # ---------------- Station ----------------
    sctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
    s = sctx.new_page(); s.on('pageerror', lambda e: errors.append('station: ' + str(e)))
    s.goto(BASE + '/utgang/')
    s.fill('#inCode', 'fel'); s.select_option('#inStation', '3'); s.click('#loginBtn')
    expect(s.locator('#loginErr')).to_have_text('Fel stationskod.'); ok('station: fel kod avvisas')
    s.fill('#inCode', 'sol42'); s.click('#loginBtn')
    expect(s.locator('#stTitle')).to_contain_text('Station 3'); ok('station: inloggad som station 3')
    s.evaluate('p => window.__station.scan(p)', payload)
    expect(s.locator('#detail .big')).to_have_text('155 kr'); ok('station: QR skannad, 155 kr visas')
    s.click('#okSwish'); ok('station: Swish kontrollerad')
    # tredje köp: bara via station (kundens telefon nådde aldrig fram), kontant
    s.click('#detailClose')
    s.evaluate("window.__station.scan('RBL1|BL-ZZZZ|99999999-9999-4999-8999-999999999999|12:20,12:30,999:5')")
    s.click('#okCash')
    expect(s.locator('#syncChip')).to_contain_text('ej skickade')
    s.click('#syncBtn'); expect(s.locator('#syncChip')).to_have_text('Allt skickat'); ok('station: synkat')
    s.click('#closeBtn'); expect(s.locator('#vLogin')).to_be_visible(); ok('station: stängd utan osynkade köp')

    # ---------------- Admin ser allt ----------------
    adm.click('#refreshBtn')
    expect(adm.locator('#sCarts')).to_have_text('3')
    expect(adm.locator('#sUnchecked')).to_have_text('1'); ok('admin: 3 köp, 1 utan volontärkontroll')
    sellers = {r.locator('td').nth(0).inner_text(): [r.locator('td').nth(i).inner_text() for i in range(1, 5)] for r in adm.locator('#tbl tbody tr').all()}
    print('    per säljare:', sellers)
    assert sellers['112'][1] == '65 kr' and sellers['112'][2].startswith('30 kr') and sellers['112'][3] == '35 kr', sellers['112']
    assert sellers['008'][2] == '50 kr' and sellers['008'][3] == '450 kr'
    assert sellers['012'][2].startswith('30 kr') and sellers['999'][2].startswith('5 kr') and sellers['999'][3] == '0 kr'
    ok('admin: provision 10 %, minst 30 kr, aldrig mer än försäljningen')
    adm.click('[data-tab=carts]')
    rows = [r.inner_text() for r in adm.locator('#tbl tbody tr').all()]
    assert any(code1 in r and 'Station 3' in r for r in rows) and any(code2 in r and 'Ej kontrollerad' in r for r in rows), rows
    ok('admin: kontrollerade och okontrollerade köp markerade')
    adm.click('[data-tab=items]'); assert adm.locator('#tbl tbody tr').count() == 9; ok('admin: alla 9 varor listade')
    adm.click('[data-tab=stations]'); expect(adm.locator('#tbl tbody')).to_contain_text('Station 3')
    with adm.expect_download() as dl:
        adm.click('#exportBtn')
    path = '/home/claude/barnloppis/tests/export-test.xlsx'; dl.value.save_as(path)
    ok('admin: Excel exporterad ' + dl.value.suggested_filename)
    print('ERRORS:', errors)
    b.close()
    sys.exit(1 if errors else 0)
