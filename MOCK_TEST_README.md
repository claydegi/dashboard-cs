# 🧪 Mock Test - Sistema Freelancer AI

Sistema di test completo per il workflow Freelancer.com **senza chiamate API reali**.

## ✅ Come attivare il Mock Mode

### Opzione 1: Variabile d'ambiente Railway (Consigliata)

1. Vai su [Railway Dashboard](https://railway.app/dashboard)
2. Apri il progetto `dashboard-cs`
3. Tab **Variables**
4. Aggiungi variabile:
   - Nome: `FREELANCER_MOCK_MODE`
   - Valore: `true`
5. Deploy automatico (o clicca **Redeploy**)
6. ✅ Mock attivo! Vedrai il banner arancione nell'admin

### Opzione 2: Test locale

1. Crea file `.env` nella root del progetto:
   ```bash
   FREELANCER_MOCK_MODE=true
   ANTHROPIC_API_KEY=sk-ant-... # La tua chiave Anthropic
   ```

2. Avvia server locale:
   ```bash
   node server.js
   ```

3. Apri: `http://localhost:3000/admin?key=TUA_CHIAVE`

4. ✅ Vedrai il banner arancione "MODALITÀ TEST ATTIVA"

## 🎯 Workflow completo da testare

### 1. Crea progetto

1. Tab **Freelancer** → **+ Nuovo Progetto**
2. Compila:
   - Titolo: `Video editing caso clinico implantologia`
   - Descrizione: `Serve editing professionale per video di 5 minuti su caso clinico. Deve includere sottotitoli, transizioni e grafica professionale.`
   - Budget: `500` EUR
   - Aggiungi allegati (opzionale)
3. **Crea Progetto**

### 2. Job Composer - Ottimizza con AI

1. Clicca sulla card del progetto appena creato
2. **✨ Ottimizza con AI**
3. Attendi 15-20 secondi
4. Vai nel tab **Approvazioni**
5. Vedi il job ottimizzato (titolo inglese, skill IDs, budget suggerito)
6. **Approva**
7. ✅ Il progetto viene pubblicato automaticamente su "Freelancer.com" (mock)

### 3. Talent Scout - Analizza proposte

1. Torna al tab **Progetti**
2. Clicca sul progetto (ora stato: `pubblicato`)
3. **🔍 Analizza Proposte con AI**
4. Attendi 20-30 secondi (il mock genera 5-8 bid fake realistici)
5. Vai nel tab **Approvazioni**
6. Vedi i **Top 3 candidati** con:
   - 🥇 Medaglia oro, argento, bronzo
   - Score, pro/contro, raccomandazione
7. Seleziona il candidato da assumere (radio button)
8. **Approva**

### 4. Negotiator - Assegna progetto

1. Dopo approvazione, il Negotiator parte **automaticamente**:
   - Genera messaggio benvenuto con Claude
   - Assegna il progetto al freelancer (mock)
   - Invia messaggio di benvenuto (mock)
   - Stato progetto → `in_corso`
2. ✅ Progetto assegnato!

### 5. Delivery Manager - Monitora progresso

1. Torna al tab **Progetti**
2. Clicca sul progetto (stato: `in_corso`)
3. Vedi freelancer assegnato
4. **📦 Controlla Progresso**
5. Attendi 15-20 secondi
6. Claude analizza:
   - Messaggi scambiati (il mock simula risposte freelancer)
   - Stato progresso (in tempo / ritardo / bloccato)
   - Invia reminder se necessario (mock)
7. Se serve azione, crea approvazione (tab **Approvazioni**)

### 6. Cost Tracker - Chiudi progetto

1. Progetto ancora in `in_corso`
2. **✅ Chiudi Progetto**
3. Inserisci costo finale pagato: es. `450`
4. Conferma
5. Attendi 15-20 secondi
6. Claude analizza:
   - Variance budget vs costo effettivo
   - Valutazione (ottimo / buono / costoso)
   - Quality score freelancer
   - Lezioni apprese per progetti futuri
7. Stato progetto → `completato`
8. Report salvato nel tab **Approvazioni**

## 🎭 Cosa simula il Mock

### ✅ Dati realistici

- **5-8 freelancer** con profili vari (India, UK, Pakistan, ecc.)
- **Rating realistici**: 7.2 - 9.5 / 10
- **Recensioni**: 30 - 220 progetti completati
- **Budget variabili**: 70-130% del budget massimo
- **Tempi delivery**: 3-14 giorni
- **Messaggi**: 50% chance il freelancer risponde

### ✅ API simulate

Tutte le chiamate Freelancer.com API sono intercettate:

- `POST /projects/0.1/projects/` - Pubblica progetto
- `GET /projects/0.1/bids/` - Scarica proposte
- `POST /projects/{id}/` con `action=award` - Assegna progetto
- `POST /messages/0.1/threads/` - Invia messaggio
- `GET /messages/0.1/threads/{id}/messages/` - Leggi messaggi

### ✅ Chiamate Claude API REALI

⚠️ **Importante**: Le chiamate a Claude (Anthropic API) sono **REALI**, non simulate.

Questo significa:
- ✅ Testi generati veramente da Claude (qualità produzione)
- ✅ Analisi realistiche (Job Composer, Talent Scout, ecc.)
- ⚠️ **Consuma token Anthropic** (circa 15.000 token per workflow completo)

**Stima costi per test completo**:
- ~15.000 token input + 5.000 output
- ~$0.30 per test end-to-end (Claude Sonnet 4)

## 🔥 Vantaggi del Mock

1. ✅ **Nessun limite API Freelancer.com** - Testa quanto vuoi
2. ✅ **Instant feedback** - Non serve aspettare bid reali (giorni)
3. ✅ **Scenari controllati** - Dati consistenti e prevedibili
4. ✅ **Zero rischi** - Nessun progetto reale pubblicato
5. ✅ **Debugging facile** - Vedi log `[MOCK API]` nel console

## 🚀 Disattivare il Mock

### Su Railway:
1. Variables → Elimina `FREELANCER_MOCK_MODE`
2. Redeploy

### Locale:
1. Rimuovi `FREELANCER_MOCK_MODE=true` da `.env`
2. Riavvia server

---

**Pronto per il test? Attiva il mock e segui il workflow step-by-step!** 🎯
