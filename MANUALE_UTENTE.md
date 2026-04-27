# Dashboard CS — Manuale utente

**Versione:** 2.0 · **Ultimo aggiornamento:** 2026-04-27
**Repo:** `claydegi/dashboard-cs` · **Hosting:** Railway

Manuale operativo per l'uso quotidiano della Dashboard CS. Risponde alla
domanda "**come faccio a…?**". Per come è fatta tecnicamente la
Dashboard CS riferirsi a `README.md` (questo stesso repo).

Audience:
- **Imprenditore** — vista admin, gestione di tutti i moduli
- **Kim e Massimo** — agenti commerciali, dashboard dedicate
- **Customer Service** — gestione task condivisi
- **Cliente finale** — accede solo al portale `myosseotouch.com/portale/<token>` (senza chiave); non ha bisogno di manuale

---

## 1. URL e accessi

| Vista | URL |
|---|---|
| Hub admin | `https://dashboard-cs-production.up.railway.app/admin?key=<ADMIN_KEY>` |
| Customer Service | `https://dashboard-cs-production.up.railway.app/cs` |
| Storico task | `https://dashboard-cs-production.up.railway.app/storico?key=<ADMIN_KEY>` |
| Dashboard Kim | `https://dashboard-cs-production.up.railway.app/dashboard-kim.html?key=<ADMIN_KEY>` |
| Dashboard Massimo | `https://dashboard-cs-production.up.railway.app/dashboard-massimo.html?key=<ADMIN_KEY>` |
| SUTURE rep (composer proposte) | `https://dashboard-cs-production.up.railway.app/suture-rep.html?key=<ADMIN_KEY>&from=kim` (o `from=massimo` / `from=admin`) |
| CRM | `https://dashboard-cs-production.up.railway.app/crm?key=<ADMIN_KEY>` |
| Pianificazione marketing | `https://dashboard-cs-production.up.railway.app/pianificazione-mktg.html?key=<ADMIN_KEY>` |
| Portale cliente SUTURE | `https://myosseotouch.com/portale/<token>` (link inviato al cliente) |

### Come usare la chiave admin nei bookmark

1. Sostituisci `<ADMIN_KEY>` con il valore corrente fornito dall'imprenditore.
2. Salva l'URL completo come bookmark del browser.
3. **Non condividere mai** la chiave via email o chat con tracking. Usa SMS, WhatsApp diretto o un password manager condiviso.
4. Se la chiave non funziona più, è stata ruotata: chiedi la nuova all'imprenditore.

---

## 2. Regole d'oro (cosa NON fare mai)

Queste regole valgono per chiunque acceda alla Dashboard CS.

1. **Chiavi e secret mai in email.** Mai inviare `ADMIN_KEY`, password Mailgun/Stripe/Zoom/Odoo, token Telegram via canali con tracking.
2. **Nessuna modifica ai dati di produzione senza autorizzazione esplicita** dell'imprenditore. Vale per CRM, ordini shop, proposte SUTURE, task CS, fatture aggregate.
3. **Cancellazione contatti CRM**: passa sempre dal cestino (soft-delete), mai dirette. Per merge di doppioni (account o lead) usa solo il workflow autorizzato `crm-merge-doppioni` documentato in `OSSEOTOUCH AI/CLAUDE.md`.
4. **Score CRM**: gli score sono aggregati automaticamente dagli eventi (mailing, video, webinar, acquisti). **Non modificare lo score a mano** se non per correzione esplicita autorizzata.
5. **Mailing CRM**: prima di inviare una campagna, segui il workflow 7 fasi descritto in `SalesForceFree/skills/mailing-campagne.md`. Nessun invio senza dry-run.
6. **Modifiche al codice / push su `main`**: solo l'imprenditore o sessione autorizzata. Ogni push triggera redeploy Railway in produzione.
7. **Rotazione chiavi**: solo dall'imprenditore o con il suo OK esplicito. Procedura in §4.5.
8. **Mai cancellare file legacy** dalla cartella `DASHBOARD CS/` senza autorizzazione esplicita, anche se sembrano vecchi (vedi `README.md` Appendice A).

---

## 3. Cosa fare quotidianamente (per ruolo)

### 3.1 Imprenditore (admin)

#### Hub admin: panoramica

Apri l'URL admin. Trovi le card principali:
- **Task CS** — task aperti / in lavorazione / completati
- **CRM** — contatti, score, opportunita', cestino
- **SUTURE** — proposte aperte, conferme manuali
- **Shop B2B** — ordini in arrivo (online), a stato pending/confirmed/spedito
- **FREELANCER** — progetti aperti, approvazioni pendenti
- **Webinar** — registrazioni, partecipanti, follow-up
- **Report** — viewer report COLTRI/ANTONIA

#### Consultare un report COLTRI / ANTONIA

I report sono pubblicati automaticamente sulla Dashboard CS dopo
l'esecuzione dei rispettivi agenti (COLTRI per report finanziari,
vendite, trend, progressivo; ANTONIA per crediti, attenzionare,
vendite per agente). L'imprenditore rilancia il report da
COLTRI/ANTONIA secondo i comandi documentati nell'agente.

1. Apri `/admin?key=<ADMIN_KEY>` → card **Report**.
2. Cerca per data o tipo (vendite ordini, vendite trend, vendite progressivo, finanza, crediti Kim/Massimo, attenzionare Kim/Massimo).
3. Clicca per aprire il report HTML inline.
4. Per i report agente: dalla dashboard Kim/Massimo le card linkano direttamente al rispettivo report.

#### Gestire un ordine shop B2B

1. Verifica gli ordini dal tab **Shop** della Dashboard e dalle notifiche configurate (Telegram, eventuali email).
2. Da hub admin → card **Shop**: vedi lista ordini con status (`pending`, `paid`, `confirmed`, `shipped`, `cancelled`).
3. Clicca un ordine per vedere dettagli buyer, items, indirizzo spedizione, pagamento Stripe (se applicabile).
4. Aggiorna status o annulla con motivazione.
5. Per generare la fattura: gestione manuale tramite Odoo (la Dashboard CS non emette fatture).

#### Inviare un mailing / campagna

Workflow completo in `OSSEOTOUCH AI/SalesForceFree/skills/mailing-campagne.md`. Sintesi:

1. Definisci target (regione, prodotto, score, esclusioni) tramite COLTRI.
2. Verifica numero destinatari + check FONTI_PROTETTE.
3. Prepara template HTML in `templates/` (Mailgun) o usa template inline esistente.
4. Test su email interna prima dell'invio reale.
5. Verifica saldo Mailgun.
6. Invio.
7. Post-invio: consulta lo **storico mailing** nella Dashboard/CRM per tracking aperture/click.

**Niente invio senza dry-run.** Vedi `SalesForceFree/context_claude/REGOLE.md`.

#### Aprire/seguire un progetto FREELANCER

Workflow completo in `OSSEOTOUCH AI/FREELANCER/CLAUDE_FREELANCER.md`. Sintesi:

1. Da hub admin → tab **Freelancer** → "Nuovo progetto".
2. Inserisci titolo, descrizione, budget, allegati.
3. Modulo **Job Composer** genera bozza testo + skills → richiede tua approvazione.
4. Pubblicazione su Freelancer.com → bid in arrivo.
5. Modulo **Talent Scout** scoring candidati → richiede approvazione assegnazione.
6. **Delivery Manager** traccia consegne, **Cost Tracker** confronta budget vs costo finale.

Ogni passaggio critico richiede la tua approvazione esplicita registrata nella Dashboard.

### 3.2 Kim e Massimo

#### Aprire la dashboard agente

Apri il bookmark con la tua URL personale (`/dashboard-kim.html?key=<ADMIN_KEY>` o `/dashboard-massimo.html?key=<ADMIN_KEY>`).

Vedi card:
- **Vendite progressivo** — link al report ANTONIA del tuo progressivo
- **Crediti** — link al report ANTONIA dei tuoi crediti aperti
- **Attenzionare** — link ai casi da seguire (BCC, crediti critici)
- **SUTURE** — la tua lista clienti suture e le tue proposte aperte

#### Card SUTURE: clienti attivi, dormienti, proposte

La card SUTURE mostra:
1. **Clienti attivi 2026** — chi ha comprato suture quest'anno (priorità 1, da Odoo `x_studio_agente`).
2. **Clienti dormienti** — clienti della tua regione (Liguria/Piemonte/Campania/Lazio/Valle d'Aosta/Emilia-Romagna per Kim; Lombardia per Massimo) senza acquisti recenti.
3. **Proposte aperte** — pending, rimandate, in attesa di conferma.

Per ogni cliente puoi:
- **Apri portale** — vedi cosa vede il cliente
- **Nuova proposta** — apri il composer

Per dettagli sulla cascade di assegnazione (Odoo → Excel → CRM regione) vedi `OSSEOTOUCH AI/SUTURE/context_claude/OPERATIVITA.md`.

#### Creare una nuova proposta SUTURE

1. Nella card SUTURE → click **Nuova proposta** sul cliente.
2. Si apre il composer (`suture-rep.html?from=kim` o `from=massimo`).
3. Compila:
   - Prodotti suture (catalogo VITREX)
   - Sconto percentuale
   - Omaggio "3+1" sì/no
   - Cadenza riacquisto (default 60 giorni)
   - Modalità (automatica / manuale)
   - Mittente email
   - Messaggio personale
4. Click **Salva e genera link**.
5. Si apre modal "Link generato" con 3 azioni:
   - **Copia link** — incolla dove serve
   - **Invia email** — Mailgun manda al cliente
   - **WhatsApp** — apre WhatsApp con messaggio precompilato (solo se cellulare configurato per il rep)

Il cliente apre il link, vede il portale (suo nome, proposta, storico acquisti, referente, catalogo) e sceglie:
- **Scrivi a rep** → WhatsApp diretto
- **Non ora, ricordamelo** → la proposta torna al rep tra 30 giorni
- **Conferma e procedi** → carrello generato + redirect a checkout shop

#### Card Crediti / Vendite / Attenzionare

I report sono prodotti da ANTONIA e pubblicati sulla Dashboard CS dall'imprenditore.

- **Crediti**: scadenze e importi dei tuoi clienti.
- **Vendite progressivo**: trend vendite cumulativo dal 12 gennaio 2026 a oggi.
- **Attenzionare**: BCC in sospeso da fatturare + crediti critici.

Se un report è vecchio o mancante, segnalalo all'imprenditore: lui rilancia il comando ANTONIA.

### 3.3 Customer Service

#### Aprire la pagina /cs

Apri `https://dashboard-cs-production.up.railway.app/cs` (senza chiave). Vedi solo i task di tipo `cs`.

#### Lavorare un task

1. Click su un task aperto → leggi descrizione.
2. **Cambia stato** in "in_lavorazione" mentre stai lavorando.
3. Aggiungi commenti durante la lavorazione (notificano l'admin).
4. Quando finito → **Completa task** con data/ora/operatore.

I task privati admin-admin non sono visibili in `/cs`.

#### Telegram bot @Ossetouch_cs_bot

- Riceve **notifica di completamento** quando un task viene marcato completato.
- Permette di **creare task inviando messaggi di testo** al bot.

La gestione dei vocali Telegram non è documentata come funzione operativa corrente: verificarla prima di usarla.

---

## 4. Operazioni ricorrenti (settimanali / mensili / on demand)

### 4.1 Sync giornaliero giacenze strumenti

Pipeline `sync_daily.bat` su Windows Task Scheduler della macchina locale dell'imprenditore. Si esegue automaticamente.

Output: `data/giacenze_strumenti.json` aggiornato + commit + push su `main` → Railway redeploy.

Log: `sync_daily.log` (appended). Se il log mostra errori per più giorni di seguito, segnalare all'imprenditore.

### 4.2 Sync CRM locale pianificato

Sync CRM locale pianificato: gestito dall'imprenditore tramite l'agent
SalesForceFree. Se i dati CRM risultano disallineati (contatti
mancanti, score non aggiornato, modifiche non riflesse), verificare
la documentazione SalesForceFree (`OSSEOTOUCH AI/SalesForceFree/context_claude/`)
e segnalare all'imprenditore.

### 4.3 Aggregazione fatture mensili Kim/Massimo

ANTONIA aggrega le fatture PDF di Kim e Massimo in PDF mensili
consolidati. Output: cartella `ANTONIA/reports/fatture kim e massimo/`
con `Fatture_KIM_<mese>_<anno>.pdf` e analogo per Massimo.
L'imprenditore lancia l'aggregazione secondo i comandi documentati
nell'agente ANTONIA.

### 4.4 Audit periodico Google Search Console

Ogni 10 giorni: audit indexing pagine Astro live + performance + top query. L'imprenditore lancia da Claude (script Python con credenziali GSC).

### 4.5 Rotazione `ADMIN_KEY`

Procedura sicura completa in `README.md` §11:

1. Genera valore casuale **fuori dalla chat** (password manager).
2. Salva su `Railway → Dashboard CS → Variables → ADMIN_KEY`.
3. Aspetta 2-3 minuti per redeploy.
4. Aggiorna i bookmark di admin / Kim / Massimo.
5. Comunica nuova chiave via canale sicuro (mai email).

Stessa procedura per `MAILGUN_API_KEY`, `STRIPE_SECRET_KEY`, `ZOOM_*`, `ANTHROPIC_API_KEY`, `FREELANCER_TOKEN`, `ODOO_API_KEY`.

---

## 5. Quando qualcosa non funziona

### 5.1 Imprenditore

| Sintomo | Verifica / fix |
|---|---|
| 401 "Accesso non autorizzato" | `ADMIN_KEY` cambiata su Railway. Aggiorna il bookmark con la nuova chiave |
| 502 / 503 dopo deploy | Apri Railway → Logs e cerca lo stack trace di `initDB()` |
| Report COLTRI non arrivato in dashboard | Rilancia il comando da COLTRI; verifica che `REPORTS_API_KEY` sia configurata |
| Email Mailgun non arrivata | Mailgun Dashboard EU → Logs (bounce, suspended, rate limit) |
| Stripe webhook 400 ripetuto | Rigenera `STRIPE_WEBHOOK_SECRET` su Stripe e aggiornalo su Railway |
| Mailing inviato ma destinatari sbagliati | Verifica filtri target prima dell'invio successivo (regola FONTI_PROTETTE) |

### 5.2 Kim e Massimo

| Sintomo | Verifica / fix |
|---|---|
| Dashboard vuota | `ADMIN_KEY` errata o scaduta. Chiedi all'imprenditore la chiave corrente |
| Cliente non in lista SUTURE | Il cliente potrebbe non aver mai acquistato suture, oppure l'agente di riferimento non è impostato sul lato Odoo. Segnala all'imprenditore |
| Portale cliente dà 404 | Token revocato o inesistente. Crea una nuova proposta dalla dashboard: il portale viene rigenerato |
| Cliente dice "ho cliccato Conferma" ma non vedo niente | Verifica lo stato della proposta nel CRM cliente: se non risulta confermata, il carrello potrebbe essere scaduto (validità 24 ore). Chiedi al cliente di riaprire il portale e ripetere "Conferma e procedi" |
| WhatsApp non parte da portale cliente | Il cellulare del rep non risulta configurato. Segnala all'imprenditore di controllare la configurazione del referente commerciale |

### 5.3 Customer Service

| Sintomo | Verifica / fix |
|---|---|
| Task non visibile in `/cs` | È un task privato admin-admin (non di tipo `cs`). Niente da fare |
| Telegram silente per task completato | Bot down o token scaduto. Segnala all'imprenditore |
| Comando vocale non risponde al bot | La gestione dei vocali Telegram non è documentata come funzione operativa corrente: verificarla prima di usarla |

Per troubleshooting di moduli specifici riferirsi alla doc autoritativa di ciascun agente (vedi §7).

---

## 6. Glossario operativo

- **ADMIN_KEY** — Chiave segreta per accedere alle viste admin/Kim/Massimo. Vive su Railway Variables. Mai in email.
- **CRM** — Database contatti SalesForceFree (5000+). Vive in Postgres Dashboard CS, sincronizzato con SQLite locale e Odoo.
- **Score CRM** — Punteggio aggregato per linea prodotto (es. ELEVATE, BLEXO, PT-1, SUTURE). Soglia "hot": ≥40. Aggiornato da eventi (mailing, video, webinar, acquisti).
- **FONTI_PROTETTE** — 5 sorgenti di dati CRM la cui modifica richiede protezioni speciali (`dashboard_manual`, `dashboard_promozione`, `regola_R2_dashboard`, `finder_email_whatsapp`, `migrazione_fatture_preodoo`). Vedi `SalesForceFree/context_claude/REGOLE.md`.
- **R2 (regola)** — Regola che vincola alcune linee prodotto (ELEVATE, BLACK RUBY, LC, FIRST, EASY IN, EASY PIN, GENOA, BLEXO, GUIDATA, PT1) ad avere la macchina MM associata.
- **SUTURE vendita ≠ SUTURE acquisto** — *Vendita*: proposte ai clienti (questo manuale). *Acquisto*: ordini PO verso VITREX MEDICAL A/S, gestiti dal modulo "Controllo Suture" della Dashboard CS.
- **Proposta** — Offerta SUTURE creata dal rep per uno specifico cliente.
- **Portale** — Pagina cliente su `myosseotouch.com/portale/<token>`. Token permanente per cliente.
- **Carrello (draft)** — Carrello generato quando il cliente clicca "Conferma e procedi". Validità 24 ore, utilizzabile una sola volta.
- **Webinar tag** — Identificativo univoco del webinar (es. `WEBINAR_MALAVASI_PT1`). Convenzione Mailgun e tracking.
- **Mailgun** — Provider email transazionale (account EU per OSSEOTOUCH).
- **Stripe** — Provider pagamenti per shop B2B.
- **Calendly** — Booking tool integrato (webhook → tabella `opportunita`).
- **Zoom** — Hosting webinar (sync recordings + partecipanti via OAuth).
- **Fase 1/2/3 SUTURE** — *Fase 1*: MVP live (proposte manuali + portale). *Fase 2*: scheduler automatico (stub, non live). *Fase 3*: reporting admin (stub, non live).

---

## 7. Dove trovare cosa (link rapidi)

### Documentazione tecnica

- `README.md` — mappa tecnica della Dashboard CS (questo repo): architettura, schema DB, endpoint, env vars, gap noti
- `OSSEOTOUCH AI/CLAUDE.md` — overview ecosistema multi-agente
- `OSSEOTOUCH AI/COLTRI/CLAUDE.md` — orchestratore + comandi imprenditore

### Documentazione per agente

- **CRM**: `OSSEOTOUCH AI/SalesForceFree/context_claude/INDICE.md` + `REGOLE.md` + `CRM_DASHBOARD.md`
- **Mailing**: `OSSEOTOUCH AI/SalesForceFree/skills/mailing-campagne.md`
- **Sito web (JAN34)**: `OSSEOTOUCH AI/JAN34/CLAUDE.md`
- **Marketing (JESFAG)**: `OSSEOTOUCH AI/JESFAG/CLAUDE.md`
- **SUTURE vendita**: `OSSEOTOUCH AI/SUTURE/context_claude/OPERATIVITA.md`
- **SUTURE acquisto VITREX**: `OSSEOTOUCH AI/cereda/context_claude/SUTURE.md`
- **Recruiting freelance**: `OSSEOTOUCH AI/FREELANCER/CLAUDE_FREELANCER.md`
- **Recupero crediti, report agenti**: `OSSEOTOUCH AI/ANTONIA/context_claude/`

### Pannelli esterni (servizi)

- **Railway** — `https://railway.app` (deploy, logs, env vars, database)
- **Mailgun** — `https://app.eu.mailgun.com` (logs email, sender, dominio)
- **Stripe Dashboard** — `https://dashboard.stripe.com` (pagamenti, webhook secret)
- **Cloudflare** — `https://dash.cloudflare.com` (DNS `myosseotouch.com` e `osseotouch.com`)
- **Odoo OSSEOTOUCH** — `https://osseotouch.odoo.com` (clienti, fatture, ordini, suture stock)
- **Google Ads** — `https://ads.google.com`
- **YouTube Studio** — `https://studio.youtube.com`
- **Zoom Marketplace** — `https://marketplace.zoom.us` (Server-to-Server OAuth app)
- **Freelancer.com** — `https://www.freelancer.com`
- **Calendly** — `https://calendly.com`
- **Microsoft Clarity** — `https://clarity.microsoft.com`

L'imprenditore ha le credenziali per tutti i pannelli esterni. Mai chiedere le credenziali in chat o email.
