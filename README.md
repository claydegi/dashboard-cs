# Dashboard CS - Task Management per Customer Service

Sistema di gestione task condiviso tra Admin e Customer Service con notifiche Telegram in tempo reale.

## Panoramica

Questa dashboard permette di:
- **Admin**: creare e gestire task per il team CS + task privati tra admin
- **Customer Service**: visualizzare i task assegnati, completarli e commentare
- **Notifiche**: ricevere notifiche Telegram quando un task viene completato
- **Storico**: consultare lo storico completo dei task completati con data/ora/operatore

## Link di Accesso

| Ruolo | URL |
|-------|-----|
| Admin | `https://dashboard-cs-production.up.railway.app/admin?key=chiave-segreta-admin-2024` |
| Customer Service | `https://dashboard-cs-production.up.railway.app/cs` |
| Storico (Admin) | `https://dashboard-cs-production.up.railway.app/storico?key=chiave-segreta-admin-2024` |

## Struttura del Progetto

```
DASHBOARD-CS/
├── server.js           # Backend Node.js/Express
├── package.json        # Dipendenze
├── database.json       # Database (generato automaticamente)
├── public/
│   ├── admin.html      # Pagina amministrazione
│   ├── cs.html         # Pagina customer service
│   ├── storico.html    # Pagina storico completati
│   ├── style.css       # Stili
│   ├── admin.js        # Logica admin
│   ├── cs.js           # Logica CS
│   └── storico.js      # Logica storico
```

## Tecnologie Utilizzate

- **Backend**: Node.js + Express
- **Database**: JSON file-based
- **Frontend**: HTML, CSS, JavaScript vanilla
- **Notifiche**: Telegram Bot API
- **Hosting**: Railway.app

## Configurazione

Le variabili di configurazione sono nel file `server.js`:

```javascript
const CONFIG = {
    ADMIN_KEY: 'chiave-segreta-admin-2024',      // Chiave accesso admin
    TELEGRAM_BOT_TOKEN: '...',                   // Token bot Telegram
    TELEGRAM_CHAT_ID: '...',                     // ID gruppo Telegram
    OPENAI_API_KEY: '...'                        // Per trascrizione vocali (opzionale)
};
```

## Telegram Bot

- **Nome Bot**: @Ossetouch_cs_bot
- **Funzionalita**:
  - Riceve notifiche quando un task viene completato
  - Permette di creare task inviando messaggi di testo
  - Permette di creare task inviando messaggi vocali (richiede OpenAI API)

## Sviluppo Locale

```bash
# Installa dipendenze
npm install

# Avvia server
npm start

# Apri nel browser
http://localhost:3000/admin?key=chiave-segreta-admin-2024
```

## Deploy

Il progetto e' hostato su Railway.app e si aggiorna automaticamente quando si fa push su GitHub.

```bash
git add .
git commit -m "Descrizione modifica"
git push
```

## API Endpoints

| Metodo | Endpoint | Descrizione | Auth |
|--------|----------|-------------|------|
| GET | /api/tasks | Lista tutti i task | Admin |
| GET | /api/tasks/cs | Task per CS | - |
| GET | /api/tasks/private | Task privati | Admin |
| GET | /api/tasks/completed | Storico completati | Admin |
| POST | /api/tasks | Crea task | Admin |
| PUT | /api/tasks/:id | Modifica task | Admin |
| PUT | /api/tasks/:id/complete | Completa task | - |
| PUT | /api/tasks/:id/status | Cambia stato | - |
| DELETE | /api/tasks/:id | Elimina task | Admin |
| POST | /api/tasks/:id/comments | Aggiungi commento | - |

## Sicurezza

- L'accesso Admin richiede la chiave segreta nell'URL (`?key=...`)
- Il CS accede senza autenticazione ma vede solo i task di tipo "cs"
- I task privati sono visibili solo agli admin
- Lo storico e' accessibile solo agli admin
