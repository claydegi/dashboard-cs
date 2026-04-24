/**
 * SUTURE · TARGET FINDER — Modulo 1/5 agente SUTURE (lato vendita)
 *
 * Identifica i clienti "suture" visibili a ciascun sales rep applicando la
 * regola composita (brief sez. 7):
 *   Regola #1 (primaria) — per regione: config DASHBOARD CS/data/sales_rep_regions.json
 *   Regola #2 (secondaria) — override fuori-regione: invoice_user_id Odoo delle fatture
 *     suture del cliente, cached nella tabella partner_sales_rep
 *
 * Aggregazione finale per rep = Regola #1 UNION Regola #2
 * (filtrato su account con record in crm_prodotti WHERE prodotto='SUTURE').
 *
 * Test di accettazione (1.5 nel piano):
 *   getClientsForRep('kim', pool) deve restituire ESATTAMENTE i 154 clienti
 *   validati dal mockup SUTURE/_test-locale/_build_test_kim.py al 2026-04-24
 *   (131 regola #1 + 23 regola #2). Richiede cache partner_sales_rep popolata.
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
    // Normalizza apostrofi curly → dritto (Valle d'Aosta vs Valle d'Aosta)
    s = s.replace(/[\u2018\u2019\u02BC]/g, "'");
    // Trim + collapse whitespace + uppercase
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
        // Admin: tutte le regioni NON coperte dagli altri rep con regioni esplicite
        const covered = new Set();
        for (const [k, v] of Object.entries(config.rep)) {
            if (k === key || v.regioni_default) continue;
            (v.regioni || []).forEach(r => covered.add(normalizeRegion(r)));
        }
        return config.regioni_italiane_tutte
            .map(normalizeRegion)
            .filter(r => !covered.has(r));
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
                c.citta, c.regione, c.nome_azienda
         FROM crm_contatti c
         JOIN crm_prodotti p ON p.contatto_id = c.id
         WHERE p.prodotto = 'SUTURE'
           AND c.tipo = 'account'
           AND UPPER(TRIM(COALESCE(c.regione, ''))) = ANY($1::text[])
         ORDER BY c.regione, c.cognome NULLS LAST, c.nome NULLS LAST`,
        [regions]
    );
    return rows;
}

/**
 * Regola #2 (secondaria): override fuori-regione. Legge da partner_sales_rep
 * (cache popolata da refreshPartnerSalesRepCache) incrociata con crm_prodotti.
 * Ritorna SOLO gli account che NON sarebbero gia' coperti dalla regola #1
 * (cioe' con regione fuori dal territorio del rep). Se cache vuota → array vuoto.
 */
async function getRule2Overrides(rep, pool) {
    const key = String(rep || '').toLowerCase();
    const regions = getRegionsForRep(rep);
    const { rows } = await pool.query(
        `SELECT DISTINCT c.id, c.cognome, c.nome, c.email, c.telefono, c.cellulare,
                c.citta, c.regione, c.nome_azienda,
                psr.invoice_user_odoo_name, psr.ultima_fattura_suture_date
         FROM crm_contatti c
         JOIN partner_sales_rep psr ON psr.contatto_id = c.id
         JOIN crm_prodotti p ON p.contatto_id = c.id
         WHERE psr.sales_rep = $1
           AND p.prodotto = 'SUTURE'
           AND c.tipo = 'account'
           AND UPPER(TRIM(COALESCE(c.regione, ''))) <> ALL($2::text[])
         ORDER BY c.regione, c.cognome NULLS LAST, c.nome NULLS LAST`,
        [key, regions]
    );
    return rows;
}

/**
 * Aggregazione finale: UNION di #1 + #2, distinti per id, con flag _via_rule2.
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
    return union;
}

/**
 * Popola la cache partner_sales_rep leggendo Odoo.
 * Per ogni partner con almeno una fattura (account.move tipo out_invoice posted)
 * che contenga articoli categoria 38 (suture), prende l'ultimo invoice_user_id.name
 * e lo mappa al rep corrispondente via config sales_rep_regions.json.
 *
 * odooClient deve esporre: { authenticate() -> uid, execute(uid, model, method, args, kwargs) }
 *
 * Mapping user Odoo → rep (basato sulla stringa invoice_user_odoo_name):
 *   - contiene 'kim' o 'agnello'    → 'kim'
 *   - contiene 'detto' o 'massimo'  → 'detto'
 *   - 'direzionale' o altri         → 'admin'
 */
function mapOdooUserToRep(odooUserName) {
    if (!odooUserName) return 'admin';
    const lower = String(odooUserName).toLowerCase();
    if (lower.includes('kim') || lower.includes('agnello')) return 'kim';
    if (lower.includes('detto') || lower.includes('massimo')) return 'detto';
    return 'admin';
}

async function refreshPartnerSalesRepCache(pool, odooClient) {
    if (!odooClient || typeof odooClient.authenticate !== 'function' || typeof odooClient.execute !== 'function') {
        throw new Error('refreshPartnerSalesRepCache: odooClient con {authenticate, execute} richiesto');
    }
    const uid = await odooClient.authenticate();

    // 1) Prodotti categoria SUTURE (ID=38)
    const productIds = await odooClient.execute(uid, 'product.product', 'search', [[['categ_id', '=', 38]]], {});
    if (!productIds || !productIds.length) {
        return { processed: 0, updated: 0, note: 'Nessun prodotto categoria 38 trovato' };
    }

    // 2) Righe fatture che contengono questi prodotti, fatture posted, tipo out_invoice
    const moveLines = await odooClient.execute(
        uid, 'account.move.line', 'search_read',
        [[
            ['product_id', 'in', productIds],
            ['move_id.state', '=', 'posted'],
            ['move_id.move_type', '=', 'out_invoice'],
        ]],
        { fields: ['move_id', 'partner_id', 'date'] }
    );
    if (!moveLines || !moveLines.length) {
        return { processed: 0, updated: 0, note: 'Nessuna fattura suture posted' };
    }

    // 3) Aggrega per partner_id: prendi la fattura piu' recente
    const byPartner = new Map();
    const moveIds = new Set();
    for (const ln of moveLines) {
        const [partnerId, partnerName] = ln.partner_id || [null, null];
        if (!partnerId) continue;
        const dateStr = ln.date || '';
        const current = byPartner.get(partnerId);
        if (!current || dateStr > current.date) {
            byPartner.set(partnerId, {
                partner_id: partnerId,
                partner_name: partnerName,
                date: dateStr,
                move_id: Array.isArray(ln.move_id) ? ln.move_id[0] : ln.move_id,
            });
        }
        if (Array.isArray(ln.move_id)) moveIds.add(ln.move_id[0]);
    }

    // 4) Recupera invoice_user_id per ogni account.move piu' recente per partner
    const uniqueMoveIds = Array.from(new Set(
        Array.from(byPartner.values()).map(v => v.move_id).filter(Boolean)
    ));
    const moves = await odooClient.execute(
        uid, 'account.move', 'read',
        [uniqueMoveIds, ['invoice_user_id']],
        {}
    );
    const userByMoveId = new Map();
    for (const m of moves) {
        const uv = m.invoice_user_id;
        userByMoveId.set(m.id, Array.isArray(uv) ? uv[1] : null);
    }

    // 5) Leggi res.partner da Odoo (id, name, email) per i partner_id raccolti.
    //    partner_id Odoo NON coincide con crm_contatti.id (che e' un PK locale SQLite->Postgres
    //    generato da SalesForceFree). Il matching corretto e' via email (UNIQUE in schema
    //    SalesForceFree) o, come fallback, nome normalizzato (nome_azienda / cognome + nome).
    //    Lezione 2026-04-24: secondo run cache ha esposto questa assunzione (47/47 skippati
    //    con FK fix, tutti dentisti italiani legittimi ma con id Odoo != id CRM).
    const partnerIds = Array.from(byPartner.keys());
    const odooPartners = await odooClient.execute(
        uid, 'res.partner', 'read',
        [partnerIds, ['id', 'name', 'email']],
        {}
    );
    const partnerById = new Map();
    for (const p of odooPartners) partnerById.set(p.id, p);

    // 6) Pre-carica indici di matching da crm_contatti.
    //    Scan completo una volta; le query successive sono O(1) via Map.
    const { rows: crmRows } = await pool.query(
        `SELECT id, email, nome_azienda, cognome, nome FROM crm_contatti WHERE tipo = 'account' OR tipo IS NULL`
    );
    const emailIndex = new Map();
    const nameIndex = new Map();
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

    // 7) Matching partner Odoo -> contatto_id locale + UPSERT
    let processed = 0;
    let updated = 0;
    let matched_by_email = 0;
    let matched_by_name = 0;
    let skipped_no_match = 0;
    const skipped_samples = [];
    for (const [partnerId, info] of byPartner) {
        const partner = partnerById.get(partnerId);
        const partnerName = (partner && partner.name) || info.partner_name || null;
        const partnerEmail = (partner && partner.email) || null;

        let contattoId = null;
        let matchedBy = null;

        if (partnerEmail) {
            const ek = String(partnerEmail).toLowerCase().trim();
            if (ek && emailIndex.has(ek)) {
                contattoId = emailIndex.get(ek);
                matchedBy = 'email';
            }
        }
        if (!contattoId && partnerName) {
            const nk = normalizeNameKey(partnerName);
            if (nk && nameIndex.has(nk)) {
                contattoId = nameIndex.get(nk);
                matchedBy = 'name';
            }
        }

        if (!contattoId) {
            skipped_no_match++;
            if (skipped_samples.length < 5) {
                skipped_samples.push({
                    partner_id: partnerId,
                    partner_name: partnerName,
                    partner_email: partnerEmail,
                });
            }
            continue;
        }

        if (matchedBy === 'email') matched_by_email++;
        else matched_by_name++;

        const odooUserName = userByMoveId.get(info.move_id) || null;
        const rep = mapOdooUserToRep(odooUserName);
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
            [contattoId, rep, odooUserName, info.date || null]
        );
        if (res.rowCount > 0) updated++;
    }

    return {
        processed,
        updated,
        matched_by_email,
        matched_by_name,
        skipped_no_match,
        skipped_samples,
        partners_with_suture: byPartner.size,
        last_refresh: new Date().toISOString(),
    };
}

// Normalizzazione chiave nome per matching fuzzy: lowercase, rimuovi punteggiatura,
// collapse whitespace, trim. Ispirata a build_name_keys del mockup Python.
function normalizeNameKey(s) {
    if (!s) return '';
    return String(s)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip diacritics
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

module.exports = {
    loadRegionsConfig,
    normalizeRegion,
    applyRegionAlias,
    getRegionsForRep,
    getRule1Clients,
    getRule2Overrides,
    getClientsForRep,
    mapOdooUserToRep,
    refreshPartnerSalesRepCache,
};
