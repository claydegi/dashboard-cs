# Manuale Utente - Dashboard CS

## Indice
1. [Link di Accesso](#link-di-accesso)
2. [Guida per Admin](#guida-per-admin)
3. [Guida per Customer Service](#guida-per-customer-service)
4. [Storico Task Completati](#storico-task-completati)
5. [Notifiche Telegram](#notifiche-telegram)
6. [Creare Task da Telegram](#creare-task-da-telegram)

---

## Link di Accesso

### Per Admin (tu e il tuo collega)
```
https://dashboard-cs-production.up.railway.app/admin?key=chiave-segreta-admin-2024
```
**Importante**: questo link contiene la chiave segreta, condividilo solo con il tuo collega admin.

### Per Customer Service
```
https://dashboard-cs-production.up.railway.app/cs
```
Questo link puo' essere condiviso con tutto il team CS.

### Per Storico (solo Admin)
```
https://dashboard-cs-production.up.railway.app/storico?key=chiave-segreta-admin-2024
```

---

## Guida per Admin

### Accesso
1. Apri il link Admin nel browser (funziona anche da telefono)
2. Vedrai la dashboard con due sezioni: "Task CS" e "Task Privati"

### Creare un Nuovo Task

1. Compila il form in alto alla pagina:

   | Campo | Descrizione |
   |-------|-------------|
   | **Titolo** | Nome del task (obbligatorio) |
   | **Tipo** | "Task CS" = visibile al CS / "Privato" = solo admin |
   | **Descrizione** | Dettagli e istruzioni |
   | **Priorita** | Alta (rosso), Media (giallo), Bassa (verde) |
   | **Scadenza** | Data limite per completare il task |
   | **Assegnato a** | Nome dell'operatore CS (solo per Task CS) |

2. Clicca **"Crea Task"**
3. Il task apparira' nella lista corrispondente

### Navigare tra Task CS e Task Privati

- Clicca su **"Task CS"** per vedere i task assegnati al customer service
- Clicca su **"Task Privati"** per vedere i task visibili solo agli admin
- I Task Privati sono utili per note interne, promemoria tra admin, ecc.

### Modificare un Task

1. Trova il task nella lista
2. Clicca il bottone **"Modifica"**
3. Si apre una finestra con tutti i campi modificabili
4. Cambia quello che serve
5. Clicca **"Salva"**

### Eliminare un Task

1. Clicca **"Modifica"** sul task
2. Nella finestra che si apre, clicca **"Elimina"** (bottone rosso)
3. Conferma l'eliminazione

### Filtrare i Task

Usa i menu a tendina sopra la lista per filtrare:
- Per **Stato**: Da fare, In corso, Completato
- Per **Priorita**: Alta, Media, Bassa

### Accedere allo Storico

Clicca su **"Storico Completati"** nel menu in alto per vedere tutti i task completati.

---

## Guida per Customer Service

### Accesso
1. Apri il link CS nel browser (funziona anche da telefono)
2. **Importante**: Inserisci il tuo nome nel campo in alto a destra
   - Il nome serve per tracciare chi completa i task
   - Verra' salvato e non dovrai reinserirlo ogni volta

### Visualizzare i Task

- Vedi solo i task assegnati al CS (non quelli privati degli admin)
- I task sono ordinati per priorita' (Alta prima)
- Ogni task mostra:
  - Titolo e descrizione
  - Priorita' (colore: rosso=alta, giallo=media, verde=bassa)
  - Scadenza
  - A chi e' assegnato
  - Numero di commenti

### Lavorare su un Task

**Iniziare un task:**
- Clicca **"Inizia"** per segnare che stai lavorando sul task
- Lo stato cambia da "Da fare" a "In corso"

**Rimettere in attesa:**
- Se devi interrompere, clicca **"Rimetti in attesa"**
- Lo stato torna a "Da fare"

**Completare un task:**
1. Clicca **"Completa"**
2. Conferma nella finestra che appare
3. Il task scompare dalla tua lista
4. Gli admin ricevono una notifica Telegram
5. Il task va nello Storico con data/ora e il tuo nome

**Aggiungere un commento:**
1. Clicca **"Commenta"**
2. Scrivi il tuo commento
3. Clicca **"Invia Commento"**
4. Il commento sara' visibile a tutti (admin e CS)

### Filtrare i Task

Usa i menu a tendina per filtrare:
- Per **Stato**: Da fare, In corso
- Per **Priorita**: Alta, Media, Bassa

---

## Storico Task Completati

### Accesso (Solo Admin)
Apri il link Storico o clicca "Storico Completati" dalla dashboard Admin.

### Cosa Mostra

Per ogni task completato vedrai:
- Titolo e descrizione originale
- **Chi l'ha completato** (nome operatore)
- **Data e ora esatta** del completamento
- Priorita' e scadenza originali
- Eventuali commenti

### Filtrare lo Storico

- **Per data**: usa i campi "Da" e "A" per filtrare un periodo
- **Per operatore**: scrivi il nome per vedere solo i task di quell'operatore
- **Pulisci filtri**: rimuove tutti i filtri

### Statistiche

In alto vedrai:
- Totale task completati
- Completati oggi
- Completati questa settimana

---

## Notifiche Telegram

### Come Funzionano

Quando un operatore CS completa un task:
1. Il sistema invia automaticamente un messaggio al gruppo Telegram
2. Il messaggio contiene:
   - Nome del task
   - Chi l'ha completato
   - Data e ora
   - Priorita'

### Esempio di Notifica

```
✅ Task Completato

📋 Rispondere al cliente ABC
👤 Completato da: Mario Rossi
📅 Data: 28/01/2026, 15:30
🟡 Priorita' Media
```

### Gruppo Telegram

Le notifiche arrivano nel gruppo **"Dashboard_CS"** su Telegram.
Assicurati di avere le notifiche attive per quel gruppo.

---

## Creare Task da Telegram

### Messaggio di Testo

1. Apri Telegram
2. Cerca **@Ossetouch_cs_bot** (o aprilo dal gruppo)
3. Scrivi un messaggio di testo
4. Il bot crea automaticamente un task CS con quel testo come titolo

### Messaggio Vocale (richiede configurazione OpenAI)

1. Apri la chat con **@Ossetouch_cs_bot**
2. Registra un messaggio vocale
3. Il bot:
   - Trascrive il vocale in testo
   - Corregge eventuali errori
   - Crea un task con la trascrizione

**Nota**: Per usare i vocali serve configurare la API key di OpenAI nel server.

---

## Domande Frequenti

**D: Il CS puo' vedere i task privati?**
R: No, i task di tipo "Privato" sono visibili solo agli admin.

**D: Un task completato puo' essere recuperato?**
R: I task completati rimangono nello Storico per sempre, ma non possono essere riaperti.

**D: Come cambio la chiave admin?**
R: Modifica il valore `ADMIN_KEY` nel file `server.js` e fai un nuovo deploy.

**D: Posso usare la dashboard da telefono?**
R: Si', la dashboard e' responsive e funziona su tutti i dispositivi.

**D: I dati vengono salvati?**
R: Si', tutti i dati sono salvati nel database sul server Railway.

---

## Supporto

Per problemi tecnici o modifiche, contatta chi ha sviluppato il sistema.
