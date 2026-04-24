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

// Metadata referente per sales_rep (email + cellulare WhatsApp + avatar iniziali).
// Numeri cellulari da popolare dall'imprenditore (per ora placeholder vuoti -> bottone WhatsApp nascosto).
// Config referente per sales_rep. Per admin (clienti DIREZIONALE) il WhatsApp + email
// sono quelli del customer service OSSEOTOUCH (non di Kim o Detto).
// Cellulari Kim/Detto da popolare dall'imprenditore (per ora placeholder → bottone WA nascosto).
const REFERENTE_META = {
    kim:   { nome: 'Kim Agnello',   email: 'kagnello@osseotouch.com', cellulare: '+39 338 7351260', iniziali: 'KA' },
    detto: { nome: 'Massimo Detto', email: 'mdetto@osseotouch.com',   cellulare: '+39 334 9049883', iniziali: 'MD' },
    admin: { nome: 'Customer Service OSSEOTOUCH', email: 'contact@osseotouch.com', cellulare: '+39 327 794 7530', iniziali: 'CS' },
};

function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function fmtEuro(n) {
    const v = parseFloat(n) || 0;
    return '€ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function fmtDataIt(d) {
    if (!d) return '';
    const s = String(d).slice(0, 10);
    const parts = s.split('-');
    if (parts.length !== 3) return s;
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function calcolaTotale(righe, sconto_pct) {
    const subtot = righe.reduce((acc, r) => acc + (parseFloat(r.prezzo) || 0) * (parseInt(r.qty, 10) || 0), 0);
    const sconto = Math.max(0, Math.min(20, parseFloat(sconto_pct) || 0));
    return subtot * (1 - sconto / 100);
}

function renderProposta(p, referente, clienteNome, mode) {
    const righe = Array.isArray(p.righe) ? p.righe : [];
    const totale = calcolaTotale(righe, p.sconto_pct);
    const qtyTotale = righe.reduce((a, r) => a + (parseInt(r.qty, 10) || 0), 0);
    const waNumber = (referente.cellulare || '').replace(/[^\d+]/g, '');
    const waText = encodeURIComponent(`Buongiorno, ho ricevuto la proposta #${p.id} e vorrei parlarne.`);
    const isRepMode = mode === 'rep';

    const rigaRepBar = isRepMode ? `
    <div style="background:#0a1628;color:#fbf6ea;padding:10px 18px;display:flex;gap:12px;align-items:center;font-family:ui-monospace,monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;">
      <span style="opacity:0.7;">AZIONI REP · proposta #${p.id}</span>
      <a href="?edit=1&id=${p.id}" style="color:#1a9e8f;text-decoration:none;">✎ MODIFICA</a>
      <a href="#" onclick="cancellaProposta(${p.id});return false;" style="color:#ef4444;text-decoration:none;">× CANCELLA</a>
    </div>` : '';

    return `
  <article class="proposta-card">
    ${rigaRepBar}
    <div class="proposta-head">
      <div class="eyebrow">Proposta #${p.id} · ${escapeHtml(p.stato)}</div>
      <div class="proposta-data muted">Creata il ${fmtDataIt(p.data_creazione)}</div>
    </div>
    ${p.messaggio_personale ? `<div class="messaggio-personale"><span class="eyebrow">Messaggio da ${escapeHtml(referente.nome)}</span><p>${escapeHtml(p.messaggio_personale)}</p></div>` : ''}
    <table class="tbl-prodotti">
      <thead><tr><th>Prodotto</th><th class="txt-right">Prezzo</th><th class="txt-center">Qtà</th><th class="txt-right">Totale</th></tr></thead>
      <tbody>
        ${righe.map(r => `
          <tr>
            <td><strong>${escapeHtml(r.nome)}</strong><div class="muted mono">${escapeHtml(r.cod)}</div></td>
            <td class="txt-right mono">${fmtEuro(r.prezzo)}</td>
            <td class="txt-center mono">${r.qty}</td>
            <td class="txt-right mono">${fmtEuro((r.prezzo || 0) * (r.qty || 0))}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div class="proposta-meta">
      ${p.sconto_pct > 0 ? `<span class="tag">Sconto ${p.sconto_pct}%</span>` : ''}
      ${p.omaggio_3plus1 ? `<span class="tag">Omaggio 3+1 ${qtyTotale >= 3 ? 'attivo' : '(richiede ≥3 conf.)'}</span>` : ''}
    </div>
    <div class="proposta-totale">
      <div class="eyebrow">Totale proposta</div>
      <div class="totale-val">${fmtEuro(totale)}</div>
    </div>
    <div class="proposta-cta">
      ${waNumber ? `<a href="https://wa.me/${waNumber}?text=${waText}" target="_blank" class="btn btn-wa">💬 Scrivi a ${escapeHtml(referente.nome.split(' ')[0])}</a>` : ''}
      <button type="button" class="btn btn-ghost" onclick="rimandaProposta(${p.id})">Non ora, ricordamelo più avanti</button>
      <button type="button" class="btn btn-primary" onclick="confermaProposta(${p.id})">Conferma e procedi →</button>
    </div>
  </article>`;
}

function renderPillolaRimandate(proposteRimandate) {
    if (!proposteRimandate.length) return '';
    return `
  <aside class="pillola-rimandate">
    <div class="eyebrow">Proposte rimandate</div>
    <p>Hai ${proposteRimandate.length} proposta${proposteRimandate.length > 1 ? 'e' : ''} rimandata. Puoi rivederla quando vuoi.</p>
    <div class="pillola-btns">
      ${proposteRimandate.map(p => `<a href="#proposta-${p.id}" class="btn btn-outline" onclick="espandiRimandata(${p.id});return false;">Rivedi proposta rimandata al ${fmtDataIt(p.rimandata_al)}</a>`).join('')}
    </div>
  </aside>`;
}

function renderStorico(storico) {
    const items = storico.acquisti || [];
    if (!items.length) {
        if (storico.ultimo_pre_2026_label) {
            return `
    <section class="storico-card">
      <div class="eyebrow">Storico acquisti suture</div>
      <p class="muted italic">Nessun acquisto nel 2026. Il tuo ultimo riordino suture risale a <strong>${escapeHtml(storico.ultimo_pre_2026_label)}</strong>.</p>
    </section>`;
        }
        return '';
    }
    return `
    <section class="storico-card">
      <div class="eyebrow">Storico acquisti suture 2026</div>
      <table class="tbl-storico">
        <thead><tr><th>Data</th><th>Fattura</th><th class="txt-center">Qtà</th><th>Descrizione</th></tr></thead>
        <tbody>
          ${items.map(a => `
            <tr>
              <td class="mono">${fmtDataIt(a.data_fattura)}</td>
              <td class="mono">${escapeHtml(a.numero_fattura || '')}</td>
              <td class="txt-center mono">${a.quantita || ''}</td>
              <td>${escapeHtml(a.descrizione || '')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="muted" style="margin-top:12px;">Totale ${storico.totale_confezioni_2026 || 0} confezioni dal 1° gennaio 2026.</p>
    </section>`;
}

function renderReferente(referente) {
    const waNumber = (referente.cellulare || '').replace(/[^\d+]/g, '');
    const waText = encodeURIComponent('Buongiorno, ho bisogno di un\'informazione sulle suture.');
    return `
    <aside class="sidebar-referente">
      <div class="eyebrow">Il tuo referente</div>
      <div class="avatar">${escapeHtml(referente.iniziali)}</div>
      <div class="ref-nome">${escapeHtml(referente.nome)}</div>
      <a class="ref-email" href="mailto:${escapeHtml(referente.email)}">${escapeHtml(referente.email)}</a>
      ${waNumber ? `<div class="ref-cellulare mono">${escapeHtml(referente.cellulare)}</div>
      <a href="https://wa.me/${waNumber}?text=${waText}" target="_blank" class="btn btn-wa-big">💬 Scrivi su WhatsApp</a>` : '<p class="muted" style="margin-top:12px;font-size:12px;">Contattalo via email.</p>'}
    </aside>`;
}

async function getPortaleData(token, pool, proposalBuilder) {
    const info = await resolveTokenToCliente(token, pool);
    if (!info) return null;

    const { rows: clienti } = await pool.query(
        `SELECT id, cognome, nome, nome_azienda, email, telefono, cellulare, citta, regione
         FROM crm_contatti WHERE id = $1`,
        [info.cliente_id]
    );
    const cliente = clienti[0] || {};
    const storico = await getStoricoSutureCliente(info.cliente_id, pool);
    const proposte = proposalBuilder
        ? await proposalBuilder.listProposte({ cliente_id: info.cliente_id }, pool)
        : [];

    return {
        token,
        cliente,
        storico,
        proposte,
        data_creazione_portale: info.data_creazione,
    };
}

function renderPortaleHTML(data, mode) {
    const cliente = data.cliente || {};
    const proposte = Array.isArray(data.proposte) ? data.proposte : [];
    const storico = data.storico || { acquisti: [], ultimo_pre_2026_label: null };
    const today = new Date().toISOString().slice(0, 10);

    const attive = proposte.filter(p => !p.rimandata_al || String(p.rimandata_al).slice(0, 10) <= today);
    const rimandate = proposte.filter(p => p.rimandata_al && String(p.rimandata_al).slice(0, 10) > today);

    const nomeVisibile = cliente.nome_azienda
        || [cliente.cognome, cliente.nome].filter(Boolean).join(' ').trim()
        || 'Cliente';

    const salesRepKey = attive[0]?.sales_rep || proposte[0]?.sales_rep || 'admin';
    const referente = REFERENTE_META[salesRepKey] || REFERENTE_META.admin;

    return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<title>Portale cliente · OSSEOTOUCH</title>
<style>
:root {
  --mezzanotte:#0a1628; --mezzanotte-soft:#14243b; --osseolio:#1a9e8f; --osseolio-deep:#0f6d63;
  --avorio:#fbf6ea; --avorio-warm:#f5ecd8; --line:rgba(10,22,40,0.1); --line-strong:rgba(10,22,40,0.22);
  --muted:#6f7580; --whatsapp:#22c55e;
}
*{box-sizing:border-box}
body{margin:0;font-family:'Instrument Sans',system-ui,sans-serif;background:var(--avorio);color:var(--mezzanotte);font-size:14px;line-height:1.5}
.wrap{max-width:1180px;margin:0 auto;padding:32px}
.header{display:flex;justify-content:space-between;align-items:center;padding-bottom:20px;border-bottom:1px solid var(--line);margin-bottom:40px}
.brand{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:var(--muted)}
.brand strong{color:var(--mezzanotte);font-weight:500;margin-right:12px}
.hero{text-align:center;padding:40px 0 50px}
.eyebrow{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.26em;text-transform:uppercase;color:var(--osseolio)}
.hero h1{font-family:'Fraunces',Georgia,serif;font-weight:350;font-size:clamp(40px,6vw,68px);line-height:0.95;letter-spacing:-0.03em;margin:10px 0 0}
.hero h1 em{font-style:italic;font-weight:300;color:var(--osseolio-deep)}
.grid{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,3fr);gap:32px;align-items:start}
@media(max-width:860px){.grid{grid-template-columns:1fr}}
.proposta-card{background:#fffdf7;border:1px solid var(--line-strong);border-radius:2px;margin-bottom:24px;overflow:hidden}
.proposta-head{padding:24px 28px 12px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:baseline;gap:16px}
.proposta-data{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.1em}
.messaggio-personale{background:var(--avorio-warm);padding:16px 28px;border-bottom:1px solid var(--line);font-family:'Fraunces',serif;font-style:italic}
.messaggio-personale p{margin:8px 0 0;font-size:15px}
.tbl-prodotti{width:100%;border-collapse:collapse;margin:0}
.tbl-prodotti th{text-align:left;font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.2em;color:var(--muted);padding:12px 28px;border-bottom:1px solid var(--line);font-weight:400}
.tbl-prodotti td{padding:14px 28px;border-bottom:1px solid var(--line);vertical-align:top}
.tbl-prodotti tbody tr:last-child td{border-bottom:none}
.txt-right{text-align:right}.txt-center{text-align:center}.mono{font-family:'JetBrains Mono',monospace}
.muted{color:var(--muted)}.italic{font-style:italic}
.proposta-meta{padding:14px 28px;display:flex;gap:10px;flex-wrap:wrap;border-top:1px solid var(--line)}
.tag{display:inline-block;padding:4px 10px;background:rgba(26,158,143,0.1);color:var(--osseolio-deep);border-radius:999px;font-size:11px;font-family:'JetBrains Mono',monospace;letter-spacing:0.08em}
.proposta-totale{background:var(--avorio-warm);padding:18px 28px;display:flex;justify-content:space-between;align-items:baseline}
.totale-val{font-family:'Fraunces',serif;font-size:36px;font-weight:350;letter-spacing:-0.025em}
.proposta-cta{padding:18px 28px;display:flex;gap:10px;flex-wrap:wrap;border-top:1px solid var(--line)}
.btn{display:inline-block;padding:12px 20px;border:none;border-radius:2px;font-family:'Instrument Sans',sans-serif;font-weight:600;font-size:13px;cursor:pointer;text-decoration:none;transition:all 0.15s}
.btn-primary{background:var(--osseolio);color:#fff;font-family:'Fraunces',serif;font-weight:500;font-size:17px;padding:14px 24px}
.btn-primary:hover{background:var(--osseolio-deep)}
.btn-ghost{background:transparent;border:1px solid var(--line-strong);color:var(--mezzanotte)}
.btn-ghost:hover{background:var(--mezzanotte);color:#fff}
.btn-wa{background:var(--whatsapp);color:#fff}
.btn-wa:hover{background:#16a34a}
.btn-outline{background:transparent;border:1px solid var(--osseolio);color:var(--osseolio-deep);padding:10px 16px;font-size:12px}
.btn-outline:hover{background:rgba(26,158,143,0.06)}
.btn-wa-big{display:block;margin-top:14px;background:var(--whatsapp);color:#fff;padding:14px;text-align:center}
.btn-wa-big:hover{background:#16a34a}
.pillola-rimandate{background:rgba(224,231,255,0.3);border:1px solid rgba(67,56,202,0.18);border-radius:2px;padding:20px 28px;margin-bottom:24px}
.pillola-rimandate .eyebrow{color:#4338ca}
.pillola-btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
.storico-card{background:#fffdf7;border:1px solid var(--line);border-radius:2px;padding:24px 28px;margin-top:20px}
.tbl-storico{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
.tbl-storico th{text-align:left;font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.18em;color:var(--muted);padding:10px 0;border-bottom:1px solid var(--line);font-weight:400}
.tbl-storico td{padding:10px 0;border-bottom:1px solid var(--line)}
.sidebar-referente{background:#fffdf7;border:1px solid var(--line-strong);border-radius:2px;padding:24px;position:sticky;top:24px;text-align:center}
.avatar{width:72px;height:72px;border-radius:50%;background:var(--mezzanotte);color:var(--avorio);display:flex;align-items:center;justify-content:center;font-family:'Fraunces',serif;font-size:28px;margin:16px auto 12px}
.ref-nome{font-family:'Fraunces',serif;font-size:22px;font-weight:500;margin-bottom:4px}
.ref-email{color:var(--osseolio-deep);font-family:'JetBrains Mono',monospace;font-size:12px;text-decoration:none}
.ref-cellulare{font-size:14px;color:var(--mezzanotte-soft);margin-top:6px}
.catalogo-cta{background:var(--mezzanotte);color:var(--avorio);padding:28px;border-radius:2px;margin-top:28px;text-align:center}
.catalogo-cta h3{font-family:'Fraunces',serif;font-weight:400;font-size:22px;margin:10px 0}
.catalogo-cta a{display:inline-block;margin-top:14px;padding:12px 24px;background:var(--osseolio);color:#fff;text-decoration:none;border-radius:2px;font-weight:600;font-size:13px}
.empty-proposte{background:#fffdf7;border:1px dashed var(--line-strong);padding:40px;text-align:center;color:var(--muted);font-family:'Fraunces',serif;font-style:italic;font-size:16px}
</style>
</head>
<body>
<div class="wrap">
  <header class="header">
    <div class="brand"><strong>OSSEOTOUCH</strong>Portale cliente</div>
    <div class="brand">${escapeHtml(cliente.citta || '')}</div>
  </header>
  <section class="hero">
    <div class="eyebrow">Benvenuto nel tuo portale</div>
    <h1>${escapeHtml(nomeVisibile)}</h1>
  </section>
  <div class="grid">
    <section class="col-proposte">
      ${attive.length
          ? attive.map(p => renderProposta(p, referente, nomeVisibile, mode)).join('')
          : '<div class="empty-proposte">Nessuna proposta attiva in questo momento. Ti contatteremo presto.</div>'}
      ${renderPillolaRimandate(rimandate)}
      ${renderStorico(storico)}
      <div class="catalogo-cta">
        <div class="eyebrow" style="color:var(--osseolio)">Esplora il catalogo</div>
        <h3>Curioso di scoprire tutte le suture disponibili?</h3>
        <a href="https://osseotouch.com/devices/suture/" target="_blank" rel="noopener">Vedi il catalogo →</a>
        <p class="muted" style="font-size:11px;margin-top:10px">Si apre in una nuova scheda, puoi tornare qui quando vuoi.</p>
      </div>
    </section>
    ${renderReferente(referente)}
  </div>
</div>
<script>
const PORTALE_TOKEN = ${JSON.stringify(data.token)};
async function confermaProposta(id) {
  if (!confirm('Procedere con l\\'ordine di questa proposta?\\nVerrai reindirizzato al checkout su osseotouch.com/shop.')) return;
  try {
    const r = await fetch('/api/portali/' + PORTALE_TOKEN + '/conferma/' + id, { method: 'POST' });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || 'errore sconosciuto');
    window.location.href = data.checkout_url;
  } catch (e) {
    alert('Errore conferma ordine: ' + e.message);
  }
}
function rimandaProposta(id) {
  if (!confirm('Rimandare questa proposta di 30 giorni?')) return;
  fetch('/api/proposte/' + id + '/rimanda', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({days:30})})
    .then(r => r.json()).then(r => { alert('Proposta rimandata al ' + (r.rimandata_al||'?')); location.reload(); })
    .catch(e => alert('Errore: ' + e.message));
}
function espandiRimandata(id) {
  const el = document.getElementById('proposta-' + id);
  if (el) el.scrollIntoView({behavior:'smooth'});
}
function cancellaProposta(id) {
  if (!confirm('Cancellare la proposta #' + id + '? Operazione irreversibile.')) return;
  fetch('/api/proposte/' + id, {method:'DELETE', headers:{'x-admin-key':prompt('Admin key:')||''}})
    .then(r => r.json()).then(r => { alert('Cancellata'); location.reload(); })
    .catch(e => alert('Errore: ' + e.message));
}
</script>
</body>
</html>`;
}

module.exports = {
    resolveTokenToCliente,
    getStoricoSutureCliente,
    getPortaleData,
    renderPortaleHTML,
};
