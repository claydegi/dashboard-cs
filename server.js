const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurazione
const CONFIG = {
    ADMIN_KEY: process.env.ADMIN_KEY || 'chiave-segreta-admin-2024',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '7975162439:AAGB95NY4fAVdhNdgBY5X5QObHDNKHNkNFw',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '-5130672016',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'LA_TUA_API_KEY_OPENAI'
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== DATABASE JSON ====================
const DB_FILE = path.join(__dirname, 'database.json');

// Inizializza database se non esiste
function initDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = { tasks: [], nextId: 1 };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
}

// Leggi database
function readDB() {
    initDB();
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
}

// Scrivi database
function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Ottieni tutti i task
function getAllTasks() {
    return readDB().tasks;
}

// Ottieni task per ID
function getTaskById(id) {
    const db = readDB();
    return db.tasks.find(t => t.id === id);
}

// Crea task
function createTask(taskData) {
    const db = readDB();
    const task = {
        id: db.nextId++,
        titolo: taskData.titolo,
        descrizione: taskData.descrizione || '',
        stato: 'da_fare',
        priorita: taskData.priorita || 'media',
        scadenza: taskData.scadenza || null,
        assegnato_a: taskData.assegnato_a || null,
        tipo: taskData.tipo || 'cs',
        commenti: [],
        creato_il: new Date().toISOString(),
        completato_il: null,
        completato_da: null
    };
    db.tasks.push(task);
    writeDB(db);
    return task;
}

// Aggiorna task
function updateTask(id, updates) {
    const db = readDB();
    const index = db.tasks.findIndex(t => t.id === id);
    if (index === -1) return null;

    db.tasks[index] = { ...db.tasks[index], ...updates };
    writeDB(db);
    return db.tasks[index];
}

// Elimina task
function deleteTask(id) {
    const db = readDB();
    const index = db.tasks.findIndex(t => t.id === id);
    if (index === -1) return false;

    db.tasks.splice(index, 1);
    writeDB(db);
    return true;
}

// Inizializza DB all'avvio
initDB();

// Middleware per verificare chiave admin
function requireAdmin(req, res, next) {
    const key = req.query.key || req.headers['x-admin-key'];
    if (key !== CONFIG.ADMIN_KEY) {
        return res.status(401).json({ error: 'Accesso non autorizzato' });
    }
    next();
}

// ==================== API TASKS ====================

// Lista tutti i task (admin)
app.get('/api/tasks', requireAdmin, (req, res) => {
    const tasks = getAllTasks().sort((a, b) => new Date(b.creato_il) - new Date(a.creato_il));
    res.json(tasks);
});

// Lista task per CS (solo tipo 'cs' e non completati)
app.get('/api/tasks/cs', (req, res) => {
    const tasks = getAllTasks()
        .filter(t => t.tipo === 'cs' && t.stato !== 'completato')
        .sort((a, b) => {
            const priorityOrder = { alta: 1, media: 2, bassa: 3 };
            return priorityOrder[a.priorita] - priorityOrder[b.priorita];
        });
    res.json(tasks);
});

// Lista task privati admin
app.get('/api/tasks/private', requireAdmin, (req, res) => {
    const tasks = getAllTasks()
        .filter(t => t.tipo === 'privato')
        .sort((a, b) => new Date(b.creato_il) - new Date(a.creato_il));
    res.json(tasks);
});

// Storico task completati (admin)
app.get('/api/tasks/completed', requireAdmin, (req, res) => {
    const tasks = getAllTasks()
        .filter(t => t.stato === 'completato')
        .sort((a, b) => new Date(b.completato_il) - new Date(a.completato_il));
    res.json(tasks);
});

// Crea nuovo task
app.post('/api/tasks', requireAdmin, (req, res) => {
    const { titolo, descrizione, priorita, scadenza, assegnato_a, tipo } = req.body;

    if (!titolo) {
        return res.status(400).json({ error: 'Il titolo è obbligatorio' });
    }

    const task = createTask({
        titolo,
        descrizione,
        priorita,
        scadenza,
        assegnato_a,
        tipo
    });

    res.status(201).json(task);
});

// Modifica task
app.put('/api/tasks/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const { titolo, descrizione, stato, priorita, scadenza, assegnato_a, tipo } = req.body;

    const existing = getTaskById(id);
    if (!existing) {
        return res.status(404).json({ error: 'Task non trovato' });
    }

    const updates = {};
    if (titolo !== undefined) updates.titolo = titolo;
    if (descrizione !== undefined) updates.descrizione = descrizione;
    if (stato !== undefined) updates.stato = stato;
    if (priorita !== undefined) updates.priorita = priorita;
    if (scadenza !== undefined) updates.scadenza = scadenza;
    if (assegnato_a !== undefined) updates.assegnato_a = assegnato_a;
    if (tipo !== undefined) updates.tipo = tipo;

    const task = updateTask(id, updates);
    res.json(task);
});

// Completa task (endpoint specifico per CS)
app.put('/api/tasks/:id/complete', (req, res) => {
    const id = parseInt(req.params.id);
    const { completato_da } = req.body;

    const existing = getTaskById(id);
    if (!existing) {
        return res.status(404).json({ error: 'Task non trovato' });
    }

    const task = updateTask(id, {
        stato: 'completato',
        completato_il: new Date().toISOString(),
        completato_da: completato_da || 'Operatore CS'
    });

    // Invia notifica Telegram
    sendTelegramNotification(task, completato_da || 'Operatore CS');

    res.json(task);
});

// Cambia stato task (per CS - da_fare, in_corso)
app.put('/api/tasks/:id/status', (req, res) => {
    const id = parseInt(req.params.id);
    const { stato } = req.body;

    if (!['da_fare', 'in_corso'].includes(stato)) {
        return res.status(400).json({ error: 'Stato non valido. Usa "da_fare" o "in_corso"' });
    }

    const existing = getTaskById(id);
    if (!existing) {
        return res.status(404).json({ error: 'Task non trovato' });
    }

    const task = updateTask(id, { stato });
    res.json(task);
});

// Elimina task
app.delete('/api/tasks/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);

    const existing = getTaskById(id);
    if (!existing) {
        return res.status(404).json({ error: 'Task non trovato' });
    }

    deleteTask(id);
    res.json({ message: 'Task eliminato' });
});

// Aggiungi commento
app.post('/api/tasks/:id/comments', (req, res) => {
    const id = parseInt(req.params.id);
    const { testo, autore } = req.body;

    if (!testo) {
        return res.status(400).json({ error: 'Il testo del commento è obbligatorio' });
    }

    const existing = getTaskById(id);
    if (!existing) {
        return res.status(404).json({ error: 'Task non trovato' });
    }

    const commenti = [...(existing.commenti || [])];
    commenti.push({
        id: Date.now(),
        testo,
        autore: autore || 'Anonimo',
        data: new Date().toISOString()
    });

    const task = updateTask(id, { commenti });
    res.json(task);
});

// ==================== TELEGRAM ====================

// Invia notifica Telegram quando task completato
async function sendTelegramNotification(task, completatoDa) {
    if (CONFIG.TELEGRAM_BOT_TOKEN === 'IL_TUO_TOKEN_TELEGRAM') {
        console.log('[Telegram] Token non configurato, notifica saltata');
        return;
    }

    const dataCompletamento = new Date(task.completato_il).toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    const messaggio = `✅ *Task Completato*

📋 *${task.titolo}*
👤 Completato da: ${completatoDa}
📅 Data: ${dataCompletamento}
${task.priorita === 'alta' ? '🔴 Priorità Alta' : task.priorita === 'media' ? '🟡 Priorità Media' : '🟢 Priorità Bassa'}`;

    const data = JSON.stringify({
        chat_id: CONFIG.TELEGRAM_CHAT_ID,
        text: messaggio,
        parse_mode: 'Markdown'
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
            if (res.statusCode === 200) {
                console.log('[Telegram] Notifica inviata con successo');
            } else {
                console.log('[Telegram] Errore:', responseData);
            }
        });
    });

    req.on('error', (e) => {
        console.log('[Telegram] Errore connessione:', e.message);
    });

    req.write(data);
    req.end();
}

// ==================== TELEGRAM BOT (Polling per vocali) ====================

let lastUpdateId = 0;

// Polling per ricevere messaggi Telegram (vocali)
async function startTelegramPolling() {
    if (CONFIG.TELEGRAM_BOT_TOKEN === 'IL_TUO_TOKEN_TELEGRAM') {
        console.log('[Telegram Bot] Token non configurato, polling disabilitato');
        return;
    }

    console.log('[Telegram Bot] Avvio polling per messaggi vocali...');

    setInterval(async () => {
        try {
            const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=10`;

            https.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', async () => {
                    try {
                        const response = JSON.parse(data);
                        if (response.ok && response.result) {
                            for (const update of response.result) {
                                lastUpdateId = update.update_id;
                                await handleTelegramMessage(update.message);
                            }
                        }
                    } catch (e) {
                        // Ignora errori di parsing
                    }
                });
            }).on('error', () => {});
        } catch (e) {
            // Ignora errori
        }
    }, 3000);
}

// Gestisce messaggi Telegram
async function handleTelegramMessage(message) {
    if (!message) return;

    const chatId = message.chat.id;

    // Messaggio vocale
    if (message.voice) {
        await handleVoiceMessage(message, chatId);
        return;
    }

    // Messaggio di testo (crea task direttamente)
    if (message.text && !message.text.startsWith('/')) {
        const task = createTask({ titolo: message.text, tipo: 'cs', priorita: 'media' });
        await sendTelegramReply(chatId, `✅ Task creato:\n\n📋 *${task.titolo}*`);
        return;
    }

    // Comandi
    if (message.text === '/start') {
        await sendTelegramReply(chatId, `👋 Ciao! Sono il bot della Dashboard CS.

📝 *Come usarmi:*
- Invia un messaggio vocale per creare un task
- Invia un messaggio di testo per creare un task
- Il vocale verrà trascritto automaticamente

🎤 Prova a inviarmi un vocale!`);
    }
}

// Gestisce messaggi vocali
async function handleVoiceMessage(message, chatId) {
    try {
        // Notifica che stiamo elaborando
        await sendTelegramReply(chatId, '🎤 Sto trascrivendo il vocale...');

        // Ottieni file info
        const fileId = message.voice.file_id;
        const fileInfoUrl = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;

        https.get(fileInfoUrl, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', async () => {
                try {
                    const fileInfo = JSON.parse(data);
                    if (fileInfo.ok) {
                        const filePath = fileInfo.result.file_path;
                        const fileUrl = `https://api.telegram.org/file/bot${CONFIG.TELEGRAM_BOT_TOKEN}/${filePath}`;

                        // Scarica e trascrivi
                        await transcribeAndCreateTask(fileUrl, chatId);
                    }
                } catch (e) {
                    await sendTelegramReply(chatId, '❌ Errore durante l\'elaborazione del vocale');
                }
            });
        });
    } catch (e) {
        await sendTelegramReply(chatId, '❌ Errore durante l\'elaborazione del vocale');
    }
}

// Trascrivi audio con OpenAI Whisper
async function transcribeAndCreateTask(audioUrl, chatId) {
    if (CONFIG.OPENAI_API_KEY === 'LA_TUA_API_KEY_OPENAI') {
        await sendTelegramReply(chatId, '❌ API OpenAI non configurata. Configura OPENAI_API_KEY.');
        return;
    }

    // Scarica il file audio
    const tempFile = path.join(__dirname, 'temp_audio.ogg');

    const file = fs.createWriteStream(tempFile);

    https.get(audioUrl, (response) => {
        response.pipe(file);
        file.on('finish', async () => {
            file.close();

            try {
                // Usa form-data per inviare a OpenAI
                const FormData = require('form-data');
                const form = new FormData();
                form.append('file', fs.createReadStream(tempFile), 'audio.ogg');
                form.append('model', 'whisper-1');
                form.append('language', 'it');

                const options = {
                    hostname: 'api.openai.com',
                    path: '/v1/audio/transcriptions',
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${CONFIG.OPENAI_API_KEY}`,
                        ...form.getHeaders()
                    }
                };

                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', async () => {
                        try {
                            const result = JSON.parse(data);
                            if (result.text) {
                                const task = createTask({
                                    titolo: result.text.length > 100 ? result.text.substring(0, 100) + '...' : result.text,
                                    descrizione: result.text.length > 100 ? result.text : '',
                                    tipo: 'cs',
                                    priorita: 'media'
                                });
                                await sendTelegramReply(chatId, `✅ Task creato da vocale:\n\n📋 *${task.titolo}*\n\n📝 Trascrizione: "${result.text}"`);
                            } else {
                                await sendTelegramReply(chatId, '❌ Non sono riuscito a trascrivere il vocale');
                            }
                        } catch (e) {
                            await sendTelegramReply(chatId, '❌ Errore nella trascrizione');
                        }

                        // Elimina file temporaneo
                        fs.unlink(tempFile, () => {});
                    });
                });

                req.on('error', async (e) => {
                    await sendTelegramReply(chatId, '❌ Errore di connessione a OpenAI');
                    fs.unlink(tempFile, () => {});
                });

                form.pipe(req);
            } catch (e) {
                await sendTelegramReply(chatId, '❌ Errore durante la trascrizione');
                fs.unlink(tempFile, () => {});
            }
        });
    }).on('error', async (e) => {
        await sendTelegramReply(chatId, '❌ Errore nel download del file audio');
    });
}

// Invia risposta Telegram
async function sendTelegramReply(chatId, text) {
    const data = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    return new Promise((resolve) => {
        const req = https.request(options, (res) => {
            res.on('data', () => {});
            res.on('end', resolve);
        });
        req.on('error', resolve);
        req.write(data);
        req.end();
    });
}

// ==================== ROUTES PAGINE ====================

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/cs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cs.html'));
});

app.get('/storico', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'storico.html'));
});

// Homepage redirect
app.get('/', (req, res) => {
    res.redirect('/cs');
});

// ==================== AVVIO SERVER ====================

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║           Dashboard CS - Server Avviato                   ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║   Server:     http://localhost:${PORT}                       ║
║                                                            ║
║   Admin:      http://localhost:${PORT}/admin?key=${CONFIG.ADMIN_KEY.substring(0, 8)}...  ║
║   CS:         http://localhost:${PORT}/cs                    ║
║   Storico:    http://localhost:${PORT}/storico?key=...       ║
║                                                            ║
║   Configura le variabili d'ambiente:                       ║
║      - ADMIN_KEY         (chiave accesso admin)            ║
║      - TELEGRAM_BOT_TOKEN (token bot Telegram)             ║
║      - TELEGRAM_CHAT_ID   (ID chat/gruppo)                 ║
║      - OPENAI_API_KEY     (per trascrizione vocali)        ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);

    // Avvia polling Telegram per vocali
    startTelegramPolling();
});
