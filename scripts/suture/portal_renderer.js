/**
 * SUTURE · PORTAL RENDERER — Modulo 3/5 agente SUTURE (lato vendita)
 *
 * Genera la vista portale cliente servita su https://myosseotouch.com/portale/:token
 * e fornisce i dati (storico acquisti + proposte attive/rimandate + referente)
 * consumati dal frontend.
 *
 * Responsabilita':
 *   - Risoluzione token → cliente_id (lookup su portali_cliente WHERE attivo=true)
 *   - Lettura storico acquisti suture da Odoo (brief sez. 11):
 *     · SOLO data >= 2026-01-01
 *     · filtro HARD: numero_fattura != '000' (placeholder tentate vendite, non ordini reali)
 *     · se nessun acquisto 2026 ma esistono pre-2026: messaggio fallback "ultimo riordino [mese anno]"
 *   - Lettura proposte del cliente: attive (non rimandate) + rimandate (rimandata_al > today)
 *   - Dati referente (avatar monogramma, nome, email, cellulare, link wa.me)
 *   - Rendering HTML (basato su mockup SUTURE/_test-locale/portale-guzzo.html)
 *   - robots.txt Disallow + meta noindex,nofollow (brief sez. 13 sicurezza portale)
 *   - Modalita' ?mode=rep per visualizzazione sales rep con mini-barra azioni per-proposta
 *
 * Funzioni esportate:
 *   - getPortaleData(token, pool, odooClient)       → oggetto JSON completo per frontend
 *   - getStoricoSutureCliente(cliente_id, odooClient) → array acquisti 2026+ filtrato
 *   - renderPortaleHTML(data, mode)                 → string HTML pronta
 *   - resolveTokenToCliente(token, pool)            → cliente_id o null
 *
 * Riferimento: SUTURE/BRIEF_IMPLEMENTAZIONE.md sez. 11 · SUTURE/PIANO_FASE1.md Blocco 1.6 + 3
 */

'use strict';

/**
 * Risolve il token permanente in cliente_id. Restituisce { cliente_id, data_creazione }
 * se il portale e' attivo, null se inesistente o revocato.
 */
async function resolveTokenToCliente(token, pool) {
    if (!token || typeof token !== 'string') return null;
    // Validazione formato UUID lato input per evitare query inutili
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(token)) return null;
    const { rows } = await pool.query(
        `SELECT cliente_id, data_creazione
         FROM portali_cliente
         WHERE token = $1 AND attivo = TRUE`,
        [token]
    );
    if (!rows.length) return null;
    return { cliente_id: rows[0].cliente_id, data_creazione: rows[0].data_creazione };
}

/**
 * Storico acquisti suture del cliente. Legge da crm_acquisti (mirror di acquisti_ricorrenti
 * SalesForceFree SQLite, popolato da odoo_sync.py).
 *
 * Regole brief sez. 11:
 *   - Solo data_fattura >= 2026-01-01 (data start Odoo)
 *   - Filtro HARD: numero_fattura != '000' (placeholder tentate vendite manuali, non ordini reali)
 *   - Fallback: se nessun acquisto 2026 ma esistono pre-2026 → ritorna { ultimo_pre_2026: 'YYYY-MM' }
 *   - Dati pre-2026 NON esposti in dettaglio (solo mese/anno di riferimento)
 *
 * Ritorno: {
 *   acquisti: [{id, numero_fattura, data_fattura, quantita, descrizione, fonte}, ...],
 *   totale_confezioni_2026, ultimo_acquisto_2026,
 *   ultimo_pre_2026_label (solo se acquisti [] e pre-2026 esiste, es. "marzo 2025")
 * }
 */
async function getStoricoSutureCliente(cliente_id, pool) {
    if (!cliente_id) throw new Error('getStoricoSutureCliente: cliente_id richiesto');

    const { rows: acquisti } = await pool.query(
        `SELECT id, numero_fattura, data_fattura, quantita, descrizione, fonte
         FROM crm_acquisti
         WHERE contatto_id = $1
           AND prodotto = 'SUTURE'
           AND numero_fattura IS DISTINCT FROM '000'
           AND data_fattura >= '2026-01-01'
         ORDER BY data_fattura DESC, id DESC`,
        [cliente_id]
    );

    if (acquisti.length > 0) {
        const totale = acquisti.reduce((acc, a) => acc + (parseInt(a.quantita, 10) || 0), 0);
        return {
            acquisti,
            totale_confezioni_2026: totale,
            ultimo_acquisto_2026: acquisti[0].data_fattura,
            ultimo_pre_2026_label: null,
        };
    }

    // Nessun acquisto 2026 → cerca pre-2026 per fallback label
    const { rows: pre } = await pool.query(
        `SELECT MAX(data_fattura) AS ultimo_pre
         FROM crm_acquisti
         WHERE contatto_id = $1
           AND prodotto = 'SUTURE'
           AND numero_fattura IS DISTINCT FROM '000'
           AND data_fattura < '2026-01-01'`,
        [cliente_id]
    );
    const ultimoPre = pre[0] && pre[0].ultimo_pre ? String(pre[0].ultimo_pre) : null;

    return {
        acquisti: [],
        totale_confezioni_2026: 0,
        ultimo_acquisto_2026: null,
        ultimo_pre_2026_label: ultimoPre ? formatMeseAnnoIt(ultimoPre) : null,
    };
}

const MESI_IT = [
    'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
];

function formatMeseAnnoIt(dateStr) {
    // accetta 'YYYY-MM-DD' o sottostringa ISO — prende solo i primi 7 char
    const s = String(dateStr).slice(0, 7);
    const m = s.match(/^(\d{4})-(\d{2})/);
    if (!m) return null;
    const year = m[1];
    const monthIdx = parseInt(m[2], 10) - 1;
    if (monthIdx < 0 || monthIdx > 11) return null;
    return `${MESI_IT[monthIdx]} ${year}`;
}

// TODO (Blocco 3): aggregazione completa portale (referente + proposte + storico)
async function getPortaleData(token, pool, odooClient) {
    throw new Error('TODO: implementare in Blocco 3');
}

// TODO (Blocco 3): rendering HTML del portale (template basato su mockup Guzzo)
function renderPortaleHTML(data, mode) {
    throw new Error('TODO: implementare in Blocco 3');
}

module.exports = {
    resolveTokenToCliente,
    getStoricoSutureCliente,
    getPortaleData,
    renderPortaleHTML,
};
