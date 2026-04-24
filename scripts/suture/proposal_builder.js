/**
 * SUTURE · PROPOSAL BUILDER — Modulo 2/5 agente SUTURE (lato vendita)
 *
 * Costruisce, valida e persiste le proposte di vendita suture sulle tabelle
 *   proposte · proposta_righe · proposta_eventi · portali_cliente
 * create nel sub-task 1.1.
 *
 * Regole di business (brief sez. 9):
 *   - Sconto max 20% (oltre serve approvazione admin → errore)
 *   - Omaggio 3+1: valido solo se qty totale >= 3 (campo lo salviamo, il check quantita'
 *     resta responsabilita' del frontend al momento della visualizzazione)
 *   - Prodotti aggiunti dal cliente = prezzo di listino (gestione lato portale,
 *     registrata tramite `proposta_righe.origine='cliente'`)
 *   - Mittente 1:1 per rep (Kim=kagnello, Detto=mdetto, Admin=pool) — validato qui
 *   - Spedizioni MAI nella proposta, solo al checkout
 *
 * Stati proposta (brief sez. 8):
 *   pending · confermata_cliente · confermata_manualmente · rifiutata · rimandata
 *
 * Riferimento: SUTURE/BRIEF_IMPLEMENTAZIONE.md sez. 8-9 · SUTURE/PIANO_FASE1.md Blocco 2
 */

'use strict';

const MITTENTI_RULES = {
    kim:   ['kagnello@osseotouch.com'],
    detto: ['mdetto@osseotouch.com'],
    admin: ['kagnello@osseotouch.com', 'mdetto@osseotouch.com', 'contact@osseotouch.com'],
};

const STATI_VALIDI = new Set([
    'pending',
    'confermata_cliente',
    'confermata_manualmente',
    'rifiutata',
    'rimandata',
]);

const CANALI_CONFERMA_VALIDI = new Set([
    'online',           // cliente clicca conferma portale → shop
    'customer_service', // cliente clicca "inviaci il tuo ordine"
    'manuale',          // rep chiude via modal conferma manuale
    'whatsapp',
    'telefono',
    'email',
    'altro',
]);

/**
 * Valida payload proposta. Throws se non valido. Altrimenti restituisce payload normalizzato.
 */
function validateProposta(data) {
    if (!data || typeof data !== 'object') throw new Error('Payload vuoto');
    const errors = [];

    const cliente_id = parseInt(data.cliente_id, 10);
    if (!Number.isInteger(cliente_id) || cliente_id <= 0) errors.push('cliente_id mancante o non valido');

    const sales_rep = String(data.sales_rep || '').toLowerCase();
    if (!MITTENTI_RULES[sales_rep]) errors.push(`sales_rep '${data.sales_rep}' non valido (kim/detto/admin)`);

    const mittente_email = String(data.mittente_email || '').toLowerCase().trim();
    if (!mittente_email) errors.push('mittente_email mancante');
    else if (MITTENTI_RULES[sales_rep] && !MITTENTI_RULES[sales_rep].includes(mittente_email)) {
        errors.push(`mittente '${mittente_email}' non autorizzato per rep '${sales_rep}'`);
    }

    const prodotti = Array.isArray(data.prodotti) ? data.prodotti : [];
    if (!prodotti.length) errors.push('almeno un prodotto richiesto');
    prodotti.forEach((p, idx) => {
        if (!p || typeof p !== 'object') { errors.push(`prodotti[${idx}] non oggetto`); return; }
        if (!p.cod || !String(p.cod).trim()) errors.push(`prodotti[${idx}].cod mancante`);
        if (!p.nome || !String(p.nome).trim()) errors.push(`prodotti[${idx}].nome mancante`);
        const prezzo = parseFloat(p.prezzo);
        if (!Number.isFinite(prezzo) || prezzo < 0) errors.push(`prodotti[${idx}].prezzo non valido`);
        const qty = parseInt(p.qty, 10);
        if (!Number.isInteger(qty) || qty < 1) errors.push(`prodotti[${idx}].qty deve essere >= 1`);
    });

    const sconto_pct = data.sconto_pct !== undefined ? parseFloat(data.sconto_pct) : 0;
    if (!Number.isFinite(sconto_pct) || sconto_pct < 0 || sconto_pct > 20) {
        errors.push('sconto_pct deve essere tra 0 e 20');
    }

    const cadenza_gg = data.cadenza_gg !== undefined ? parseInt(data.cadenza_gg, 10) : 60;
    if (![30, 60, 90].includes(cadenza_gg)) errors.push('cadenza_gg deve essere 30, 60 o 90');

    const modalita = String(data.modalita || 'automatica').toLowerCase();
    if (!['automatica', 'manuale'].includes(modalita)) errors.push("modalita deve essere 'automatica' o 'manuale'");

    if (errors.length) {
        const err = new Error('Validazione fallita: ' + errors.join('; '));
        err.status = 400;
        err.validation_errors = errors;
        throw err;
    }

    return {
        cliente_id,
        sales_rep,
        mittente_email,
        prodotti: prodotti.map(p => ({
            cod: String(p.cod).trim(),
            nome: String(p.nome).trim(),
            prezzo: parseFloat(p.prezzo),
            qty: parseInt(p.qty, 10),
            origine: (p.origine === 'cliente') ? 'cliente' : 'rep',
        })),
        sconto_pct,
        omaggio_3plus1: !!data.omaggio_3plus1,
        cadenza_gg,
        modalita,
        messaggio_personale: data.messaggio_personale ? String(data.messaggio_personale).trim() : null,
    };
}

/**
 * Garantisce l'esistenza di un portale permanente per il cliente.
 * Ritorna il token UUID (nuovo o esistente, anche se revocato — in quel caso riattiva).
 * Un solo portale per cliente (UNIQUE su cliente_id).
 */
async function getOrCreatePortale(cliente_id, pool) {
    const existing = await pool.query(
        `SELECT token, attivo FROM portali_cliente WHERE cliente_id = $1`,
        [cliente_id]
    );
    if (existing.rows.length) {
        const row = existing.rows[0];
        if (!row.attivo) {
            await pool.query(
                `UPDATE portali_cliente SET attivo = TRUE, revocato_at = NULL, revocato_da = NULL
                 WHERE cliente_id = $1`,
                [cliente_id]
            );
        }
        return row.token;
    }
    const ins = await pool.query(
        `INSERT INTO portali_cliente (cliente_id, attivo) VALUES ($1, TRUE)
         RETURNING token`,
        [cliente_id]
    );
    return ins.rows[0].token;
}

/**
 * Crea nuova proposta in transazione: INSERT proposte + proposta_righe + evento 'creata'.
 * Ritorna { id, token_portale, proposta }.
 */
async function createProposta(data, pool) {
    const v = validateProposta(data);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pr = await client.query(
            `INSERT INTO proposte (
                cliente_id, sales_rep, stato, sconto_pct, omaggio_3plus1,
                cadenza_gg, modalita, mittente_email, messaggio_personale, tipo_prodotto
            ) VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, 'suture')
            RETURNING id, data_creazione`,
            [v.cliente_id, v.sales_rep, v.sconto_pct, v.omaggio_3plus1,
             v.cadenza_gg, v.modalita, v.mittente_email, v.messaggio_personale]
        );
        const propostaId = pr.rows[0].id;
        for (const p of v.prodotti) {
            await client.query(
                `INSERT INTO proposta_righe (proposta_id, prodotto_cod, prodotto_nome, prezzo_unit, qty, origine)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [propostaId, p.cod, p.nome, p.prezzo, p.qty, p.origine]
            );
        }
        await client.query(
            `INSERT INTO proposta_eventi (proposta_id, evento, meta_json)
             VALUES ($1, 'creata', $2::jsonb)`,
            [propostaId, JSON.stringify({ sales_rep: v.sales_rep, mittente: v.mittente_email })]
        );
        await client.query('COMMIT');

        const token = await getOrCreatePortale(v.cliente_id, pool);
        return { id: propostaId, token_portale: token, data_creazione: pr.rows[0].data_creazione };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Modifica proposta esistente. Patch parziale. Aggiorna data_modifica + log evento 'modificata'.
 * Se il patch include `prodotti`, sostituisce l'intero set di righe.
 */
async function updateProposta(id, patch, pool) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cur = await client.query(`SELECT * FROM proposte WHERE id = $1`, [id]);
        if (!cur.rows.length) {
            const err = new Error(`Proposta ${id} non trovata`);
            err.status = 404;
            throw err;
        }
        const fields = [];
        const values = [];
        let idx = 1;
        const allowed = ['sconto_pct', 'omaggio_3plus1', 'cadenza_gg', 'modalita',
                         'mittente_email', 'messaggio_personale', 'stato',
                         'canale_conferma', 'note_conferma_manuale', 'rimandata_al'];
        for (const k of allowed) {
            if (k in patch) {
                if (k === 'stato' && !STATI_VALIDI.has(patch[k])) {
                    const err = new Error(`stato non valido: ${patch[k]}`);
                    err.status = 400;
                    throw err;
                }
                fields.push(`${k} = $${idx++}`);
                values.push(patch[k]);
            }
        }
        fields.push(`data_modifica = NOW()`);
        if (fields.length === 1 && !Array.isArray(patch.prodotti)) {
            await client.query('ROLLBACK');
            const err = new Error('Nessun campo da aggiornare');
            err.status = 400;
            throw err;
        }
        if (fields.length > 1) {
            values.push(id);
            await client.query(
                `UPDATE proposte SET ${fields.join(', ')} WHERE id = $${idx}`,
                values
            );
        }
        if (Array.isArray(patch.prodotti)) {
            await client.query(`DELETE FROM proposta_righe WHERE proposta_id = $1`, [id]);
            for (const p of patch.prodotti) {
                await client.query(
                    `INSERT INTO proposta_righe (proposta_id, prodotto_cod, prodotto_nome, prezzo_unit, qty, origine)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [id, p.cod, p.nome, parseFloat(p.prezzo) || 0, parseInt(p.qty, 10) || 1,
                     (p.origine === 'cliente') ? 'cliente' : 'rep']
                );
            }
        }
        await client.query(
            `INSERT INTO proposta_eventi (proposta_id, evento, meta_json)
             VALUES ($1, 'modificata', $2::jsonb)`,
            [id, JSON.stringify({ patch: Object.keys(patch) })]
        );
        await client.query('COMMIT');
        return { id, updated: true };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function deleteProposta(id, pool) {
    const res = await pool.query(`DELETE FROM proposte WHERE id = $1 RETURNING id`, [id]);
    if (!res.rowCount) {
        const err = new Error(`Proposta ${id} non trovata`);
        err.status = 404;
        throw err;
    }
    return { id, deleted: true };
}

/**
 * Rimanda proposta (cliente o rep): rimandata_al = today + N giorni (default 30).
 */
async function rimandaProposta(id, pool, days = 30) {
    const res = await pool.query(
        `UPDATE proposte
         SET rimandata_al = (CURRENT_DATE + ($2::int)),
             stato = 'rimandata',
             data_modifica = NOW()
         WHERE id = $1
         RETURNING id, rimandata_al`,
        [id, days]
    );
    if (!res.rowCount) {
        const err = new Error(`Proposta ${id} non trovata`);
        err.status = 404;
        throw err;
    }
    await pool.query(
        `INSERT INTO proposta_eventi (proposta_id, evento, meta_json)
         VALUES ($1, 'rimandata', $2::jsonb)`,
        [id, JSON.stringify({ rimandata_al: res.rows[0].rimandata_al, days })]
    );
    return { id, rimandata_al: res.rows[0].rimandata_al };
}

async function riattivaProposta(id, pool) {
    const res = await pool.query(
        `UPDATE proposte
         SET rimandata_al = NULL,
             stato = 'pending',
             data_modifica = NOW()
         WHERE id = $1
         RETURNING id`,
        [id]
    );
    if (!res.rowCount) {
        const err = new Error(`Proposta ${id} non trovata`);
        err.status = 404;
        throw err;
    }
    await pool.query(
        `INSERT INTO proposta_eventi (proposta_id, evento, meta_json)
         VALUES ($1, 'riattivata', '{}'::jsonb)`,
        [id]
    );
    return { id, riattivata: true };
}

/**
 * Conferma manuale (rep chiude via modal WhatsApp / telefono / email / altro).
 * Payload: { canale: 'whatsapp|telefono|email|altro', note: string, chi: string }
 */
async function confermaManualeProposta(id, payload, pool) {
    const canale = String(payload.canale || 'altro').toLowerCase();
    if (!CANALI_CONFERMA_VALIDI.has(canale)) {
        const err = new Error(`canale_conferma non valido: ${canale}`);
        err.status = 400;
        throw err;
    }
    const note = payload.note ? String(payload.note).trim() : null;
    const chi = payload.chi ? String(payload.chi).trim() : null;

    const res = await pool.query(
        `UPDATE proposte
         SET stato = 'confermata_manualmente',
             canale_conferma = $2,
             note_conferma_manuale = $3,
             data_modifica = NOW()
         WHERE id = $1
         RETURNING id`,
        [id, canale, note]
    );
    if (!res.rowCount) {
        const err = new Error(`Proposta ${id} non trovata`);
        err.status = 404;
        throw err;
    }
    await pool.query(
        `INSERT INTO proposta_eventi (proposta_id, evento, meta_json)
         VALUES ($1, 'confermata_manualmente', $2::jsonb)`,
        [id, JSON.stringify({ canale, note, chi })]
    );
    return { id, stato: 'confermata_manualmente', canale };
}

/**
 * Lista proposte con filtri opzionali (sales_rep, stato, cliente_id).
 * Ritorna righe incluse (join lite su proposta_righe aggregate in JSON).
 */
async function listProposte(filters, pool) {
    const conds = [];
    const values = [];
    let idx = 1;
    if (filters.sales_rep) { conds.push(`p.sales_rep = $${idx++}`); values.push(String(filters.sales_rep).toLowerCase()); }
    if (filters.stato)     { conds.push(`p.stato = $${idx++}`);     values.push(String(filters.stato)); }
    if (filters.cliente_id){ conds.push(`p.cliente_id = $${idx++}`);values.push(parseInt(filters.cliente_id, 10)); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const { rows } = await pool.query(
        `SELECT p.*,
                c.cognome, c.nome, c.nome_azienda, c.email, c.cellulare, c.citta, c.regione,
                COALESCE(
                    (SELECT json_agg(json_build_object(
                        'id', pr.id,
                        'cod', pr.prodotto_cod,
                        'nome', pr.prodotto_nome,
                        'prezzo', pr.prezzo_unit,
                        'qty', pr.qty,
                        'origine', pr.origine
                    ) ORDER BY pr.id)
                     FROM proposta_righe pr
                     WHERE pr.proposta_id = p.id),
                    '[]'::json
                ) AS righe
         FROM proposte p
         LEFT JOIN crm_contatti c ON c.id = p.cliente_id
         ${where}
         ORDER BY p.data_creazione DESC`,
        values
    );
    return rows;
}

async function getProposta(id, pool) {
    const rows = await listProposte({}, pool);
    return rows.find(r => r.id == id) || null;
}

module.exports = {
    MITTENTI_RULES,
    STATI_VALIDI,
    CANALI_CONFERMA_VALIDI,
    validateProposta,
    getOrCreatePortale,
    createProposta,
    updateProposta,
    deleteProposta,
    rimandaProposta,
    riattivaProposta,
    confermaManualeProposta,
    listProposte,
    getProposta,
};
