/**
 * SUTURE · Dashboard sales rep — UI shared Kim/Detto/Admin
 *
 * Richiede in pagina:
 *   <script>const AGENTE = 'kim'|'detto'|'admin';</script>
 *   <section><div id="suture-clienti-container"></div></section>
 *   <section><div id="suture-proposte-container"></div></section>
 *
 * Legge adminKey dalla query string (?key=...)
 * Endpoint: /api/suture/clienti-rep/:rep · /api/proposte · /api/proposte/:id/*
 *
 * Riferimento: SUTURE/BRIEF_IMPLEMENTAZIONE.md sez. 10 · SUTURE/PIANO_FASE1.md Blocco 4
 */

(function() {
    'use strict';

    const KEY = new URLSearchParams(window.location.search).get('key') || '';
    // Mapping nome dashboard → rep logico backend:
    //   'kim' → 'kim', 'massimo' / 'detto' → 'detto', 'admin' → 'admin'
    const REPMAP = { kim: 'kim', massimo: 'detto', detto: 'detto', admin: 'admin' };
    const AGENTE_RAW = (typeof AGENTE !== 'undefined' ? AGENTE : 'admin').toLowerCase();
    const REP = REPMAP[AGENTE_RAW] || 'admin';

    const MITTENTI = {
        kim: ['kagnello@osseotouch.com'],
        detto: ['mdetto@osseotouch.com'],
        admin: ['kagnello@osseotouch.com', 'mdetto@osseotouch.com', 'contact@osseotouch.com'],
    };

    const CATALOGO = [
        { cod: 'MV0205', nome: 'Monolac Violet 5/0 DS15', prezzo: 140 },
        { cod: 'PGA0305', nome: 'PGA 3/0 HR20', prezzo: 145 },
        { cod: 'AW0605', nome: 'Aesthetic White 6/0', prezzo: 165 },
        { cod: 'MV0605', nome: 'Monolac Violet 6/0', prezzo: 148 },
        { cod: 'CHI0405', nome: 'Chirasorb 4/0', prezzo: 155 },
        { cod: 'SLK0405', nome: 'Silk 4/0', prezzo: 95 },
        { cod: 'SLN0505', nome: 'Silon 5/0', prezzo: 132 },
        { cod: 'TVL0305', nome: 'Tervalon 3/0', prezzo: 178 },
    ];

    function api(path, opts = {}) {
        const sep = path.includes('?') ? '&' : '?';
        const url = path + sep + 'key=' + encodeURIComponent(KEY);
        return fetch(url, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                'x-admin-key': KEY,
                ...(opts.headers || {}),
            },
        }).then(async r => {
            const body = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
            return body;
        });
    }

    function fmtEuro(n) {
        const v = parseFloat(n) || 0;
        return '€ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    function fmtDataIt(d) {
        if (!d) return '—';
        const s = String(d).slice(0, 10);
        const parts = s.split('-');
        if (parts.length !== 3) return s;
        return `${parts[2]}.${parts[1]}.${parts[0]}`;
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ==================== RENDER CLIENTI (raggruppati per regione, stile mockup) ====================
    const IS_ADMIN = REP === 'admin';

    function badgeAssignedTo(c) {
        if (!c._assigned_to) return '';
        const styleMap = {
            kim:   'background:rgba(26,158,143,0.14);color:#0f6d63;border:1px solid rgba(26,158,143,0.4)',
            detto: 'background:rgba(168,85,247,0.14);color:#6b21a8;border:1px solid rgba(168,85,247,0.4)',
            admin: 'background:rgba(194,119,11,0.14);color:#8a5600;border:1px solid rgba(194,119,11,0.4)',
        };
        const label = { kim: 'KIM', detto: 'DETTO', admin: 'DIREZIONALE' }[c._assigned_to] || c._assigned_to.toUpperCase();
        const src = c._assigned_source === 'excel' ? ' · excel' : ' · regione';
        const style = styleMap[c._assigned_to] || styleMap.admin;
        return `<span style="${style};padding:3px 10px;border-radius:999px;font-size:10px;font-family:'JetBrains Mono',monospace;letter-spacing:0.1em;font-weight:600;white-space:nowrap">${label}<span style="font-weight:400;opacity:0.7">${src}</span></span>`;
    }

    function renderRigaCliente(c) {
        const nome = c.nome_azienda || [c.cognome, c.nome].filter(Boolean).join(' ').trim() || '(senza nome)';
        const miniReg = c._via_rule2 ? `<div class="mini-reg">${esc(c.regione || '—')}</div>` : '';
        const assignedCell = IS_ADMIN
            ? `<td class="cell-assegnato">${badgeAssignedTo(c)}</td>`
            : '';
        // Nota: uso data-* + event delegation invece di onclick inline per evitare
        // bug con apostrofi nei nomi clienti (es. "D'Angelosante Augusto") che
        // rompono il JS inline anche dopo HTML escape (il browser decodifica le
        // entity HTML prima del parser JS).
        const nomeAttr = esc(nome);
        return `
          <tr data-cliente-id="${c.id}">
            <td class="cell-nome">
              <div class="name">${nomeAttr}</div>
              <div class="email">${esc(c.email || '')}</div>
              ${miniReg}
            </td>
            <td class="cell-city">${esc(c.citta || '—')}</td>
            ${assignedCell}
            <td class="cell-action">
              <button class="act-btn" data-action="nuova-proposta" data-cliente-id="${c.id}" data-cliente-nome="${nomeAttr}" data-cliente-assigned="${c._assigned_to || ''}">Nuova proposta</button>
              <a class="act-link" href="#" data-action="apri-portale-cliente" data-cliente-id="${c.id}">👁 Come cliente</a>
              <a class="act-link" href="#" data-action="apri-portale-rep" data-cliente-id="${c.id}">✎ Come rep</a>
              ${IS_ADMIN ? `<a class="act-link" href="#" style="color:#b91c1c" data-action="revoca-portale" data-cliente-id="${c.id}" data-cliente-nome="${nomeAttr}">⛔ Revoca portale</a>` : ''}
            </td>
          </tr>`;
    }

    // Event delegation sui bottoni/link tabella (evita bug apostrofi in onclick inline)
    document.addEventListener('click', (ev) => {
        const el = ev.target.closest('[data-action]');
        if (!el) return;
        const action = el.dataset.action;
        const clienteId = parseInt(el.dataset.clienteId, 10);
        const clienteNome = el.dataset.clienteNome || '';
        const clienteAssigned = el.dataset.clienteAssigned || '';
        if (!clienteId) return;
        ev.preventDefault();
        if (action === 'nuova-proposta') openComposer(clienteId, clienteNome, clienteAssigned);
        else if (action === 'apri-portale-cliente') apriPortale(clienteId, 'cliente');
        else if (action === 'apri-portale-rep') apriPortale(clienteId, 'rep');
        else if (action === 'revoca-portale') revocaPortale(clienteId, clienteNome);
    });

    function renderRegionCard(regione, clienti, isFuori) {
        const cls = isFuori ? 'region-card region-card-fuori' : 'region-card';
        const assignedHeader = IS_ADMIN ? '<th>Assegnato a</th>' : '';
        return `
          <section class="${cls}">
            <div class="region-head">
              <div class="region-title">${esc(regione)}</div>
              <div class="region-count">${clienti.length} client${clienti.length === 1 ? 'e' : 'i'}</div>
            </div>
            <table class="tbl">
              <thead><tr><th>Cliente</th><th>Città</th>${assignedHeader}<th class="txt-right">Azione</th></tr></thead>
              <tbody>${clienti.map(renderRigaCliente).join('')}</tbody>
            </table>
          </section>`;
    }

    async function loadClienti() {
        const container = document.getElementById('suture-clienti-container');
        if (!container) return;
        container.innerHTML = '<p class="empty">Caricamento clienti suture…</p>';
        try {
            const r = await api(`/api/suture/clienti-rep/${REP}`);
            const clienti = r.clienti || [];

            // Update stat cards
            const sTot = document.getElementById('stat-total');
            const sR1 = document.getElementById('stat-r1');
            const sR2 = document.getElementById('stat-r2');
            if (sTot) sTot.textContent = clienti.length;
            if (sR1) sR1.textContent = clienti.length - (r.count_rule2 || 0);
            if (sR2) sR2.textContent = r.count_rule2 || 0;

            if (!clienti.length) {
                container.innerHTML = '<p class="empty">Nessun cliente suture nel tuo portafoglio.</p>';
                return;
            }

            // Raggruppa per regione: rule #1 prima (regioni del rep), poi card "Fuori regione · Excel"
            const byRegione = new Map();
            const fuoriRegione = [];
            for (const c of clienti) {
                if (c._via_rule2) {
                    fuoriRegione.push(c);
                } else {
                    const reg = (c.regione || 'SENZA REGIONE').toString().toUpperCase();
                    if (!byRegione.has(reg)) byRegione.set(reg, []);
                    byRegione.get(reg).push(c);
                }
            }

            const cards = [];
            // Ordine regioni: alfabetico (o per count desc)
            const regioniOrdinate = Array.from(byRegione.keys()).sort();
            for (const reg of regioniOrdinate) {
                cards.push(renderRegionCard(reg, byRegione.get(reg), false));
            }
            if (fuoriRegione.length) {
                cards.push(renderRegionCard('Fuori regione · Excel analisi_vendite', fuoriRegione, true));
            }
            container.innerHTML = cards.join('');
        } catch (err) {
            container.innerHTML = `<p class="empty" style="color:#b91c1c">Errore caricamento: ${esc(err.message)}</p>`;
        }
    }

    // ==================== RENDER PROPOSTE ====================
    async function loadProposte() {
        const container = document.getElementById('suture-proposte-container');
        if (!container) return;
        container.innerHTML = '<p class="loading">Caricamento proposte…</p>';
        try {
            const filter = REP === 'admin' ? '' : `?sales_rep=${REP}`;
            const r = await api('/api/proposte' + filter);
            const proposte = r.proposte || [];
            if (!proposte.length) {
                container.innerHTML = '<p class="loading">Nessuna proposta ancora. Crea la prima dal tab "Clienti Suture".</p>';
                return;
            }
            const today = new Date().toISOString().slice(0, 10);
            container.innerHTML = `
                <div style="background:#fffdf7;border:1px solid rgba(10,22,40,0.15);border-radius:2px;overflow-x:auto">
                  <table style="width:100%;border-collapse:collapse;font-size:13px">
                    <thead>
                      <tr style="background:#f5ecd8">
                        <th style="text-align:left;padding:12px 16px;font-weight:500">Cliente</th>
                        <th style="text-align:left;padding:12px 16px;font-weight:500">Data</th>
                        <th style="text-align:left;padding:12px 16px;font-weight:500">Stato</th>
                        <th style="text-align:right;padding:12px 16px;font-weight:500">Sconto</th>
                        ${REP === 'admin' ? '<th style="text-align:left;padding:12px 16px;font-weight:500">Rep</th>' : ''}
                        <th style="text-align:left;padding:12px 16px;font-weight:500">Azioni</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${proposte.map(p => {
                          const nomeC = p.nome_azienda || [p.cognome, p.nome].filter(Boolean).join(' ').trim() || `#${p.cliente_id}`;
                          const rimandataAl = p.rimandata_al ? String(p.rimandata_al).slice(0, 10) : null;
                          const isRimandata = rimandataAl && rimandataAl > today;
                          const statoBadgeStyle = {
                              pending: 'background:#fef9c3;color:#854d0e',
                              confermata_cliente: 'background:#dcfce7;color:#166534',
                              confermata_manualmente: 'background:#f3e8ff;color:#6b21a8',
                              rifiutata: 'background:#fee2e2;color:#991b1b',
                              rimandata: 'background:#e0e7ff;color:#3730a3',
                          }[p.stato] || 'background:#e5e7eb;color:#374151';
                          return `
                            <tr style="border-top:1px solid rgba(10,22,40,0.08)">
                              <td style="padding:14px 16px"><strong>${esc(nomeC)}</strong></td>
                              <td style="padding:14px 16px;font-family:monospace">${fmtDataIt(p.data_creazione)}</td>
                              <td style="padding:14px 16px">
                                <span style="${statoBadgeStyle};padding:3px 10px;border-radius:999px;font-size:11px;font-family:monospace;letter-spacing:0.08em">${esc(p.stato)}</span>
                                ${isRimandata ? `<div style="font-size:10px;color:#6f7580;margin-top:4px">al ${fmtDataIt(rimandataAl)}</div>` : ''}
                              </td>
                              <td style="padding:14px 16px;text-align:right;font-family:monospace">${p.sconto_pct || 0}%</td>
                              ${REP === 'admin' ? `<td style="padding:14px 16px">${esc(p.sales_rep)}</td>` : ''}
                              <td style="padding:14px 16px">
                                ${isRimandata ? `<button onclick="window.SUTURE.riattiva(${p.id})" style="background:#16a34a;color:#fff;border:none;padding:6px 10px;border-radius:2px;cursor:pointer;font-size:11px;margin-right:4px">Riattiva ora</button>` : ''}
                                ${p.stato === 'pending' ? `<button onclick="window.SUTURE.apriConfermaManuale(${p.id})" style="background:#0a1628;color:#fff;border:none;padding:6px 10px;border-radius:2px;cursor:pointer;font-size:11px;margin-right:4px">Conferma manuale</button>` : ''}
                                <a href="javascript:void(0)" onclick="window.SUTURE.apriPortale(${p.cliente_id})" style="color:#0f6d63;font-size:11px">👁 Vedi portale</a>
                              </td>
                            </tr>`;
                      }).join('')}
                    </tbody>
                  </table>
                </div>`;
        } catch (err) {
            container.innerHTML = `<p style="color:#b91c1c">Errore caricamento: ${esc(err.message)}</p>`;
        }
    }

    // ==================== MODAL COMPOSER ====================
    // clienteAssignedTo: 'kim'|'detto'|'admin' (solo per vista admin, determina
    //                    sales_rep della proposta + mittente default). Per Kim/Detto
    //                    user loggato, resta sempre REP (loro stessi).
    function openComposer(clienteId, clienteNome, clienteAssignedTo) {
        // Per admin: usa l'assegnazione del cliente (Excel > regione). Per Kim/Detto: se stessi.
        const repProposta = IS_ADMIN && clienteAssignedTo ? clienteAssignedTo : REP;
        const mittenti = MITTENTI[repProposta] || MITTENTI.admin;
        const mittenteDefault = mittenti[0];
        const backdrop = document.createElement('div');
        backdrop.className = 'suture-modal-backdrop';
        backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(10,22,40,0.65);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:40px 20px;overflow-y:auto';
        backdrop.innerHTML = `
          <div style="background:#fffdf7;max-width:640px;width:100%;border-radius:2px;box-shadow:0 30px 60px -20px rgba(10,22,40,0.5)">
            <div style="padding:20px 28px;border-bottom:1px solid rgba(10,22,40,0.08);display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-family:monospace;font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#1a9e8f">Nuova proposta</div>
                <h2 style="margin:4px 0 0;font-family:Georgia,serif;font-weight:400;font-size:22px">${esc(clienteNome)}</h2>
              </div>
              <button type="button" onclick="this.closest('.suture-modal-backdrop').remove()" style="background:transparent;border:none;font-size:28px;cursor:pointer;color:#6f7580">×</button>
            </div>
            <div style="padding:20px 28px;max-height:70vh;overflow-y:auto">
              <h3 style="font-family:Georgia,serif;font-weight:500;font-size:15px;margin:0 0 10px">Prodotti</h3>
              <div id="suture-prod-list"></div>
              <div style="margin-top:10px">
                <select id="suture-add-prod" style="width:100%;padding:8px 10px;border:1px solid rgba(10,22,40,0.15);background:#f5ecd8;border-radius:2px;font-size:13px">
                  <option value="">+ Aggiungi prodotto dal catalogo</option>
                  ${CATALOGO.map(p => `<option value="${p.cod}">${esc(p.nome)} · ${esc(p.cod)} · ${fmtEuro(p.prezzo)}</option>`).join('')}
                </select>
              </div>
              <h3 style="font-family:Georgia,serif;font-weight:500;font-size:15px;margin:16px 0 6px">Sconto %</h3>
              <div style="display:flex;gap:10px;align-items:center">
                <input type="range" id="suture-sconto" min="0" max="20" value="10" style="flex:1" oninput="document.getElementById('suture-sconto-val').textContent=this.value+'%'">
                <span id="suture-sconto-val" style="font-family:Georgia,serif;font-weight:500;font-size:20px;min-width:60px;text-align:right">10%</span>
              </div>
              <div style="font-size:11px;color:#6f7580">Max 20%. Oltre serve OK admin.</div>
              <label style="display:block;padding:12px;border:1px solid rgba(10,22,40,0.1);border-radius:2px;margin-top:14px;cursor:pointer">
                <input type="checkbox" id="suture-omaggio" checked> Applica regola omaggio 3+1 <span style="font-size:11px;color:#6f7580">· valido se totale qty ≥ 3</span>
              </label>
              <h3 style="font-family:Georgia,serif;font-weight:500;font-size:15px;margin:16px 0 6px">Cadenza</h3>
              <div style="display:flex;gap:8px" id="suture-cad-row">
                ${[30, 60, 90].map(g => `
                  <label style="flex:1;cursor:pointer;position:relative">
                    <input type="radio" name="suture-cad" value="${g}" ${g === 60 ? 'checked' : ''} style="position:absolute;opacity:0;pointer-events:none">
                    <div class="cad-box" data-cad-val="${g}" style="border:1.5px solid ${g === 60 ? '#1a9e8f' : 'rgba(10,22,40,0.12)'};background:${g === 60 ? 'rgba(26,158,143,0.06)' : '#fff'};padding:12px;text-align:center;border-radius:2px;font-family:Georgia,serif;transition:all 0.15s">${g} gg</div>
                  </label>`).join('')}
              </div>
              <h3 style="font-family:Georgia,serif;font-weight:500;font-size:15px;margin:16px 0 6px">Modalità</h3>
              <label style="display:block;padding:10px;border:1px solid rgba(10,22,40,0.1);border-radius:2px;margin-bottom:6px;cursor:pointer">
                <input type="radio" name="suture-mod" value="automatica" checked> 🔁 <strong>Automatica</strong> — il sistema prepara la proposta alla scadenza
              </label>
              <label style="display:block;padding:10px;border:1px solid rgba(10,22,40,0.1);border-radius:2px;cursor:pointer">
                <input type="radio" name="suture-mod" value="manuale"> ✋ <strong>Manuale</strong> — alla scadenza il sistema ti avvisa
              </label>
                <h3 style="font-family:Georgia,serif;font-weight:500;font-size:15px;margin:16px 0 6px">Mittente email</h3>
              <select id="suture-mittente" style="width:100%;padding:10px;border:1px solid rgba(10,22,40,0.1);background:#f5ecd8;border-radius:2px">
                ${mittenti.map(m => `<option value="${m}" ${m === mittenteDefault ? 'selected' : ''}>${esc(m)}</option>`).join('')}
              </select>
              ${IS_ADMIN ? `<div style="font-size:11px;color:#6f7580;margin-top:4px">Assegnazione cliente: <strong>${esc(clienteAssignedTo || 'admin').toUpperCase()}</strong> (pre-selezionato il mittente corretto)</div>` : ''}
              <h3 style="font-family:Georgia,serif;font-weight:500;font-size:15px;margin:16px 0 6px">Messaggio personale (opzionale)</h3>
              <textarea id="suture-msg" placeholder="Es. Gentile Dr. Rossi, in vista del prossimo mese ho preparato la riproposta…" style="width:100%;min-height:80px;padding:10px;border:1px solid rgba(10,22,40,0.1);background:#f5ecd8;border-radius:2px;font-family:inherit;font-size:14px;resize:vertical"></textarea>
            </div>
            <div style="padding:16px 28px;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid rgba(10,22,40,0.08);background:#f5ecd8">
              <button type="button" onclick="this.closest('.suture-modal-backdrop').remove()" style="background:transparent;border:1px solid rgba(10,22,40,0.2);padding:10px 20px;border-radius:2px;cursor:pointer;font-weight:600">Annulla</button>
              <button type="button" id="suture-salva-btn" style="background:#1a9e8f;color:#fff;border:none;padding:10px 22px;border-radius:2px;cursor:pointer;font-weight:700">Salva e genera link →</button>
            </div>
          </div>`;
        document.body.appendChild(backdrop);

        const prodList = backdrop.querySelector('#suture-prod-list');
        function aggiungiRiga(cod) {
            const p = CATALOGO.find(x => x.cod === cod);
            if (!p) return;
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:10px;align-items:center;padding:10px;border:1px solid rgba(10,22,40,0.1);border-radius:2px;margin-bottom:6px;background:#f5ecd8';
            row.dataset.cod = p.cod;
            row.dataset.nome = p.nome;
            row.dataset.prezzo = p.prezzo;
            row.innerHTML = `
                <div style="flex:1">
                  <strong>${esc(p.nome)}</strong>
                  <div style="font-family:monospace;font-size:10px;color:#6f7580">${esc(p.cod)} · ${fmtEuro(p.prezzo)}/cad</div>
                </div>
                <input type="number" value="1" min="1" style="width:60px;padding:6px;text-align:center;border:1px solid rgba(10,22,40,0.1);font-family:monospace">
                <button type="button" onclick="this.parentElement.remove()" style="background:transparent;border:none;color:#6f7580;font-size:20px;cursor:pointer">×</button>`;
            prodList.appendChild(row);
        }
        aggiungiRiga('MV0205');
        backdrop.querySelector('#suture-add-prod').addEventListener('change', e => {
            if (e.target.value) { aggiungiRiga(e.target.value); e.target.value = ''; }
        });

        // Fix cadenza: radio visivamente attivo sincronizzato con input[name=suture-cad]
        backdrop.querySelectorAll('input[name="suture-cad"]').forEach(rad => {
            rad.addEventListener('change', () => {
                backdrop.querySelectorAll('.cad-box').forEach(box => {
                    const isChecked = box.previousElementSibling.checked;
                    box.style.borderColor = isChecked ? '#1a9e8f' : 'rgba(10,22,40,0.12)';
                    box.style.background = isChecked ? 'rgba(26,158,143,0.06)' : '#fff';
                });
            });
        });
        // Click su box cadenza = check radio corrispondente
        backdrop.querySelectorAll('.cad-box').forEach(box => {
            box.addEventListener('click', () => {
                const rad = box.previousElementSibling;
                if (rad) { rad.checked = true; rad.dispatchEvent(new Event('change', { bubbles: true })); }
            });
        });

        backdrop.querySelector('#suture-salva-btn').addEventListener('click', async () => {
            const prodotti = Array.from(prodList.children).map(row => ({
                cod: row.dataset.cod, nome: row.dataset.nome,
                prezzo: parseFloat(row.dataset.prezzo),
                qty: parseInt(row.querySelector('input[type=number]').value, 10) || 0,
            })).filter(p => p.qty > 0);
            if (!prodotti.length) { alert('Aggiungi almeno un prodotto con qty > 0.'); return; }
            const payload = {
                cliente_id: clienteId,
                sales_rep: repProposta,
                mittente_email: backdrop.querySelector('#suture-mittente').value,
                prodotti,
                sconto_pct: parseInt(backdrop.querySelector('#suture-sconto').value, 10),
                omaggio_3plus1: backdrop.querySelector('#suture-omaggio').checked,
                cadenza_gg: parseInt(backdrop.querySelector('input[name=suture-cad]:checked').value, 10),
                modalita: backdrop.querySelector('input[name=suture-mod]:checked').value,
                messaggio_personale: backdrop.querySelector('#suture-msg').value.trim() || null,
            };
            try {
                const r = await api('/api/proposte', { method: 'POST', body: JSON.stringify(payload) });
                backdrop.remove();
                mostraModalLinkGenerato(clienteNome, r.token_portale, payload.mittente_email, r.id);
            } catch (err) {
                alert('Errore salvataggio: ' + err.message);
            }
        });
    }

    // ==================== MODAL LINK GENERATO ====================
    function mostraModalLinkGenerato(clienteNome, token, mittenteEmail, propostaId) {
        const portaleUrl = `https://myosseotouch.com/portale/${token}`;
        const waText = `Le invio la proposta riordino suture: ${portaleUrl}`;

        const backdrop = document.createElement('div');
        backdrop.className = 'suture-modal-backdrop';
        backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(10,22,40,0.65);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:40px 20px';
        backdrop.innerHTML = `
          <div style="background:#fffdf7;max-width:640px;width:100%;border-radius:2px">
            <div style="padding:20px 28px;border-bottom:1px solid rgba(10,22,40,0.08)">
              <div style="font-family:monospace;font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#16a34a">Link generato</div>
              <h2 style="margin:4px 0 0;font-family:Georgia,serif;font-weight:400;font-size:22px">Proposta per ${esc(clienteNome)}</h2>
            </div>
            <div style="padding:20px 28px">
              <div style="background:rgba(26,158,143,0.08);border:1px solid rgba(26,158,143,0.3);padding:14px;border-radius:2px;margin-bottom:14px">
                <div style="font-family:monospace;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#1a9e8f;margin-bottom:6px">Link portale cliente</div>
                <div style="display:flex;gap:8px">
                  <input type="text" id="suture-link-input" value="${esc(portaleUrl)}" readonly style="flex:1;padding:10px;border:1px solid rgba(10,22,40,0.1);font-family:monospace;font-size:12px">
                  <button type="button" id="suture-copy-btn" style="padding:10px 14px;background:#1a9e8f;color:#fff;border:none;border-radius:2px;font-weight:700;cursor:pointer">📋 Copia</button>
                </div>
              </div>
              <h3 style="font-family:Georgia,serif;font-weight:500;font-size:15px;margin:0 0 8px">Invia al cliente</h3>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                <button type="button" id="suture-email-btn" style="padding:14px;background:#0a1628;color:#fff;border:none;border-radius:2px;text-align:center;font-weight:600;font-size:13px;cursor:pointer">✉️ Invia email Mailgun<br><span style="font-size:10px;opacity:0.7;font-family:monospace;letter-spacing:0.08em">da ${esc(mittenteEmail)}</span></button>
                <button type="button" id="suture-wa-btn" style="padding:14px;background:#22c55e;color:#fff;border:none;border-radius:2px;font-weight:600;font-size:13px;cursor:pointer">💬 Copia per WhatsApp<br><span style="font-size:10px;opacity:0.85;font-family:monospace;letter-spacing:0.08em">lo incolli nella chat</span></button>
              </div>
              <div id="suture-email-status" style="margin-top:10px;font-size:12px;color:#6f7580;text-align:center"></div>
            </div>
            <div style="padding:14px 28px;display:flex;justify-content:flex-end;gap:10px;background:#f5ecd8">
              <a href="${portaleUrl}?mode=rep" target="_blank" style="padding:10px 18px;background:transparent;border:1px solid rgba(10,22,40,0.2);border-radius:2px;text-decoration:none;color:#0a1628;font-weight:600;font-size:13px">Apri anteprima →</a>
              <button type="button" onclick="this.closest('.suture-modal-backdrop').remove();window.SUTURE.refresh()" style="background:#16a34a;color:#fff;border:none;padding:10px 22px;border-radius:2px;cursor:pointer;font-weight:700">✓ Fatto, aggiorna dashboard</button>
            </div>
          </div>`;
        document.body.appendChild(backdrop);
        backdrop.querySelector('#suture-copy-btn').addEventListener('click', e => {
            const inp = backdrop.querySelector('#suture-link-input');
            inp.select(); document.execCommand('copy');
            e.target.textContent = '✓ Copiato';
            setTimeout(() => { e.target.textContent = '📋 Copia'; }, 1500);
        });
        backdrop.querySelector('#suture-email-btn').addEventListener('click', async () => {
            // Pre-fetch email cliente dal CRM per pre-compilare input
            let emailProposta = '';
            try {
                const p = await api(`/api/proposte/${propostaId}`);
                emailProposta = (p.proposta && p.proposta.email) || '';
            } catch {}
            mostraModalInviaEmail(propostaId, emailProposta, mittenteEmail, backdrop);
        });
        backdrop.querySelector('#suture-wa-btn').addEventListener('click', () => {
            navigator.clipboard.writeText(waText).then(() => alert('Testo WhatsApp copiato negli appunti.'));
        });
    }

    // ==================== MODAL INVIO EMAIL (editabile) ====================
    function mostraModalInviaEmail(propostaId, emailProposta, mittenteEmail, parentBackdrop) {
        const m = document.createElement('div');
        m.className = 'suture-modal-backdrop';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(10,22,40,0.75);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px';
        m.innerHTML = `
          <div style="background:#fffdf7;max-width:480px;width:100%;border-radius:2px">
            <div style="padding:20px 28px;border-bottom:1px solid rgba(10,22,40,0.08)">
              <div style="font-family:monospace;font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#1a9e8f">Invia email via Mailgun</div>
              <h2 style="margin:4px 0 0;font-family:Georgia,serif;font-weight:400;font-size:20px">Conferma destinatario</h2>
            </div>
            <div style="padding:20px 28px">
              <label style="font-size:12px;color:#6f7580;display:block;margin-bottom:6px;font-family:monospace;letter-spacing:0.08em;text-transform:uppercase">Email cliente (modificabile)</label>
              <input type="email" id="suture-email-to" value="${esc(emailProposta)}" placeholder="cliente@esempio.it" style="width:100%;padding:12px;border:1px solid rgba(10,22,40,0.15);background:#f5ecd8;border-radius:2px;font-size:14px;font-family:monospace">
              <div style="font-size:11px;color:#6f7580;margin-top:8px">Pre-compilata dal CRM. Modificala se hai un'email aggiornata.</div>
              <div style="margin-top:16px;padding:12px;background:rgba(26,158,143,0.06);border-left:3px solid #1a9e8f;font-size:12px;color:#14243b">
                <strong>Mittente:</strong> ${esc(mittenteEmail)}<br>
                <strong>Oggetto:</strong> Proposta riordino suture · OSSEOTOUCH<br>
                <strong>Tracking:</strong> Mailgun (open + click)
              </div>
              <div id="suture-email-status-modal" style="margin-top:10px;font-size:12px;color:#6f7580"></div>
            </div>
            <div style="padding:14px 28px;display:flex;justify-content:flex-end;gap:10px;background:#f5ecd8">
              <button type="button" id="suture-email-cancel" style="background:transparent;border:1px solid rgba(10,22,40,0.2);padding:10px 20px;border-radius:2px;cursor:pointer;font-weight:600">Annulla</button>
              <button type="button" id="suture-email-send" style="background:#1a9e8f;color:#fff;border:none;padding:10px 22px;border-radius:2px;cursor:pointer;font-weight:700">✉️ Invia ora</button>
            </div>
          </div>`;
        document.body.appendChild(m);
        m.querySelector('#suture-email-cancel').addEventListener('click', () => m.remove());
        m.querySelector('#suture-email-send').addEventListener('click', async () => {
            const input = m.querySelector('#suture-email-to');
            const to = input.value.trim();
            if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { alert('Inserisci un email valida.'); return; }
            const btn = m.querySelector('#suture-email-send');
            const status = m.querySelector('#suture-email-status-modal');
            btn.disabled = true;
            btn.textContent = 'Invio in corso…';
            try {
                const r = await api(`/api/proposte/${propostaId}/send-email`, {
                    method: 'POST',
                    body: JSON.stringify({ to_override: to }),
                });
                btn.style.background = '#16a34a';
                btn.textContent = '✓ Email inviata';
                status.innerHTML = `Inviata a <strong>${esc(r.sent_to || to)}</strong> da ${esc(r.from || mittenteEmail)}.`;
                setTimeout(() => {
                    m.remove();
                    if (parentBackdrop) {
                        const parentStatus = parentBackdrop.querySelector('#suture-email-status');
                        const parentBtn = parentBackdrop.querySelector('#suture-email-btn');
                        if (parentBtn) { parentBtn.style.background = '#16a34a'; parentBtn.innerHTML = '✓ Email inviata'; parentBtn.disabled = true; }
                        if (parentStatus) parentStatus.textContent = 'Inviata a ' + (r.sent_to || to);
                    }
                }, 1500);
            } catch (err) {
                btn.disabled = false;
                btn.style.background = '#1a9e8f';
                btn.textContent = '✉️ Invia ora';
                status.style.color = '#b91c1c';
                status.textContent = 'Errore: ' + err.message;
            }
        });
    }

    // ==================== MODAL CONFERMA MANUALE ====================
    function apriConfermaManuale(propostaId) {
        const backdrop = document.createElement('div');
        backdrop.className = 'suture-modal-backdrop';
        backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(10,22,40,0.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
        backdrop.innerHTML = `
          <div style="background:#fffdf7;max-width:520px;width:100%;border-radius:2px">
            <div style="padding:20px 28px;border-bottom:1px solid rgba(10,22,40,0.08)">
              <h2 style="margin:0;font-family:Georgia,serif;font-weight:400;font-size:20px">Conferma manuale proposta #${propostaId}</h2>
            </div>
            <div style="padding:20px 28px">
              <h3 style="font-family:Georgia,serif;font-weight:500;font-size:14px;margin:0 0 8px">Canale di conferma</h3>
              <select id="suture-conf-canale" style="width:100%;padding:10px;border:1px solid rgba(10,22,40,0.1);background:#f5ecd8;border-radius:2px">
                <option value="whatsapp">WhatsApp</option>
                <option value="telefono">Telefonica</option>
                <option value="email">Email</option>
                <option value="altro">Altro</option>
              </select>
              <h3 style="font-family:Georgia,serif;font-weight:500;font-size:14px;margin:14px 0 6px">Note interne</h3>
              <textarea id="suture-conf-note" placeholder="Dettagli della conferma, eventuali variazioni concordate…" style="width:100%;min-height:80px;padding:10px;border:1px solid rgba(10,22,40,0.1);background:#f5ecd8;border-radius:2px;font-family:inherit;font-size:14px;resize:vertical"></textarea>
            </div>
            <div style="padding:14px 28px;display:flex;justify-content:flex-end;gap:10px;background:#f5ecd8">
              <button type="button" onclick="this.closest('.suture-modal-backdrop').remove()" style="background:transparent;border:1px solid rgba(10,22,40,0.2);padding:10px 20px;border-radius:2px;cursor:pointer;font-weight:600">Annulla</button>
              <button type="button" id="suture-conf-btn" style="background:#a855f7;color:#fff;border:none;padding:10px 22px;border-radius:2px;cursor:pointer;font-weight:700">Conferma</button>
            </div>
          </div>`;
        document.body.appendChild(backdrop);
        backdrop.querySelector('#suture-conf-btn').addEventListener('click', async () => {
            const payload = {
                canale: backdrop.querySelector('#suture-conf-canale').value,
                note: backdrop.querySelector('#suture-conf-note').value.trim(),
                chi: REP,
            };
            try {
                await api(`/api/proposte/${propostaId}/conferma-manuale`, { method: 'POST', body: JSON.stringify(payload) });
                backdrop.remove();
                alert('Proposta registrata come confermata manualmente.');
                loadProposte();
            } catch (err) {
                alert('Errore: ' + err.message);
            }
        });
    }

    async function riattiva(id) {
        if (!confirm('Riattivare subito la proposta?\nIl cliente la rivedrà nel suo portale.')) return;
        try {
            await api(`/api/proposte/${id}/riattiva`, { method: 'POST' });
            loadProposte();
        } catch (err) { alert('Errore: ' + err.message); }
    }

    async function apriPortale(clienteId, mode) {
        try {
            const r = await api(`/api/suture/portale-cliente/${clienteId}`);
            const targetUrl = mode === 'rep' ? (r.url_rep || r.url) : (r.url || r.url_rep);
            if (!targetUrl) return alert('Impossibile ottenere il link del portale.');
            window.open(targetUrl, '_blank', 'noopener');
        } catch (err) {
            alert('Errore apertura portale: ' + err.message);
        }
    }

    async function revocaPortale(clienteId, nome) {
        if (!confirm(`Revocare il portale del cliente "${nome}"?\nIl link non sarà più accessibile. Questa operazione è irreversibile.`)) return;
        try {
            await api(`/api/suture/portale-cliente/${clienteId}/revoca`, {
                method: 'POST',
                body: JSON.stringify({ revocato_da: 'admin' }),
            });
            alert('Portale revocato.');
            loadClienti();
        } catch (err) {
            alert('Errore revoca: ' + err.message);
        }
    }

    window.SUTURE = {
        openComposer,
        apriConfermaManuale,
        riattiva,
        apriPortale,
        revocaPortale,
        refresh: () => { loadClienti(); loadProposte(); },
    };

    document.addEventListener('DOMContentLoaded', () => {
        loadClienti();
        loadProposte();
    });
})();
