# Dashboard CS — Hub web operativo OSSEOTOUCH

**Versione:** 2.0 · **Ultimo aggiornamento:** 2026-04-27
**Repo:** `claydegi/dashboard-cs` · **Hosting:** Railway · **Branch deploy:** `main`

Hub Node.js/Express + PostgreSQL. Centralizza task management Customer
Service, CRM SalesForceFree, report COLTRI/ANTONIA, dashboard agenti
commerciali (Kim, Massimo), webinar Zoom, vendita SUTURE con portale
cliente su `myosseotouch.com`, shop B2B, recruiting FREELANCER, sync
JESFAG (Google Ads, YouTube, GA4, Microsoft Clarity).

**Snapshot al 2026-04-26: 237 endpoint REST · 50 tabelle Postgres · ~30 viste HTML.**

> Questo README è una **mappa tecnica**, non un manuale operativo.
> Per la business logic dei singoli moduli si rinvia alla documentazione
> di ciascun agente in `OSSEOTOUCH AI/` (vedi Appendice B).

---

## 1. Cos'è la Dashboard CS

La Dashboard CS è il **punto di ingresso web** dell'ecosistema OSSEOTOUCH AI:
gli agenti Python producono dati e report; la Dashboard CS li espone a:

- **Imprenditore** — vista admin completa
- **Agenti commerciali Kim e Massimo** — dashboard dedicate con dati filtrati
- **Cliente finale** — portale SUTURE su `myosseotouch.com/portale/<token>`
- **JAN34 (osseotouch.com)** — isole interattive che chiamano API CORS-gated
- **Script automatizzati** — push report, sync CRM, push sales rep

### Flusso dati per modulo (snapshot 2026-04-26)

```
COLTRI / ANTONIA   ──POST──►  /api/reports, /api/reports-antonia/*, /api/fatture
SalesForceFree     ──POST/GET──►  /api/crm/*, /api/mailing/*
JESFAG             ──POST──►  /api/google-ads/sync, /api/youtube/sync,
                              /api/campagne, /api/mailing/storico/sync
JAN34 (browser)    ──GET/POST►/api/shop/*, /api/webinar*/register,
                              /api/portali/:token, /api/carrelli/:token,
                              /api/leads/whatsapp-group, /api/video-tracking
cereda             ──git────►  data/giacenze_strumenti.json (via sync_daily.bat)
Stripe webhook     ──POST──►  /api/shop/stripe-webhook
Calendly webhook   ──POST──►  /api/calendly/webhook
Dashboard CS       ──pull via Zoom OAuth──►  Zoom API
                              (trigger operativo: /api/webinar/sync-zoom-participants)
```

### Repo e ciclo di vita

- Repo Git separato (`claydegi/dashboard-cs`), non parte di `OSSEOTOUCH AI/`.
- Push sul branch `main` → Railway autodeploy (~2-3 minuti).
- Database PostgreSQL Railway, persistente, schema gestito da `initDB()`.

---

## 2. Architettura

```
Browser / Cliente / Script Python
              │
              ▼ HTTPS
┌─────────────────────────────────────────────┐
│  Express 4 (server.js, monolitico ~13k loc) │
│  ├─ static serve  → public/                 │
│  ├─ host gating   → myosseotouch.com only   │
│  │                  per /portale/:token     │
│  ├─ 4 livelli auth → §11                    │
│  └─ 237 route REST → §7                     │
└─────────────────────────────────────────────┘
              │
              ├─► PostgreSQL Railway (50 tabelle, extension pgcrypto)
              ├─► Mailgun EU (email transazionali + mailing CRM)
              ├─► Stripe (shop checkout + webhook)
              ├─► Anthropic SDK (FREELANCER moduli AI)
              ├─► Odoo XML-RPC (clienti, suture, vendite)
              ├─► Zoom OAuth (recordings, partecipanti)
              ├─► Calendly webhook (opportunita')
              └─► Telegram bot (notifiche admin / Kim)
```

### Caratteristiche chiave

- Backend monolitico in `server.js`. Niente bundler, niente TypeScript,
  niente ORM, niente test suite. Pattern: Express + raw SQL parametrizzato.
- **Multi-dominio**: `dashboard-cs-production.up.railway.app` (admin /
  dashboard agenti) e `myosseotouch.com` (portale cliente SUTURE,
  discriminazione via `req.hostname`).
- Frontend in HTML + JS vanilla, asset condivisi (es. `dashboard-agente.js`
  per Kim e Massimo).
- Logica condivisa con altri agenti via API + chiave `x-reports-key`.

---

## 3. Stack & dipendenze

| Componente | Versione | Note |
|---|---|---|
| Node.js | ≥ 18.0.0 | requisito `engines` in `package.json` |
| PostgreSQL | Railway plugin | extension `pgcrypto` richiesta |
| Express | 4.x | router HTTP monolitico |
| pg | 8.11 | client Postgres (no ORM) |

Dipendenze NPM (estratto): `express`, `cors`, `pg`, `multer`, `form-data`,
`stripe`, `@anthropic-ai/sdk`.

**Cosa NON c'è** (volutamente): bundler, framework UI, ORM, migration
tool, test framework. Scelta che riflette la natura "single-developer +
AI assistant" del progetto.

---

## 4. Deploy su Railway

1. Modifica codice locale in `DASHBOARD CS/`.
2. Commit + push sul branch `main` (branch di deploy configurato su Railway).
3. Railway esegue `npm install` + `npm start` (`node server.js`).
4. Build + redeploy in ~2-3 minuti.
5. Servizio disponibile su:
   - `https://dashboard-cs-production.up.railway.app`
   - `https://myosseotouch.com` (custom domain, solo portale cliente)

### Configurazione Railway

- **Build / Start**: `npm install` + `npm start`.
- **Env vars**: `Railway → Dashboard CS → Variables` (vedi §5).
- **Database**: plugin Postgres separato, `DATABASE_URL` iniettata.
- **Custom domain**: `myosseotouch.com` (DNS gestito su Cloudflare).

### Inizializzazione database (comportamento attuale)

Al primo boot dopo un deploy, `initDB()` esegue:

- `CREATE EXTENSION IF NOT EXISTS pgcrypto`
- `CREATE TABLE IF NOT EXISTS ...` per le 50 tabelle
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` (migrazioni colonne)
- `CREATE INDEX IF NOT EXISTS ...`
- Seed iniziale per `webinar_youtube_watchtime` (3 righe)
- Migrazioni dati una-tantum protette da check di esistenza

**Cautela**: questa è la descrizione del comportamento attuale del codice.
Ogni modifica dello schema su database con dati di produzione richiede
**autorizzazione esplicita**, **review** della migrazione e **backup**
del database prima del push (vedi §11).

### Rollback

Railway mantiene lo storico dei deploy: `Deployments → Redeploy` su una
versione precedente. Lo schema Postgres **non** viene rollbackato dal
redeploy: eventuali colonne aggiunte da `ALTER ADD COLUMN IF NOT EXISTS`
rimangono. Per rollback di schema serve azione manuale autorizzata.

---

## 5. Configurazione — variabili d'ambiente

Tutte le variabili sono gestite da **Railway → Dashboard CS → Variables**.
Nessun valore va committato nel repo (`.env` è in `.gitignore`).

### Tier 1 — bloccanti

| Variabile | Uso |
|---|---|
| `DATABASE_URL` | Connection string PostgreSQL Railway. Senza, errore al primo query |
| `ADMIN_KEY` | Auth dashboard admin/Kim/Massimo. Senza, ogni endpoint admin restituisce 401 |

### Tier 2 — feature critiche (modulo OFF senza)

| Variabile | Modulo disabilitato senza |
|---|---|
| `MAILGUN_API_KEY` | Email transazionali (webinar, follow-up, proposte SUTURE) e mailing CRM |
| `ANTHROPIC_API_KEY` | 4 moduli AI di FREELANCER |
| `ZOOM_ACCOUNT_ID` + `ZOOM_CLIENT_ID` + `ZOOM_CLIENT_SECRET` | Sync recordings e partecipanti webinar |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Checkout shop B2B + verifica webhook pagamento |
| `ODOO_API_KEY` | Sync Odoo (suture stock, sales rep, opportunita', clienti) |
| `FREELANCER_TOKEN` | Pubblicazione job e fetch bid Freelancer.com |

### Tier 3 — operative con default ragionevoli

| Variabile | Note |
|---|---|
| `REPORTS_API_KEY` | Default = `ADMIN_KEY`. Da impostare distinta in produzione per separazione UI ↔ script |
| `MAILGUN_DOMAIN` / `MAILGUN_BASE_URL` / `MAILGUN_FROM` | Default Mailgun EU |
| `ODOO_URL` / `ODOO_DB` / `ODOO_USER` | Default OSSEOTOUCH |
| `SHOP_FRONTEND_URL` | Deve puntare a `https://www.osseotouch.com` in prod |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Alert admin **solo** per cancellazioni/revoche critiche (vedi §11). Senza, gli alert sono silenziati ma l'azione principale procede |
| `RELATORE_KEY` / `RELATORE_EMAIL` | Auth forum webinar. ⚠️ Vedi §11 |
| `PORT` | Default 3000. Railway inietta valore proprio |
| `NODE_ENV` | Imposta `production` su Railway |

### Variabili rimosse (Filone 3 — riduzione Telegram)

`TELEGRAM_CHAT_ID_KIM`, `TELEGRAM_CHAT_ID_RELATORE` e `OPENAI_API_KEY` sono state rimosse dal codice. Possono essere cancellate da Railway Variables in azione manuale separata.

---

## 6. Schema PostgreSQL

**Snapshot al 2026-04-26: 50 tabelle.** Schema gestito interamente da
`initDB()` in `server.js`. Self-contained, senza migration tool esterni
e senza file `.sql` separati. **Oggi** le modifiche allo schema avvengono
editando `initDB()` e ridistribuendo: il prossimo boot applica i diff.

### Mappa tabelle per modulo

| Modulo | # | Tabelle principali |
|---|---|---|
| Task CS | 1 | `tasks` |
| Report viewer | 2 | `reports`, `fatture` |
| CRM SalesForceFree | 18 | `crm_contatti` + 17 satellite |
| Webinar Zoom | 3 | `crm_webinar_registrazioni`, `crm_webinar_partecipanti`, `webinar_youtube_watchtime` |
| Forum Q&A webinar | 2 | `forum_topics`, `forum_replies` |
| JESFAG YouTube | 7 | `yt_videos`, `yt_metriche`, `yt_traffico`, `yt_geografia`, `yt_dispositivi`, `yt_retention`, `yt_canale_storico` |
| JESFAG Google Ads | 3 | `gads_campagne`, `gads_metriche_giornaliere`, `gads_keyword_metriche` |
| Suture acquisto VITREX | 3 | `suture_stock`, `suture_sync_meta`, `suture_ordini_clienti` |
| Suture vendita | 6 | `proposte`, `proposta_righe`, `proposta_eventi`, `portali_cliente`, `carrelli_draft`, `partner_sales_rep` |
| FREELANCER | 3 | `freelancer_jobs`, `freelancer_attachments`, `freelancer_approvals` |
| Calendly opportunita' | 1 | `opportunita` |
| Shop B2B | 2 | `shop_orders`, `shop_order_items` |

### Convenzioni

- Estensione richiesta: `pgcrypto` (`gen_random_uuid()` per
  `portali_cliente.token` e `carrelli_draft.token`).
- `crm_contatti.id` è `INTEGER` non `SERIAL`: assegnato da fonte esterna
  (sync SQLite/Excel MASTER da SalesForceFree).
- FK `ON DELETE CASCADE` per dati operativi (note, opportunita',
  prodotti, score). FK `ON DELETE SET NULL` per webinar/forum (preserva
  storicità). Nessuna FK su `crm_audit_log.contatto_id` (intenzionale).
- Token `portali_cliente` permanente; `carrelli_draft` con TTL 24h e
  flag one-time-use (`used_at`).
- Indici partial (`WHERE sincronizzata = false`, `WHERE used_at IS NULL`).
- JSONB usato per payload eterogenei (commenti task, dettagli audit,
  meta eventi proposte, items carrello, ecc.).
- BLOB nel DB (`*_base64`) per `fatture`, `freelancer_attachments`,
  `forum_topics`, `forum_replies` — vedi Appendice A (debito tecnico
  futuro).

### Cautela su modifiche schema in produzione

Ogni modifica dello schema su un database con dati di produzione richiede:

- **autorizzazione esplicita** dell'imprenditore prima della modifica;
- **review** della migrazione (vincoli FK, default su colonne nuove,
  impatto su query esistenti);
- **backup** del database via Railway prima del deploy;
- **verifica post-deploy** che `initDB()` abbia completato senza errori
  (log Railway).

### Documentazione di dettaglio per modulo

| Modulo | Doc autoritativa |
|---|---|
| CRM (18 tabelle, colonna per colonna) | `SalesForceFree/context_claude/CRM_DASHBOARD.md` |
| Suture vendita | `SUTURE/PIANO_FASE1.md` Blocco 1.1 |
| Suture acquisto VITREX | `cereda/context_claude/SUTURE.md` |

---

## 7. API endpoint

**Snapshot al 2026-04-26: 237 endpoint REST**, definiti inline in
`server.js`. Routing non modulare (no `express.Router()` separato), ma
le route sono raggruppate per prefisso.

### Mappa per prefisso/modulo

| Prefisso | # | Modulo |
|---|---|---|
| `/api/tasks/*` | 10 | Task CS |
| `/api/reports/*`, `/api/reports-antonia/*` | 13 | Report COLTRI + ANTONIA per agente |
| `/api/fatture/*` | 4 | Fatture aggregate |
| `/api/crm/*` | 47 | CRM SalesForceFree |
| `/api/webinar/*`, `/api/webinar-{tardani,boschini,arcara}/*` | 22 | Webinar Zoom |
| `/api/webinar/forum/*` | 7 | Forum Q&A webinar |
| `/api/leads/*`, `/api/whatsapp-group/*` | 2 | Lead WhatsApp group |
| `/api/download/*` | 1 | Download materiali (PDF appunti) |
| `/api/video-tracking*` | 4 | Tracking landing video ad |
| `/api/consent-stats` | 1 | Statistiche GDPR cookie |
| `/api/campagne/*`, `/api/attivita-mktg/*` | 8 | Campagne + attivita' marketing |
| `/api/mailing/*` | 3 | Mailing storico |
| `/api/youtube/*` | 8 | Sync YouTube (JESFAG) |
| `/api/google-ads/*` | 4 | Sync Google Ads (JESFAG) |
| `/api/suture/*` (acquisto) | 9 | Suture VITREX |
| `/api/proposte/*`, `/api/portali/*`, `/api/carrelli/*`, `/api/suture/*` (vendita) | 23 | SUTURE vendita |
| `/api/freelancer/*` | 18 | FREELANCER |
| `/api/calendly/webhook` | 1 | Webhook Calendly bookings |
| `/api/opportunita/*` | 4 | Opportunita' agenti |
| `/api/giacenze-strumenti/*` | 2 | Giacenze strumenti |
| `/api/shop/*` | 6 | Shop B2B |
| Pagine HTML (route GET) | ~29 | `/admin`, `/cs`, `/storico`, `/crm*`, `/report*`, `/webinar*`, `/portale/:token`, ecc. |

### Quattro livelli di autenticazione

| Livello | Sorgente | Usato da |
|---|---|---|
| `requireAdmin` | `x-admin-key` o `?key=` (= `ADMIN_KEY`) | UI dashboard admin/Kim/Massimo |
| `requireReportsKey` | `x-reports-key` (= `REPORTS_API_KEY`) | Script interni autorizzati |
| `requireForumAuth` | cookie `relatore_key` (= `RELATORE_KEY`) | Endpoint moderation forum webinar |
| Public token-gated | parametro `:token` UUID v4 | `/api/portali/:token`, `/api/carrelli/:token` |

### Documentazione di dettaglio dei contratti

| Famiglia | Doc autoritativa |
|---|---|
| `/api/crm/*` | `SalesForceFree/context_claude/CRM_DASHBOARD.md` |
| `/api/proposte/*`, `/api/portali/*`, `/api/carrelli/*`, `/api/suture/*` (vendita) | `SUTURE/context_claude/OPERATIVITA.md` §7 |
| `/api/suture/*` (acquisto VITREX) | `cereda/context_claude/SUTURE.md` |
| `/api/youtube/*`, `/api/google-ads/*`, `/api/mailing/*` | `JESFAG/CLAUDE.md` + tematici |
| `/api/freelancer/*` | `FREELANCER/CLAUDE_FREELANCER.md` |
| `/api/shop/*`, isole CORS JAN34 | `JAN34/context_claude/DASHBOARD_CS_NOTES.md` |
| `/api/webinar/*`, `/api/webinar/forum/*` | `JESFAG/context_claude/WEBINAR_TOOL.md` (verificare path) |

---

## 8. Frontend pubblico (`public/`)

Tutto il frontend è servito staticamente da Express. Niente bundler,
niente framework. **Snapshot al 2026-04-26: ~30 viste HTML + JS associati + CSS globale.**

### Mappa vista → modulo → route esplicita

| Vista | File | Modulo | Route esplicita |
|---|---|---|---|
| Hub admin | `admin.html` + `admin.js` | Imprenditore — accesso a tutti i moduli | `GET /admin` |
| Task CS | `cs.html` + `cs.js` | Customer Service task | `GET /cs` |
| Storico task | `storico.html` + `storico.js` | Task completati | `GET /storico` |
| CRM | `crm.html` + `crm.js` | CRM SalesForceFree | `GET /crm`, `/crm-liguria`, `/crm-piemonte` |
| Score CRM | `crm-score.html` + `crm-score.js` | Score per linea prodotto | `GET /crm-score` |
| Dashboard Kim | `dashboard-kim.html` + `dashboard-agente.js` | Vista commerciale Kim | static `?key=` |
| Dashboard Massimo | `dashboard-massimo.html` + `dashboard-agente.js` | Vista commerciale Massimo | static `?key=` |
| Report viewer | `report*.html` + `.js` | Visualizzazione report COLTRI/ANTONIA | `GET /report`, `/report-ordini`, `/report-trend`, `/report-finanza` (no route per `/report-progressivo` — solo static) |
| SUTURE rep composer | `suture-rep.html` + `suture-agente.js` | Composer proposte (Kim/Massimo/admin) | static `?key=&from=` |
| Giacenze strumenti | `giacenza-str.html` + `giacenza-str.js` | Inventory kit produzione | static |
| Pianificazione mktg | `pianificazione-mktg.html` | UI campagne + attivita' marketing | static (nessuna route esplicita) |
| Webinar landing (×9) | `webinar*.html` | Landing pubbliche webinar | parziali (vedi §7) |
| Landing prodotto/evento | `magnetic-mallet.html`, `cadaver-lab-verona.html`, `privacy-policy.html` | Marketing legacy | `GET /magnetic-mallet`, `/cadaver-lab-verona`, `/privacy-policy` |

### Modulo SENZA UI dedicata in `public/`

**FREELANCER**, **Shop B2B admin** e **JESFAG (Google Ads / YouTube /
Mailing storico)** non hanno una pagina dedicata in `public/`. Quando
presenti, le UI sono integrate in `admin.html` o in viste collegate;
verificare in `admin.js` per le sezioni dedicate.

Il **portale cliente SUTURE** (`/portale/:token`) non è in `public/`:
è renderizzato server-side da `scripts/suture/portal_renderer.js`.

### Asset folders

- `public/img/` — ~50 asset (logo, hero, kit, KOL portraits, video MP4, audio MP3 webinar)
- `public/docs/` — locandine PDF
- `public/downloads/` — appunti webinar PDF (Arcara, Tardani), serviti da `GET /api/download/:slug`

### CSS

`style.css` (~64 KB) — foglio di stile globale, niente preprocessing.

### Nota su duplicazioni con JAN34

`magnetic-mallet.html`, `cadaver-lab-verona.html`, `privacy-policy.html`
coesistono con equivalenti su `osseotouch.com`. Da chiarire la versione
canonica nella prossima azione di pulizia (vedi Appendice A).

---

## 9. Moduli backend (`scripts/`)

I moduli secondari sono in `DASHBOARD CS/scripts/`. Caricati via
`require()` da `server.js`, ricevono dal chiamante la pool PostgreSQL e
le API key necessarie come parametri (i moduli non leggono mai
`process.env` direttamente).

### FREELANCER (`scripts/`)

Cinque moduli per il ciclo di vita dei progetti su Freelancer.com:

| File | Funzione | API esterne |
|---|---|---|
| `job_composer.js` | Genera bozza testo + skills da brief imprenditore | Anthropic SDK |
| `talent_scout.js` | Scoring bid ricevuti, ranking candidati | Anthropic SDK + Freelancer.com |
| `negotiator.js` | Bozze risposte/contro-offerte | Anthropic SDK |
| `delivery_manager.js` | Tracking deliverable, segnali di anomalia | Anthropic SDK + Freelancer.com |
| `cost_tracker.js` | Costo finale vs budget, alert | Anthropic SDK |

Chiamati dagli endpoint `/api/freelancer/ai/*` con approvazione umana
intermedia (tabella `freelancer_approvals`).

> Logica completa: `FREELANCER/CLAUDE_FREELANCER.md` + `FREELANCER/PIANO_IMPLEMENTAZIONE.md`.

### SUTURE vendita (`scripts/suture/`)

Cinque moduli — di cui **3 implementati e 2 stub**:

| File | Stato | Funzione |
|---|---|---|
| `target_finder.js` | Implementato (Dashboard v2) | Selezione clienti SUTURE per rep: clienti attivi 2026 da Odoo `x_studio_agente` (priorità 1), clienti dormienti via regione CRM (priorità 2). La cache `partner_sales_rep` alimentata da Excel `analisi_vendite/` resta come **legacy/fallback** |
| `proposal_builder.js` | Implementato | Costruzione corpo proposta (prodotti, sconto, omaggio 3+1, cadenza) |
| `portal_renderer.js` | Implementato | Rendering server-side del portale cliente (`/portale/:token` host-gated `myosseotouch.com`) |
| `scheduler.js` | **Stub Fase 2 — non live** | Cron giornaliero per rigenerazione proposte automatiche basata su `cadenza_gg` e `rimandata_al`. Funzione `runDailyScheduler` lancia `Error('TODO: implementare in Fase 2')` |
| `reporting.js` | **Stub Fase 3 — non live** | Metriche aggregate per il tab "Proposte" admin (tasso conversione, valore generato, clienti inattivi). Funzione `getAdminMetrics` lancia `Error('TODO: implementare in Fase 3')` |

> Logica completa: `SUTURE/PIANO_FASE1.md` + `SUTURE/BRIEF_IMPLEMENTAZIONE.md` + `SUTURE/context_claude/OPERATIVITA.md`.

### Cosa NON c'è in `scripts/`

CRM, webinar/forum, JESFAG, shop sono **inline** in `server.js`. Pattern
attuale: `scripts/` ospita solo i moduli che richiedono isolamento per
complessità AI (FREELANCER) o per ciclo di vita asincrono / rendering
server-side (SUTURE).

---

## 10. Templates email & automazione operativa

### Templates Mailgun (`templates/`)

Sei template HTML per email transazionali webinar:

| File | Uso |
|---|---|
| `WEBINAR_INVITO.html` | Invito alla registrazione |
| `WEBINAR_CONFERMA.html` | Conferma post-registrazione (link Zoom) |
| `WEBINAR_REMINDER.html` | Reminder pre-evento |
| `WEBINAR_FOLLOWUP.html` | Follow-up post-webinar |
| `WEBINAR_REPLAY_ACCESSO.html` | Accesso replay generico |
| `WEBINAR_REPLAY_ACCESSO_TARDANI.html` | Accesso replay specifico per webinar Tardani |

Convenzione: `MAIUSCOLO_SNAKE_CASE.html`. Niente template engine: il
codice esegue raw string-replace dei placeholder. Template per altri
moduli (proposte SUTURE, mailing CRM, ricevute Stripe) sono inline in
`server.js` o nei moduli di `scripts/`.

### Automazione Windows — `sync_daily.bat`

Pipeline daily eseguita da Windows Task Scheduler sulla macchina locale
dell'imprenditore (non gira su Railway):

1. Lancia `OSSEOTOUCH AI/cereda/sync_giacenze_strumenti.py`
2. Aggiorna `data/giacenze_strumenti.json`
3. `git add` + `git commit` + `git push` sul branch `main`
4. Railway rileva il push e ridistribuisce automaticamente

Output log: `sync_daily.log` (appended).

### `data/`

Tre file JSON operativi, **nessun secret**:

| File | Contenuto | Aggiornamento |
|---|---|---|
| `comuni_regioni.json` | Lookup comuni italiani → regione (matching CRM) | Statico |
| `sales_rep_regions.json` | Config Kim/Massimo/admin: nome, email, regioni, alias | Manuale |
| `giacenze_strumenti.json` | Snapshot kit produzione | Daily via `sync_daily.bat` |

---

## 11. Sicurezza, rotazione chiavi, gap noti

### Quattro livelli di auth (richiamo §7)

`requireAdmin`, `requireReportsKey`, `requireForumAuth`, public token-gated.

### Rotazione `ADMIN_KEY` — procedura sicura

Senza scrivere mai la chiave in chat o in commit:

1. Generare un valore casuale **fuori dalla chat** (es. password manager,
   browser DevTools console, generatore offline).
2. Salvare il nuovo valore in `Railway → Dashboard CS → Variables → ADMIN_KEY`.
3. Railway ridistribuisce in 2-3 minuti; la vecchia chiave smette di funzionare.
4. Aggiornare i bookmark di admin / Kim / Massimo.
5. Comunicare la nuova chiave via canale sicuro (SMS, WhatsApp diretto,
   password manager condiviso). Mai email con tracking.

Stessa procedura applicabile ai secret di Tier 2 (Mailgun, Stripe, Zoom,
Anthropic, Freelancer, Odoo).

### Cautela su modifiche schema in produzione

Vedi §6: ogni modifica dello schema su database con dati di produzione
richiede autorizzazione esplicita, review, backup, verifica post-deploy.

### Telegram — riduzione ad alert cancellazioni (Filone 3)

Telegram è stato ridotto a un solo uso: **alert al canale admin per cancellazioni/revoche critiche**. Sono stati rimossi:

- Bot interattivo (polling, creazione task da testo, trascrizione vocali via OpenAI Whisper).
- Notifiche task completion, report ready (Kim + tutti), forum (admin + relatore + reply), Calendly opportunità (era un bug latente).
- Allarme suture sync error (sostituito da `console.error`).
- Helper `sendTelegramNotification`, `sendTelegramReply`, `startTelegramPolling`, `handleTelegramMessage`, `handleVoiceMessage`, `transcribeAndCreateTask`.
- Variabili `TELEGRAM_CHAT_ID_KIM`, `TELEGRAM_CHAT_ID_RELATORE`, `OPENAI_API_KEY`.
- Tutti i fallback hardcoded di `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`.

Resta una sola helper, `sendTelegramDeletionAlert(text)`, che invia al canale admin solo per eventi di cancellazione/revoca:
- Threshold CRM cestino (>5 cancellazioni in 10 min) — da `logAndTrash`.
- `DELETE /api/proposte/:id` (SUTURE).
- `POST /api/portali/:token/revoca` e `POST /api/suture/portale-cliente/:cliente_id/revoca`.
- `DELETE /api/shop/orders/:id`.
- `DELETE /api/fatture/:id`.

Se `TELEGRAM_BOT_TOKEN` o `TELEGRAM_CHAT_ID` non sono configurati, l'alert è silenziato e l'azione principale procede normalmente.

### Gap di sicurezza noti — da risolvere

| Gap | Riga | Severità |
|---|---|---|
| Fallback hardcoded di `RELATORE_KEY` (auth forum) | `server.js:25` | 🟡 Media — chiave debole come default |
| `/api/calendly/webhook` accetta payload senza verifica firma | `server.js` (Calendly webhook) | 🟡 Media |
| `ANTHROPIC_API_KEY` controllata lazy (4 check separati nei moduli FREELANCER, nessun fail-fast al boot) | `server.js` (FREELANCER AI handlers) | 🟢 Bassa — degrado funzionale |
| SSL detection su `DATABASE_URL.includes('localhost')` (heuristic fragile) | `server.js` (pool init) | 🟢 Bassa |

**Gap chiusi nel Filone 3** (2026-04-27):
- ✅ Fallback hardcoded `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_CHAT_ID_KIM` rimossi.
- ✅ `analisi_bozza.js` e i 10 script diagnostici legacy sanitizzati (Filone D.1 + D.1-bis).

### Quanto è OK

- ✅ `/api/shop/stripe-webhook` verifica firma via `STRIPE_WEBHOOK_SECRET`.
- ✅ Token `portali_cliente` permanenti UUID v4 generati con `pgcrypto`.
- ✅ Token `carrelli_draft` con TTL 24h e flag one-time-use.
- ✅ FK `ON DELETE SET NULL` su tabelle webinar/forum per preservare audit dopo cancellazione contatto.

---

## 12. Sviluppo locale & troubleshooting

### Quick start dev locale

Il repo non richiede Postgres locale.

1. Modifiche al codice in `DASHBOARD CS/`.
2. Anteprima HTML statici (admin, dashboard agenti, suture-rep, webinar)
   con `node _static_preview.js` → http://localhost:3000.
3. Per il backend completo: Railway è l'ambiente reale. Test diretti
   contro `dashboard-cs-production.up.railway.app` o contro un servizio
   Railway di staging (se predisposto).

### Script npm (`package.json`)

- `npm start` → `node server.js`
- `npm run dev` → `node server.js` (alias di start)

Niente test suite, niente lint, niente bundling.

### Troubleshooting comune

| Sintomo | Causa | Verifica / fix |
|---|---|---|
| 401 su UI | `ADMIN_KEY` cambiata, bookmark obsoleto | Aggiornare bookmark con nuova chiave |
| 502/503 dopo deploy | Errore in `initDB()` o crash al boot | Log Railway → stack trace |
| Cliente non visibile in dashboard SUTURE | Sync SalesForceFree → CRM non aggiornato, oppure `x_studio_agente` mancante in Odoo | Verificare `crm_contatti`, controllare ultimo sync |
| Portale cliente 404 | Token revocato (`portali_cliente.attivo = false`) o token inesistente | Da admin: rigenerare portale |
| Stripe webhook 400 | Firma non valida o `STRIPE_WEBHOOK_SECRET` cambiato | Stripe Dashboard + Railway Variables |
| Email non arrivate | Mailgun bounce / suspended / chiave scaduta | Mailgun Dashboard EU → Logs |
| Carrello "scaduto" su shop | Token `carrelli_draft.expires_at` superato (TTL 24h) | Cliente torna al portale e rifà "Conferma e procedi" |

Per troubleshooting per modulo riferirsi alla doc autoritativa di
ciascun agente (Appendice B).

---

## Appendice A. Pulizia legacy — stato post-Filone 4

La pulizia dei file legacy della root è stata eseguita il 2026-04-27
(Filone 4). Stato corrente:

### File rimossi dal repo

| Elemento | Esito |
|---|---|
| `database.json` | ✅ **Cancellato** (storage JSON pre-PostgreSQL) |
| `INV_2026_00072.pdf` | ✅ **Cancellato** (fattura PDF spuria) |
| `temp_audit_video_tracking.js` | ✅ **Cancellato** (audit one-shot) |
| `temp_count_arcara.js` | ✅ **Cancellato** (count one-shot) |

### Script diagnostici archiviati

I 16 script diagnostici one-shot di marzo-aprile 2026 sono stati spostati
in `_archive/`:

| Cartella | # script | Contenuto |
|---|---|---|
| `_archive/diagnostica_suture/` | 8 | `analisi_bozza.js`, `lista_ordini_completa.js`, `lista_ordini_suture.js`, `verifica_copertura_ordini.js`, `verifica_copertura_senza_bozza.js`, `verifica_po_vitrex.js`, `verifica_s00343.js`, `test_verifica_copertura.js` |
| `_archive/diagnostica_webinar/` | 8 | `check_arcara_bug.py`, `check_arcara_bug_api.py`, `check_arcara_bug_full.py`, `check_galizia_api.py`, `check_galizia_video.js`, `verifica_malavasi_fix.py`, `cleanup_arcara_test.js`, `cleanup_arcara_test.sql` |

`_archive/README.md` documenta le caratteristiche e le regole d'uso dei
file archiviati. **Nessuno è runtime**, nessuno è importato da `server.js`.

### Debiti tecnici futuri (non urgenti)

| Tema | Descrizione | Direzione futura |
|---|---|---|
| BLOB nel DB | `fatture.pdf_base64`, `freelancer_attachments.file_base64`, `forum_topics.immagine_base64`, `forum_replies.immagine_base64` crescono nel tempo | Quando il volume diventa rilevante: valutare migrazione a Cloudflare R2 |
| Template duplication | `WEBINAR_REPLAY_ACCESSO_TARDANI.html` è copia personalizzata del generico | Quando un terzo webinar richiederà il proprio template: introdurre placeholder + parametrizzazione, oppure template engine minimale |
| Viste duplicate con JAN34 | `magnetic-mallet.html`, `cadaver-lab-verona.html`, `privacy-policy.html` coesistono con equivalenti su `osseotouch.com` | Decidere la versione canonica e impostare redirect |
| Schema DB inline in `server.js` | `initDB()` cresce a ogni nuova tabella; nessun migration tool | Estrazione a file dedicato e/o introduzione tool tipo Knex/Prisma migrate quando il dolore lo giustifica |

---

## Appendice B. Riferimenti documentazione OSSEOTOUCH AI

Il README della Dashboard CS rimanda esplicitamente alla doc di ogni
agente per la business logic specifica. Gli agenti vivono in
`OSSEOTOUCH AI/` (cartella separata, non parte di questo repo).

**Overview ecosistema:**
- `OSSEOTOUCH AI/CLAUDE.md` — mappa generale
- `OSSEOTOUCH AI/COLTRI/CLAUDE.md` — orchestratore + comandi
- `OSSEOTOUCH AI/COLTRI/context_claude/CONTESTO_COLTRI.md`

**CRM (SalesForceFree):**
- `SalesForceFree/context_claude/INDICE.md`
- `SalesForceFree/context_claude/CRM_DASHBOARD.md` — schema + endpoint CRM dettagliati
- `SalesForceFree/context_claude/REGOLE.md` — FONTI_PROTETTE, R1/R2/R3, score, GDPR
- `SalesForceFree/skills/mailing-campagne.md`

**Sito web (JAN34):**
- `JAN34/CLAUDE.md`
- `JAN34/context_claude/DASHBOARD_CS_NOTES.md` — isole CORS lato JAN34
- `JAN34/context_claude/LANDING_PAGE_CHECKLIST.md`

**Marketing (JESFAG):**
- `JESFAG/CLAUDE.md`
- `JESFAG/context_claude/INDICE.md`

**Suture:**
- `SUTURE/CLAUDE.md` — agente lato vendita (hub)
- `SUTURE/PIANO_FASE1.md` — piano operativo Fase 1 MVP
- `SUTURE/BRIEF_IMPLEMENTAZIONE.md`
- `SUTURE/context_claude/OPERATIVITA.md`
- `OSSEOTOUCH AI/cereda/context_claude/SUTURE.md` — suture lato acquisto VITREX

**Recruiting freelance:**
- `FREELANCER/CLAUDE_FREELANCER.md`
- `FREELANCER/PIANO_IMPLEMENTAZIONE.md`

**Recupero crediti / report agenti:**
- `ANTONIA/context_claude/*`
