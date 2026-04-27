# ROADMAP_POST_DOC_DASHBOARD_CS

**Versione:** 1.1 · **Ultimo aggiornamento:** 2026-04-27 · **Stato:** ✅ chiuso lato codice/documentazione/deploy

Roadmap dei lavori successivi al push di `772af46` (README v2 + MANUALE_UTENTE v2 + sanitizzazione 11 script legacy).

## Stato finale

Tutti i filoni operativi sono **completati lato codice, documentazione e deploy**. Resta una sola **azione manuale rimandata** che richiede l'imprenditore (vedi sezione in fondo).

---

## Stato di partenza

Push `772af46` su `origin/main` completato. README v2 e MANUALE_UTENTE v2 live.
Stringa storica `chiave-segreta-admin-2024` rimossa da 11 script diagnostici e dai 2 backup `.pre-v2.md`. Restano 4 untracked locali (`*.pre-v2.md`, `sync_daily.bat`, `sync_daily.log`) e una sola occorrenza residua della stringa in `.claude/settings.local.json` (config locale, fuori scope).

---

## Filone 1 — Verifica deploy Railway ✅ completato

- **Scopo**: confermare che il redeploy automatico Railway abbia completato senza regressioni.
- **Esito**: 4 push consecutivi su `origin/main` (`772af46` → `3ec990e` → `e2c2838` → `0086d46`), Railway ha autodeployato a ogni push. Verifica smoke test su admin/CS demandata all'imprenditore in modalità live.

---

## Filone 2 — Gestione file untracked ✅ completato

- **Scopo**: chiudere consapevolmente lo stato dei 4 file untracked (backup `.pre-v2.md`, `sync_daily.bat`, `sync_daily.log`).
- **Esito**: `.gitignore` aggiornato per ignorare `sync_daily.log` e `*.pre-v2.md`. `sync_daily.bat` e `ROADMAP_POST_DOC_DASHBOARD_CS.md` committati. I backup `.pre-v2.md` restano locali consapevolmente. Commit `3ec990e`, pushato su `origin/main`.

---

## Filone 3 — Rimozione Telegram ✅ completato lato codice/doc

- **Scopo**: eliminare la dipendenza dal bot Telegram dal codice runtime e chiudere il gap di sicurezza più grave (fallback hardcoded di token in `server.js`).
- **Esito**:
  - ✅ Rimossi tutti i fallback hardcoded di Telegram (e dimenticato di OPENAI) da `CONFIG`.
  - ✅ Bot interattivo eliminato (polling, voice, text-to-task, OpenAI Whisper trascrizione).
  - ✅ Helper Telegram superflui rimossi (`sendTelegramNotification`, `sendTelegramReply`, `startTelegramPolling`, `handleTelegramMessage`, `handleVoiceMessage`, `transcribeAndCreateTask`).
  - ✅ Variabili `TELEGRAM_CHAT_ID_KIM`, `TELEGRAM_CHAT_ID_RELATORE`, `OPENAI_API_KEY` rimosse dal codice.
  - ✅ Helper unica `sendTelegramDeletionAlert` introdotta + 6 call site su deletion/revoche critiche.
  - ✅ Notifiche Telegram non-cancellazione rimosse (task complete, report ready, forum, Calendly, suture sync error).
  - ✅ Bug latente Calendly (`sendTelegram` mai definita) eliminato.
  - ✅ README v2 §11 e MANUALE_UTENTE §3.3 aggiornati per riflettere il canale alert-only.
  - Commit `e2c2838`, pushato su `origin/main`.
- **Pendente lato manuale**: vedi sezione "Azione manuale rimandata" in fondo.

---

## Filone 4 — Pulizia file legacy ✅ completato

- **Scopo**: archiviare/rimuovere i file orfani della root identificati in README v2 Appendice A e aggiornare metadata stale (`package.json:description`, `OPENAI_API_KEY` in `CONFIG`).
- **Esito**:
  - ✅ 4 file cancellati (`database.json`, `INV_2026_00072.pdf`, `temp_audit_video_tracking.js`, `temp_count_arcara.js`).
  - ✅ 16 script diagnostici archiviati in `_archive/diagnostica_suture/` (8) e `_archive/diagnostica_webinar/` (8).
  - ✅ `_archive/README.md` creato.
  - ✅ `package.json:description` aggiornata.
  - ✅ README v2 Appendice A aggiornata per riflettere lo stato post-pulizia.
  - Commit `0086d46`, pushato su `origin/main`.

---

## Ordine consigliato

1. **Filone 1** — Verifica deploy (subito, ~10 minuti).
2. **Filone 2** — Untracked (subito dopo, decisione + eventuali commit veloci).
3. **Filone 3** — Telegram (sessione dedicata, dopo allineamento strategico).
4. **Filone 4** — Pulizia legacy (ultima passata, idealmente dopo Telegram per fare una sola passata integrata sul sorgente).

---

## Regole di sicurezza (valide per tutti i filoni)

- Ogni modifica file richiede **autorizzazione esplicita**.
- Modifiche a `server.js`, schema DB, env vars di produzione: **autorizzazione esplicita + review + backup**.
- Mai stampare secret/token/chiavi in chat o commit message.
- `.claude/settings.local.json` resta non toccato salvo richiesta esplicita.
- Push remoto solo dopo verifica statica dei file in commit + autorizzazione.

---

## Azione manuale rimandata

A chiusura del task post-doc Dashboard CS resta **una sola azione manuale** che richiede l'imprenditore (non automatizzabile dal repo):

- **Rotazione/revoca del vecchio token Telegram su BotFather**. Anche se i fallback hardcoded sono stati rimossi dal codice attuale (`e2c2838`), il vecchio token resta nello storico Git dei commit precedenti. Per chiudere completamente il gap:
  1. Aprire `@BotFather` su Telegram, selezionare il bot della Dashboard CS.
  2. Generare nuovo token (`/revoke` + `/token`) — il vecchio diventa inutilizzabile.
  3. Aggiornare `TELEGRAM_BOT_TOKEN` su Railway Variables con il nuovo valore.
  4. Opzionale: rimuovere da Railway Variables anche `TELEGRAM_CHAT_ID_KIM`, `TELEGRAM_CHAT_ID_RELATORE`, `OPENAI_API_KEY` (non più referenziate dal codice).

Una volta completata la rotazione, il task **Dashboard CS post-doc è chiuso lato codice, documentazione e deploy**.
