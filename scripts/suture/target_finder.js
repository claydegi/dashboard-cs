/**
 * SUTURE · TARGET FINDER — Modulo 1/5 agente SUTURE (lato vendita)
 *
 * Identifica i clienti "suture" visibili a ciascun sales rep applicando la
 * regola composita (brief sez. 7):
 *   Regola #1 (primaria) — per regione: config DASHBOARD CS/data/sales_rep_regions.json
 *   Regola #2 (secondaria, piu' forte) — override fuori-regione: ultimo Sales Rep
 *     Excel `analisi_vendite/ordini_excel/[Mese]/ORDINI_*.xlsx` col. "Sales Rep"
 *     (KIM / DETTO / DIREZIONALE), cached nella tabella partner_sales_rep.
 *     Popolata da script Python locale via POST /api/suture/sync-sales-rep-overrides.
 *
 * Aggregazione finale per rep = Regola #1 UNION Regola #2
 * (filtrato su account con record in crm_prodotti WHERE prodotto='SUTURE').
 *
 * Lezione 2026-04-24 (Blocco 1.5): MAI usare Odoo `invoice_user_id` come fonte
 * per la regola #2 — il brief lo vieta. La fonte autoritativa per sales rep
 * cliente e' sempre l'Excel di analisi_vendite.
 *
 * Test di accettazione (1.5 nel piano):
 *   getClientsForRep('kim', pool) deve restituire ESATTAMENTE i 154 clienti
 *   validati dal mockup SUTURE/_test-locale/_build_test_kim.py al 2026-04-24
 *   (131 regola #1 + 23 regola #2).
 *
 * Riferimento: SUTURE/BRIEF_IMPLEMENTAZIONE.md sez. 7 · SUTURE/PIANO_FASE1.md Blocco 1.5
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REGIONS_CONFIG_PATH = path.join(__dirname, '..', '..', 'data', 'sales_rep_regions.json');

let _cachedConfig = null;
function loadRegionsConfig() {
    if (_cachedConfig) return _cachedConfig;
    const raw = fs.readFileSync(REGIONS_CONFIG_PATH, 'utf8');
    _cachedConfig = JSON.parse(raw);
    return _cachedConfig;
}

// Normalizzazione regione: UPPERCASE + trim + apostrofi unificati + alias lookup.
// Il DB contiene regioni in UPPERCASE ("LIGURIA", "EMILIA-ROMAGNA").
// Il config JSON le tiene in Title Case ("Liguria", "Emilia-Romagna") per leggibilita'.
function normalizeRegion(str) {
    if (str === null || str === undefined) return '';
    let s = String(str);
    s = s.replace(/[\u2018\u2019\u02BC]/g, "'");
    s = s.replace(/\s+/g, ' ').trim().toUpperCase();
    return s;
}

// Applica alias del config (es. "EMILIA ROMAGNA" senza trattino → "EMILIA-ROMAGNA")
function applyRegionAlias(normalized) {
    const config = loadRegionsConfig();
    const aliases = (config.matching && config.matching.aliases) || {};
    for (const [alias, canonical] of Object.entries(aliases)) {
        if (normalizeRegion(alias) === normalized) return normalizeRegion(canonical);
    }
    return normalized;
}

/**
 * Restituisce array di nomi regione (normalized UPPERCASE) per il rep dato.
 * Per 'admin': tutte le regioni italiane NON coperte dagli altri rep.
 */
function getRegionsForRep(rep) {
    const config = loadRegionsConfig();
    const key = String(rep || '').toLowerCase();
    const repData = config.rep[key];
    if (!repData) throw new Error(`Unknown sales rep: ${rep}`);

    if (repData.regioni_default) {
        // Admin: vista completa parco clienti (brief sez. 4) → TUTTE le 20 regioni italiane
        return config.regioni_italiane_tutte.map(normalizeRegion);
    }
    return (repData.regioni || []).map(normalizeRegion);
}

/**
 * Regola #1 (primaria): account con suture la cui regione è assegnata al rep.
 * Case-insensitive via UPPER() in SQL, match contro array normalizzato.
 */
async function getRule1Clients(rep, pool) {
    const regions = getRegionsForRep(rep);
    if (!regions.length) return [];
    const { rows } = await pool.query(
        `SELECT DISTINCT c.id, c.cognome, c.nome, c.email, c.telefono, c.cellulare,
                c.citta, c.regione, c.nome_azienda,
                EXISTS (
                    SELECT 1 FROM proposte pr
                    WHERE pr.cliente_id = c.id
                      AND pr.stato = 'pending'
                      AND (pr.rimandata_al IS NULL OR pr.rimandata_al <= CURRENT_DATE)
                ) AS has_active_proposal
         FROM crm_contatti c
         JOIN crm_prodotti p ON p.contatto_id = c.id
         WHERE p.prodotto = 'SUTURE'
           AND (c.tipo = 'account' OR c.tipo IS NULL)
           AND UPPER(TRIM(COALESCE(c.regione, ''))) = ANY($1::text[])
         ORDER BY c.regione, c.cognome NULLS LAST, c.nome NULLS LAST`,
        [regions]
    );
    return rows;
}

/**
 * Regola #2 (secondaria): override fuori-regione. Legge da partner_sales_rep
 * (cache popolata da syncSalesRepOverridesFromPayload, fonte Excel analisi_vendite).
 * Ritorna SOLO gli account che NON sarebbero già coperti dalla regola #1
 * (cioè con regione fuori dal territorio del rep). Se cache vuota → array vuoto.
 */
async function getRule2Overrides(rep, pool) {
    const key = String(rep || '').toLowerCase();
    const regions = getRegionsForRep(rep);
    const { rows } = await pool.query(
        `SELECT DISTINCT c.id, c.cognome, c.nome, c.email, c.telefono, c.cellulare,
                c.citta, c.regione, c.nome_azienda,
                psr.invoice_user_odoo_name AS excel_sales_rep_raw,
                psr.ultima_fattura_suture_date,
                EXISTS (
                    SELECT 1 FROM proposte pr
                    WHERE pr.cliente_id = c.id
                      AND pr.stato = 'pending'
                      AND (pr.rimandata_al IS NULL OR pr.rimandata_al <= CURRENT_DATE)
                ) AS has_active_proposal
         FROM crm_contatti c
         JOIN partner_sales_rep psr ON psr.contatto_id = c.id
         JOIN crm_prodotti p ON p.contatto_id = c.id
         WHERE psr.sales_rep = $1
           AND p.prodotto = 'SUTURE'
           AND (c.tipo = 'account' OR c.tipo IS NULL)
           AND UPPER(TRIM(COALESCE(c.regione, ''))) <> ALL($2::text[])
         ORDER BY c.regione, c.cognome NULLS LAST, c.nome NULLS LAST`,
        [key, regions]
    );
    return rows;
}

/**
 * Aggregazione finale: UNION di #1 + #2, distinti per id, con flag _via_rule2.
 * Per admin (vista completa): aggiunge anche `_assigned_to` (kim/detto/admin)
 * basato sulla cache partner_sales_rep (Excel, più forte) o sulla regione.
 */
async function getClientsForRep(rep, pool) {
    const r1 = await getRule1Clients(rep, pool);
    const r2 = await getRule2Overrides(rep, pool);
    const seen = new Set(r1.map(c => c.id));
    const union = r1.slice();
    for (const c of r2) {
        if (!seen.has(c.id)) {
            c._via_rule2 = true;
            union.push(c);
            seen.add(c.id);
        }
    }

    // Vista admin: arricchisce con etichetta assegnazione effettiva per ogni cliente
    if (String(rep).toLowerCase() === 'admin' && union.length) {
        const ids = union.map(c => c.id);
        const { rows: overrides } = await pool.query(
            `SELECT contatto_id, sales_rep, invoice_user_odoo_name
             FROM partner_sales_rep
             WHERE contatto_id = ANY($1::int[])`,
            [ids]
        );
        const overrideMap = new Map(overrides.map(o => [o.contatto_id, o]));
        const kimRegs = new Set(getRegionsForRep('kim'));
        const dettoRegs = new Set(getRegionsForRep('detto'));

        for (const c of union) {
            const ov = overrideMap.get(c.id);
            if (ov) {
                // Excel analisi_vendite (piu' forte): assegnazione certa
                c._assigned_to = ov.sales_rep;          // 'kim' | 'detto' | 'admin'
                c._assigned_source = 'excel';
                c._assigned_excel_raw = ov.invoice_user_odoo_name || null;
            } else {
                // Cliente non in Excel cache: fallback regione (regola #1)
                // Coerente con resolveSalesRepForCliente del portale cliente.
                // I casi specifici sbagliati (es. direzionale in regione Kim)
                // si risolvono completando il matching Excel (TODO B).
                const regNorm = normalizeRegion(c.regione);
                if (kimRegs.has(regNorm)) c._assigned_to = 'kim';
                else if (dettoRegs.has(regNorm)) c._assigned_to = 'detto';
                else c._assigned_to = 'admin';
                c._assigned_source = 'regione';
                c._assigned_excel_raw = null;
            }
        }
    }

    return union;
}

/**
 * Mapping etichetta Excel analisi_vendite → sales_rep logico Dashboard CS.
 *   KIM         → 'kim'
 *   DETTO       → 'detto'
 *   DIREZIONALE → 'admin'
 *   altro       → 'admin' (fallback sicuro)
 */
function mapExcelRepToInternal(excelLabel) {
    if (!excelLabel) return 'admin';
    const s = String(excelLabel).toUpperCase().trim();
    if (s === 'KIM') return 'kim';
    if (s === 'DETTO' || s === 'MASSIMO' || s === 'MASSIMO DETTO') return 'detto';
    return 'admin';
}

/**
 * Normalizzazione chiave nome per matching fuzzy: lowercase, strip diacritics,
 * rimuovi punteggiatura, collapse whitespace, trim. Pattern `build_name_keys`
 * del mockup Python `_build_test_kim.py`.
 */
function normalizeNameKey(s) {
    if (!s) return '';
    return String(s)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Popola la cache partner_sales_rep dal payload JSON prodotto dallo script
 * Python `analisi_vendite/build_sales_rep_overrides.py` (lettura Excel).
 *
 * Payload atteso:
 *   { clients: [
 *       { nome_cliente: "CECCHINI DR. LUCIO", sales_rep: "KIM",
 *         ultima_data_suture: "2026-03-15" },
 *       ...
 *   ] }
 *
 * Matching nome_cliente → crm_contatti.id:
 *   1. Indice keys da crm_contatti: nome_azienda, "cognome nome", "nome cognome", cognome
 *   2. normalizeNameKey applicato a entrambi i lati
 *   3. Se match trovato: UPSERT in partner_sales_rep
 *   4. Se no match: skip + sample diagnostica
 */
async function syncSalesRepOverridesFromPayload(pool, clients) {
    if (!Array.isArray(clients)) {
        throw new Error('syncSalesRepOverridesFromPayload: clients deve essere array');
    }

    const { rows: crmRows } = await pool.query(
        `SELECT id, email, nome_azienda, cognome, nome
         FROM crm_contatti
         WHERE tipo = 'account' OR tipo IS NULL`
    );

    const nameIndex = new Map();
    const emailIndex = new Map();
    for (const r of crmRows) {
        if (r.email) {
            const ek = String(r.email).toLowerCase().trim();
            if (ek && !emailIndex.has(ek)) emailIndex.set(ek, r.id);
        }
        const keys = [];
        if (r.nome_azienda) keys.push(normalizeNameKey(r.nome_azienda));
        if (r.cognome) {
            if (r.nome) {
                keys.push(normalizeNameKey(`${r.cognome} ${r.nome}`));
                keys.push(normalizeNameKey(`${r.nome} ${r.cognome}`));
            }
            keys.push(normalizeNameKey(r.cognome));
        }
        for (const k of keys) {
            if (k && !nameIndex.has(k)) nameIndex.set(k, r.id);
        }
    }

    let processed = 0;
    let updated = 0;
    let matched_by_name = 0;
    let matched_by_name_fuzzy = 0;
    let skipped_no_match = 0;
    const skipped_samples = [];

    for (const c of clients) {
        const nomeCliente = c && c.nome_cliente;
        const salesRepExcel = c && c.sales_rep;
        const ultimaData = c && c.ultima_data_suture;
        if (!nomeCliente || !salesRepExcel) continue;

        const nk = normalizeNameKey(nomeCliente);
        if (!nk) continue;

        let contattoId = null;

        if (nameIndex.has(nk)) {
            contattoId = nameIndex.get(nk);
            matched_by_name++;
        } else {
            // Fallback fuzzy: substring match bidirezionale con soglia 4 char.
            // Abbassata da 6 a 4 per recuperare clienti come "Xotta" (5 char),
            // "D'Angelosante" (13, ok) che prima non matchavano.
            // Allineamento al mockup Python _build_test_kim.py che usava
            // `len(nk) >= 6` ma con sorgente CRM (keys cognome+nome etc).
            if (nk.length >= 4) {
                for (const [indexKey, id] of nameIndex) {
                    if (indexKey.length >= 4 && (indexKey.includes(nk) || nk.includes(indexKey))) {
                        contattoId = id;
                        matched_by_name_fuzzy++;
                        break;
                    }
                }
            }
        }

        if (!contattoId) {
            skipped_no_match++;
            if (skipped_samples.length < 10) {
                skipped_samples.push({ nome_cliente: nomeCliente, sales_rep: salesRepExcel });
            }
            continue;
        }

        const repInternal = mapExcelRepToInternal(salesRepExcel);
        processed++;
        const res = await pool.query(
            `INSERT INTO partner_sales_rep (contatto_id, sales_rep, invoice_user_odoo_name, ultima_fattura_suture_date, last_refresh)
             VALUES ($1, $2, $3, $4::date, NOW())
             ON CONFLICT (contatto_id) DO UPDATE SET
                sales_rep = EXCLUDED.sales_rep,
                invoice_user_odoo_name = EXCLUDED.invoice_user_odoo_name,
                ultima_fattura_suture_date = EXCLUDED.ultima_fattura_suture_date,
                last_refresh = NOW()
             WHERE partner_sales_rep.sales_rep IS DISTINCT FROM EXCLUDED.sales_rep
                OR partner_sales_rep.ultima_fattura_suture_date IS DISTINCT FROM EXCLUDED.ultima_fattura_suture_date
             RETURNING contatto_id`,
            [contattoId, repInternal, String(salesRepExcel).toUpperCase(), ultimaData || null]
        );
        if (res.rowCount > 0) updated++;
    }

    return {
        input_count: clients.length,
        processed,
        updated,
        matched_by_name,
        matched_by_name_fuzzy,
        skipped_no_match,
        skipped_samples,
        last_refresh: new Date().toISOString(),
    };
}

module.exports = {
    loadRegionsConfig,
    normalizeRegion,
    applyRegionAlias,
    getRegionsForRep,
    getRule1Clients,
    getRule2Overrides,
    getClientsForRep,
    mapExcelRepToInternal,
    normalizeNameKey,
    syncSalesRepOverridesFromPayload,
};
