# Rydebäcks Barnloppis – webbapp

Tre sidor och en databas:

| Adress | För vem | Nät |
|---|---|---|
| `/` | Kunder. Lägg till varor (säljare 1–999, pris i hela kronor), betala med Swish, tryck **Klart**. | Bara första gången sidan öppnas och när kunden trycker Klart. Saknas nät ligger köpet i telefonens utkorg tills nätet finns. |
| `/utgang/` | Volontärer vid utgången (2–8 stationer). Skannar kundens QR-kod, kontrollerar Swish-kvittot. Frivilligt. | Inloggning kräver nät. Sedan offline; kontrollerade köp skickas var 5:e minut. |
| `/admin/` | Arrangörer. Loppisdagar, provision, köp, varor, stationer, Excel-export. | Ja. Data hämtas när du trycker **Hämta senaste**. |

Ett köp syns i admin när kunden tryckt **Klart** *eller* när en station synkat det. Admin visar för varje köp och vara om en volontär har kontrollerat det.

Provision räknas per säljare och loppisdag: `max(avrunda(försäljning × procent), minimibelopp)`, men aldrig mer än säljarens försäljning. Standard 10 % och minst 30 kr; ändras per loppisdag i admin.

---

## Installation (ca 30 minuter, en gång)

### 1. Databasen (Supabase, gratis)
1. Skapa ett konto på <https://supabase.com> och ett nytt projekt (region: Stockholm/eu-north om den finns, annars Frankfurt).
2. Öppna **SQL Editor → New query**, klistra in hela `supabase/schema.sql` och tryck **Run**.
3. Sätt adminlösenordet (minst 10 tecken) i en ny query:
   ```sql
   select set_admin_password('välj-ett-långt-lösenord');
   ```
4. Gå till **Project Settings → API** och kopiera **Project URL** och **anon public key**.

### 2. Inställningar
Öppna `public/config.js` och fyll i:
- `supabaseUrl` och `supabaseAnonKey` från steg 1.4
- `swishNumber`: föreningens Swish Företag-nummer, bara siffror (t.ex. `1231234567`)

### 3. Publicera sidorna (GitHub Pages, gratis)
Projektet innehåller en färdig publiceringsrutin (`.github/workflows/pages.yml`) som lägger ut mappen `public/` varje gång något ändras.

1. Skapa ett konto på <https://github.com> (gärna ett föreningskonto) och ett nytt **publikt** repository, t.ex. `barnloppis`. Gratis GitHub Pages kräver publikt repo. Det är ofarligt: inga köp, lösenord eller stationskoder finns i filerna, och Supabase-nyckeln i `config.js` är gjord för att synas i webbläsaren.
2. Lägg upp hela projektmappen (med `.github`, `public`, `supabase`, `tests`, `README.md`):
   - **Med GitHub Desktop** (enklast): *File → Add local repository* → välj mappen → *Publish repository*.
   - **Med git:**
     ```bash
     cd barnloppis
     git init -b main && git add . && git commit -m "Barnloppis"
     git remote add origin https://github.com/<konto>/barnloppis.git
     git push -u origin main
     ```
   - **Via webben:** *Add file → Upload files* och dra in mappens innehåll. Webbläsare hoppar ofta över dolda mappar, så kontrollera att `.github/workflows/pages.yml` kom med; annars skapa den med *Add file → Create new file*, skriv namnet `.github/workflows/pages.yml` och klistra in innehållet.
3. I repot: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Gå till fliken **Actions**. Kör *Publicera till GitHub Pages* (startar av sig själv vid nästa ändring, eller tryck *Run workflow*). Efter någon minut finns sidan på
   `https://<konto>.github.io/barnloppis/` – utgången på `…/barnloppis/utgang/` och admin på `…/barnloppis/admin/`.
5. Kryssa i **Enforce HTTPS** under Settings → Pages (krävs för kameran och offline-läget).

Egen domän (valfritt, t.ex. `loppis.rydeback.se`): Settings → Pages → **Custom domain**, och lägg en CNAME-post hos domänleverantören som pekar på `<konto>.github.io`.

**Vid ändringar:** ändra filen (direkt på github.com går bra, t.ex. `public/config.js`), och **höj `VERSION` i `public/sw.js`** i samma ändring. Annars fortsätter telefoner som redan besökt sidan att visa den gamla versionen. Publiceringen sker automatiskt inom ett par minuter.

Appen fungerar lika bra på andra statiska värdar (Cloudflare Pages, Netlify, egen webbserver) – ladda då upp innehållet i `public/`. Alla sökvägar är relativa, så den fungerar både i en undermapp och på en egen domän.

### 4. Testa Swish före första loppisen
Öppna sidan på en iPhone och en Android, lägg till en vara för 1 kr, tryck **Betala → Öppna Swish**. Kontrollera att Swish öppnas med föreningens nummer, 1 kr och kundkoden som meddelande. Swish styr länkformatet, så testa även efter Swish-uppdateringar.

---

## Inför varje loppisdag
1. **Väck databasen** några dagar innan: logga in på Supabase. Gratisprojekt pausas efter en vecka utan aktivitet; tryck **Restore** om projektet är pausat (tar några minuter).
2. I `/admin/`: **Ny loppisdag** → datum, provision, minimibelopp, en **stationskod** (t.ex. `sol42`) och bocka i **Aktiv**.
3. Skriv ut en QR-kod till entrén som pekar på sidans adress (t.ex. med valfri QR-generator).
4. Ge volontärerna adressen `…/utgang/` och dagens stationskod. Varje station väljer ett nummer 1–8.

## Under dagen
- Kunder: scanna QR vid entrén → handla → **Betala** → **Öppna Swish** → betala → **Klart**.
- Volontärer: **Skanna kund** → jämför Swish-kvittot med summan → **Swish kontrollerad** eller **Betald kontant**.
- När en station stängs: tryck **Stäng station**. Den skickar allt som återstår och varnar om något inte gick att skicka.

## Efter dagen
1. `/admin/` → **Hämta senaste** → **Exportera till Excel**. Filen har flikarna *Per säljare* (underlag för utbetalning), *Köp*, *Varor* och *Inställningar*.
2. Stäm av mot föreningens Swish-rapport från banken. Kundkoden (t.ex. `BL-7F3Q`) står som meddelande på varje Swish-betalning. Filtrera **Köp → Ej kontrollerade** för att se köp som ingen volontär kontrollerat.
3. Gratisplanen har inga automatiska säkerhetskopior. Spara Excel-filen. Vill ni ha säkerhetskopior och slippa paus: uppgradera till Supabase Pro (ca 25 USD/mån) under loppismånaderna.

---

## Teknik i korthet
- Statiska filer utan byggsteg: HTML, CSS och JavaScript. Bibliotek i `public/vendor/`: `qrcode-generator` (QR-kod), `html5-qrcode` (kameraskanning), SheetJS (Excel).
- En service worker (`sw.js`) sparar kundsidan och utgångsvyn i telefonen, så de öppnas utan nät.
- Webbsidorna når aldrig tabellerna direkt. All åtkomst går via databasfunktioner i `schema.sql`:
  - `get_active_event`, `submit_cart` – kund (bara lägga till köp; validerar säljare 1–999 och priser)
  - `station_login`, `station_sync` – station (kräver stationskod)
  - `admin_*` – admin (kräver adminlösenord)
  - 30 felaktiga koder på 10 minuter spärrar inloggning i 10 minuter.
- Varje köp har ett id som skapas i kundens telefon. Om samma köp kommer både från kunden och en station slås de ihop; kundens varulista gäller. Om summan volontären såg skiljer sig markeras köpet **avvikelse** i admin.
- QR-koden innehåller hela korgen: `RBL1|BL-7F3Q|<köp-id>|112:40,45:75,…`

## Kapacitet (uppmätt i test)
1 000 köp à 15 varor: ~0,7 kB per köp när kunden trycker Klart (totalt 0,7 MB), 8 stationer × 4 synkomgångar på 0,2 s, admin hämtar hela dagen (1 MB) på under 0,1 s mot en lokal databas. Databasen växer med ca 2 MB per loppisdag – gratisplanens 500 MB räcker för många år.

## Tester (för utvecklare)
Kräver Node 18+, Python med Playwright och en lokal PostgreSQL 15+.
```bash
# databas
createdb loppis
psql -d loppis -c "create role anon nologin; create role authenticated nologin; create schema extensions;"
psql -d loppis -f supabase/schema.sql
psql -d loppis -f tests/sql_test.sql          # databasfunktioner och behörigheter
# testserver som efterliknar Supabase
cd tests && npm install && node server.mjs &
python3 e2e.py                                # hela flödet i webbläsare, inkl. offline
# samma test i en undermapp, som på GitHub Pages:
BASE_PATH=/barnloppis PORT=8788 node server.mjs &
BASE=http://localhost:8788/barnloppis python3 e2e.py
node load.mjs                                 # 1 000 köp, 8 stationer
```
(`server.mjs` och testerna ansluter till Postgres via unix-socket `/tmp`, port 54329 – ändra överst i filerna vid behov.)
