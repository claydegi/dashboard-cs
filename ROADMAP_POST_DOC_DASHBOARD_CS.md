# ROADMAP_POST_DOC_DASHBOARD_CS

**Versione:** 1.0 · **Ultimo aggiornamento:** 2026-04-27

Roadmap dei lavori successivi al push di `772af46` (README v2 + MANUALE_UTENTE v2 + sanitizzazione 11 script legacy).

---

## Stato di partenza

Push `772af46` su `origin/main` completato. README v2 e MANUALE_UTENTE v2 live.
Stringa storica `chiave-segreta-admin-2024` rimossa da 11 script diagnostici e dai 2 backup `.pre-v2.md`. Restano 4 untracked locali (`*.pre-v2.md`, `sync_daily.bat`, `sync_daily.log`) e una sola occorrenza residua della stringa in `.claude/settings.local.json` (config locale, fuori scope).

---

## Filone 1 — Verifica deploy Railway

- **Scopo**: confermare che il redeploy automatico Railway abbia completato senza regressioni.
- **Rischio**: 🟢 basso — il commit non tocca runtime, schema DB, env vars.
- **Azione principale**: smoke test delle viste live (admin, CS, portale cliente) + check log Railway.
- **Finito quando**: deploy in stato SUCCESS, viste rispondono, nessuna segnalazione operativa.

---

## Filone 2 — Gestione file untracked

- **Scopo**: chiudere consapevolmente lo stato dei 4 file untracked (backup `.pre-v2.md`, `sync_daily.bat`, `sync_daily.log`).
- **Rischio**: 🟢 basso — nessun impatto sul runtime.
- **Azione principale**: decidere per ciascun file se committare, ignorare via `.gitignore`, o tenere consapevolmente locale. Aggiornare `.gitignore` di conseguenza.
- **Finito quando**: ogni file ha una destinazione decisa e documentata. Lo stato Git rispecchia la decisione (commit, ignore, o conservazione locale consapevole sono tutti esiti validi).

---

## Filone 3 — Rimozione Telegram

- **Scopo**: eliminare la dipendenza dal bot Telegram dal codice runtime e chiudere il gap di sicurezza più grave (fallback hardcoded di token in `server.js`).
- **Rischio**: 🟡 medio — tocca direttamente `server.js` e una funzione operativa percepita dal CS (notifiche). Richiede decisione strategica preliminare con l'imprenditore.
- **Azione principale**: audit statico delle call site, decisione (rimozione totale / disattivazione soft / sostituzione canale), implementazione in commit incrementali, allineamento doc.
- **Finito quando**: nessuna call attiva a Telegram in runtime e nessun fallback hardcoded, env vars Telegram rimosse da Railway, token revocato/bot disattivato su BotFather, README v2 §11 alleggerito di 2 righe del gap, MANUALE §3.3 aggiornato, CS allineato sul nuovo canale (se previsto).

---

## Filone 4 — Pulizia file legacy ✅ completato lato pulizia root

- **Scopo**: archiviare/rimuovere i file orfani della root identificati in README v2 Appendice A e aggiornare metadata stale (`package.json:description`, `OPENAI_API_KEY` in `CONFIG`).
- **Rischio**: 🟢 basso — i file da pulire non sono importati da `server.js`, già verificato staticamente.
- **Azione principale**: cancellazione/spostamento dei file legacy in `_archive/`, aggiornamento metadata, allineamento Appendice A del README.
- **Stato attuale (2026-04-27)**:
  - ✅ 4 file cancellati (`database.json`, `INV_2026_00072.pdf`, `temp_audit_video_tracking.js`, `temp_count_arcara.js`).
  - ✅ 16 script diagnostici archiviati in `_archive/diagnostica_suture/` (8) e `_archive/diagnostica_webinar/` (8).
  - ✅ `_archive/README.md` creato.
  - ✅ `package.json:description` aggiornata.
  - ✅ `OPENAI_API_KEY` rimossa dal codice nel Filone 3 (commit `e2c2838`).
  - ✅ README v2 Appendice A aggiornata per riflettere lo stato post-pulizia.
  - 🟡 **Resta solo**: commit dedicato + push (autorizzati separatamente).
- **Finito quando**: la root contiene solo file effettivamente parte del runtime + automation + doc; `_archive/` popolato e documentato; README v2 Appendice A coerente con lo stato post-pulizia; commit + push completati.

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
