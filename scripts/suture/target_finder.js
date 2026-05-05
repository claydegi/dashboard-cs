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
            const regNorm = normalizeRegion(c.regione);
            let regRep = 'admin';
            if (kimRegs.has(regNorm)) regRep = 'kim';
            else if (dettoRegs.has(regNorm)) regRep = 'detto';

            if (ov) {
                // Excel analisi_vendite (piu' forte): assegnazione certa
                c._assigned_to = ov.sales_rep;          // 'kim' | 'detto' | 'admin'
                c._assigned_source = 'excel';
                c._assigned_excel_raw = ov.invoice_user_odoo_name || null;
                // Mismatch: Excel != regione (regola #2 fuori-regione legittima,
                // ma admin va informato per eventuale verifica manuale)
                c._mismatch = (ov.sales_rep !== regRep) ? 'excel_vs_regione' : null;
                c._regione_rep = regRep;
            } else {
                // Cliente NON in cache Excel: fallback regione (regola #1)
                c._assigned_to = regRep;
                c._assigned_source = 'regione';
                c._assigned_excel_raw = null;
                // Confidenza inferiore: solo regione, no conferma Excel
                c._mismatch = 'no_excel_solo_regione';
                c._regione_rep = regRep;
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
    if (s === 'KIM' || s === 'KIM AGNELLO') return 'kim';
    if (s === 'DETTO' || s === 'MASSIMO' || s === 'MASSIMO DETTO') return 'detto';
    return 'admin';
}

/**
 * Legge clienti suture ATTIVI 2026 direttamente da Odoo via x_studio_agente.
 * Certezza 100%: ogni partner_id e' univoco in Odoo, agente e' campo strutturato.
 *
 * Ritorna: [{odoo_partner_id, partner_name, agente_name (KIM AGNELLO|MASSIMO DETTO|DIREZIONALE|null),
 *            agente_internal (kim|detto|admin), ultima_data_order, total_orders, crm_match }]
 *
 * crm_match: { id, email, citta, regione } se matchato in crm_contatti via email, altrimenti null.
 */
async function getActiveSutureClients2026(pool, odooClient) {
    const uid = await odooClient.authenticate();
    // 1. Prodotti categoria SUTURE
    const prodIds = await odooClient.execute(uid, 'product.product', 'search', [[['categ_id', '=', 38]]], {});
    if (!prodIds.length) return [];
    // 2. Righe ordine 2026 con suture
    const solIds = await odooClient.execute(uid, 'sale.order.line', 'search',
        [[['product_id', 'in', prodIds], ['order_id.date_order', '>=', '2026-01-01']]], {});
    if (!solIds.length) return [];
    const solData = await odooClient.execute(uid, 'sale.order.line', 'read', [solIds], { fields: ['order_id'] });
    const orderIds = Array.from(new Set(solData.map(l => Array.isArray(l.order_id) ? l.order_id[0] : null).filter(Boolean)));
    // 3. Ordini con partner + agente + data
    const orders = await odooClient.execute(uid, 'sale.order', 'read', [orderIds],
        { fields: ['name', 'partner_id', 'x_studio_agente', 'date_order'] });
    // 4. Aggregazione per partner: ultimo agente, conta ordini
    const byPartner = new Map();
    for (const o of orders) {
        const pid = Array.isArray(o.partner_id) ? o.partner_id[0] : null;
        if (!pid) continue;
        const pname = o.partner_id[1];
        const agenteRaw = o.x_studio_agente;
        const agenteName = (agenteRaw && Array.isArray(agenteRaw)) ? agenteRaw[1] : null;
        const date = o.date_order || '';
        const ex = byPartner.get(pid);
        if (!ex || date > ex.ultima_data_order) {
            byPartner.set(pid, {
                odoo_partner_id: pid,
                partner_name: pname,
                agente_name: agenteName,
                agente_internal: mapExcelRepToInternal(agenteName),
                ultima_data_order: date,
                total_orders: (ex ? ex.total_orders : 0) + 1,
            });
        } else {
            ex.total_orders++;
        }
    }
    const partners = Array.from(byPartner.values());
    // 5. Match con crm_contatti via email (per arricchire con dati CRM locali)
    const partnerIds = partners.map(p => p.odoo_partner_id);
    const odooPartners = await odooClient.execute(uid, 'res.partner', 'read', [partnerIds], { fields: ['id', 'email', 'name'] });
    const emailByOdooId = new Map();
    for (const p of odooPartners) {
        if (p.email) emailByOdooId.set(p.id, String(p.email).toLowerCase().trim());
    }
    const emails = Array.from(new Set(emailByOdooId.values())).filter(Boolean);
    let emailToCrm = new Map();
    if (emails.length) {
        const { rows: ccRows } = await pool.query(
            `SELECT id, email, citta, regione, cognome, nome, nome_azienda
             FROM crm_contatti
             WHERE LOWER(TRIM(email)) = ANY($1::text[])`,
            [emails]
        );
        for (const r of ccRows) {
            if (r.email) emailToCrm.set(String(r.email).toLowerCase().trim(), r);
        }
    }
    for (const p of partners) {
        const em = emailByOdooId.get(p.odoo_partner_id);
        const crm = em ? emailToCrm.get(em) : null;
        p.crm_match = crm ? {
            id: crm.id, email: crm.email, citta: crm.citta, regione: crm.regione,
            cognome: crm.cognome, nome: crm.nome, nome_azienda: crm.nome_azienda
        } : null;
        p.email = em || null;
    }
    return partners;
}

/**
 * Restituisce { attivi, dormienti } per il rep.
 * Attivi: clienti suture 2026 da Odoo (certezza 100%).
 * Dormienti: clienti CRM con suture ma SENZA vendite 2026 in Odoo (assegnazione da regione).
 */
async function getClientsForRepV2(rep, pool, odooClient) {
    const repKey = String(rep || '').toLowerCase();
    const allActive = await getActiveSutureClients2026(pool, odooClient);
    // Filtra attivi per rep (admin = tutti)
    const attivi = repKey === 'admin'
        ? allActive
        : allActive.filter(c => c.agente_internal === repKey);

    // Dormienti: tutti i CRM con suture, esclusi quelli matchati negli attivi (via email)
    const matchedCrmIds = new Set(allActive.filter(a => a.crm_match).map(a => a.crm_match.id));
    const regions = getRegionsForRep(repKey);
    const isAdmin = repKey === 'admin';

    const { rows: crmAll } = await pool.query(
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
         ORDER BY c.cognome NULLS LAST, c.nome NULLS LAST`
    );

    const dormienti = crmAll.filter(c => {
        if (matchedCrmIds.has(c.id)) return false; // gia' attivo
        if (isAdmin) return true;
        const regNorm = normalizeRegion(c.regione);
        if (repKey === 'kim') return regions.map(normalizeRegion).includes(regNorm);
        if (repKey === 'detto') return regions.map(normalizeRegion).includes(regNorm);
        return false;
    }).map(c => {
        const regNorm = normalizeRegion(c.regione);
        const kimRegs = new Set(getRegionsForRep('kim'));
        const dettoRegs = new Set(getRegionsForRep('detto'));
        const regRep = kimRegs.has(regNorm) ? 'kim' : (dettoRegs.has(regNorm) ? 'detto' : 'admin');
        c._assigned_to = regRep;
        c._assigned_source = 'regione';
        return c;
    });

    return { attivi, dormienti };
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

/**
 * Restituisce TUTTI i partner Odoo italiani con almeno una fattura cliente
 * OSNRGY emessa (out_invoice posted) dal 2026-01-01 a oggi, qualunque prodotto.
 *
 * Universo del Blocco 1 univocita' MyOSSEOTOUCH (decisione "strada 3" 2026-05-05):
 * non solo i ~47 clienti suture, ma i ~275 dentisti italiani che hanno fatturato
 * nel 2026. Permette consolidamento `odoo_partner_id` cross-agente.
 *
 * Schema output identico a getActiveSutureClients2026 per riusare la stessa
 * UI rendering: odoo_partner_id, partner_name, agente_name, agente_internal,
 * ultima_data_order, total_orders, crm_match, email.
 *
 * agente_name letto dall'ULTIMO sale.order 2026 del partner (se esiste);
 * fallback DIREZIONALE/admin se il partner ha solo fatture senza SO.
 */
async function getActiveItalianClients2026(pool, odooClient) {
    const uid = await odooClient.authenticate();
    const DATE_FROM = '2026-01-01';
    const COMPANY_ID = 1; // OSNRGY

    // 1. Fatture clienti OSNRGY 2026 posted
    const invoiceIds = await odooClient.execute(uid, 'account.move', 'search',
        [[['move_type', '=', 'out_invoice'],
          ['state', '=', 'posted'],
          ['invoice_date', '>=', DATE_FROM],
          ['company_id', '=', COMPANY_ID]]], {});
    if (!invoiceIds.length) return [];

    const invoices = await odooClient.execute(uid, 'account.move', 'read', [invoiceIds],
        { fields: ['id', 'partner_id', 'invoice_date'] });

    // 2. Aggrega per partner: ultima fattura, conta totale
    const byPartner = new Map();
    for (const inv of invoices) {
        const pid = Array.isArray(inv.partner_id) ? inv.partner_id[0] : null;
        if (!pid) continue;
        const pname = inv.partner_id[1];
        const date = inv.invoice_date || '';
        const ex = byPartner.get(pid);
        if (!ex || date > ex.ultima_data_order) {
            byPartner.set(pid, {
                odoo_partner_id: pid,
                partner_name: pname,
                ultima_data_order: date,
                total_orders: (ex ? ex.total_orders : 0) + 1,
            });
        } else {
            ex.total_orders++;
        }
    }

    // 3. Leggi partner: country, email, vat, citta, provincia
    const partnerIds = Array.from(byPartner.keys());
    const odooPartners = await odooClient.execute(uid, 'res.partner', 'read', [partnerIds],
        { fields: ['id', 'email', 'name', 'country_id', 'vat', 'city', 'state_id'] });

    const italianIds = new Set();
    const emailByOdooId = new Map();
    const partnerExtra = new Map();
    for (const p of odooPartners) {
        const cid = p.country_id;
        const cname = (cid && Array.isArray(cid)) ? String(cid[1]).toLowerCase() : '';
        // Italia o country mancante (default Italia per Odoo OSNRGY)
        if (!cid || cname === 'italy' || cname === 'italia') {
            italianIds.add(p.id);
            if (p.email) emailByOdooId.set(p.id, String(p.email).toLowerCase().trim());
            const stateName = (p.state_id && Array.isArray(p.state_id)) ? p.state_id[1] : null;
            partnerExtra.set(p.id, {
                vat: p.vat || null,
                city: p.city || null,
                state_name: stateName, // es. "Milano (MI)" — Odoo Italia ha le province come "states"
            });
        }
    }

    // 4. Lista solo italiani, in ordine di partner_name
    const italianPartners = partnerIds
        .filter(pid => italianIds.has(pid))
        .map(pid => {
            const obj = byPartner.get(pid);
            const extra = partnerExtra.get(pid) || {};
            obj.vat = extra.vat;
            obj.city = extra.city;
            obj.state_name = extra.state_name;
            return obj;
        });

    // 5. x_studio_agente dall'ultimo sale.order 2026 di ogni partner (se esiste)
    if (italianPartners.length) {
        const ipIds = italianPartners.map(p => p.odoo_partner_id);
        const orderIds = await odooClient.execute(uid, 'sale.order', 'search',
            [[['partner_id', 'in', ipIds],
              ['date_order', '>=', DATE_FROM]]], {});
        const agenteByPartner = new Map();
        if (orderIds.length) {
            const orders = await odooClient.execute(uid, 'sale.order', 'read', [orderIds],
                { fields: ['partner_id', 'x_studio_agente', 'date_order'] });
            for (const o of orders) {
                const pid = Array.isArray(o.partner_id) ? o.partner_id[0] : null;
                if (!pid) continue;
                const date = o.date_order || '';
                const agenteRaw = o.x_studio_agente;
                const agenteName = (agenteRaw && Array.isArray(agenteRaw)) ? agenteRaw[1] : null;
                const ex = agenteByPartner.get(pid);
                if (!ex || date > ex.date) {
                    agenteByPartner.set(pid, { date, agenteName });
                }
            }
        }
        for (const p of italianPartners) {
            const ag = agenteByPartner.get(p.odoo_partner_id);
            const agenteName = ag ? ag.agenteName : null;
            p.agente_name = agenteName;
            p.agente_internal = mapExcelRepToInternal(agenteName);
        }
    }

    // 6. Match CRM via email primaria
    const emails = Array.from(new Set(Array.from(emailByOdooId.values()))).filter(Boolean);
    let emailToCrm = new Map();
    if (emails.length) {
        const { rows: ccRows } = await pool.query(
            `SELECT id, email, citta, regione, cognome, nome, nome_azienda
             FROM crm_contatti
             WHERE LOWER(TRIM(email)) = ANY($1::text[])`,
            [emails]
        );
        for (const r of ccRows) {
            if (r.email) emailToCrm.set(String(r.email).toLowerCase().trim(), r);
        }
    }
    for (const p of italianPartners) {
        const em = emailByOdooId.get(p.odoo_partner_id);
        const crm = em ? emailToCrm.get(em) : null;
        p.crm_match = crm ? {
            id: crm.id, email: crm.email, citta: crm.citta, regione: crm.regione,
            cognome: crm.cognome, nome: crm.nome, nome_azienda: crm.nome_azienda
        } : null;
        p.email = em || null;
    }

    // 7. Ordine alfabetico per nome partner
    italianPartners.sort((a, b) =>
        String(a.partner_name || '').localeCompare(String(b.partner_name || ''), 'it', { sensitivity: 'base' })
    );
    return italianPartners;
}

/**
 * Variante di getClientsForRepV2 con parametro `universo`:
 *   - universo === 'italiani-2026' → ritorna i 275 partner italiani 2026 in `attivi`,
 *     `dormienti = []`. Usato dalla card MyOsseotouch (Blocco 1 univocita').
 *   - default → comportamento esistente (47 clienti suture + dormienti CRM).
 */
async function getClientsForRepV2Universo(rep, pool, odooClient, universo) {
    if (String(universo || '').toLowerCase() === 'italiani-2026') {
        const allItalian = await getActiveItalianClients2026(pool, odooClient);
        const repKey = String(rep || '').toLowerCase();
        const attivi = repKey === 'admin'
            ? allItalian
            : allItalian.filter(c => c.agente_internal === repKey);
        return { attivi, dormienti: [] };
    }
    return getClientsForRepV2(rep, pool, odooClient);
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
    getActiveSutureClients2026,
    getActiveItalianClients2026,
    getClientsForRepV2,
    getClientsForRepV2Universo,
};
