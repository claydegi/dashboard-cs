// CRM Liguria - Dashboard interattiva
const API_URL = window.location.origin + '/api';
const ADMIN_KEY = new URLSearchParams(window.location.search).get('key') || '';

const PRODOTTI = ['MM','ELEVATE','BLACK RUBY','LC','FIRST','EASY IN','EASY PIN',
                  'CEP','GENOA','EASYROOT','IMPIANTI','SUTURE','BLEXO','GUIDATA','PT1'];
const PRODOTTI_RICORRENTI = ['BLEXO', 'CEP', 'SUTURE'];
// R2: prodotti indipendenti da MM (non richiedono Magnetic Mallet)
const PRODOTTI_INDIPENDENTI_DA_MM = ['IMPIANTI', 'EASYROOT', 'SUTURE', 'CEP'];

let allContatti = [];
let acquistiCache = {};
let acquistiCountMap = {};  // mappa contatto_prodotto -> count acquisti
let acquistiLastDateMap = {};  // mappa contatto_prodotto -> ultima data_fattura (YYYY-MM-DD)
let noteCountMap = {};      // mappa contatto_id -> num note
let currentSort = 'cognome';
let searchTerm = '';
let currentNoteContattoId = null;
let recognition = null;

document.addEventListener('DOMContentLoaded', () => {
    if (!ADMIN_KEY) {
        document.body.innerHTML = '<div class="container"><h1>Accesso negato</h1><p>Link non valido.</p></div>';
        return;
    }

    // Back button
    document.getElementById('btn-back').href = `/dashboard-kim.html?key=${ADMIN_KEY}`;

    renderTableHeader();
    caricaDati();

    document.getElementById('crm-search').addEventListener('input', (e) => {
        searchTerm = e.target.value.toLowerCase();
        renderTableBody();
    });

    document.getElementById('crm-sort').addEventListener('change', (e) => {
        currentSort = e.target.value;
        sortContatti();
        renderTableBody();
    });

    // Chiudi popup conferma cliccando fuori
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.crm-confirm-popup') && !e.target.closest('.crm-cell-empty') && !e.target.closest('.crm-x') && !e.target.closest('.crm-x-new') && !e.target.closest('.crm-x-no-storico')) {
            chiudiPopup();
        }
    });
});

function renderTableHeader() {
    const thead = document.getElementById('crm-thead');
    let html = '<tr><th>#</th><th>Cognome</th><th>Nome</th><th>Email</th><th>Telefono</th><th>Cellulare</th><th>Citta</th>';
    for (const p of PRODOTTI) {
        html += `<th class="prod">${p}</th>`;
    }
    html += '<th>Score</th><th class="prod" title="Note">&#9998;</th></tr>';
    thead.innerHTML = html;
}

async function caricaDati() {
    try {
        const [contattiRes, statsRes, noteRes] = await Promise.all([
            fetch(`${API_URL}/crm/contatti?regione=LIGURIA&key=${ADMIN_KEY}`),
            fetch(`${API_URL}/crm/stats?regione=LIGURIA&key=${ADMIN_KEY}`),
            fetch(`${API_URL}/crm/note/bulk?regione=LIGURIA&key=${ADMIN_KEY}`)
        ]);

        if (!contattiRes.ok || !statsRes.ok) throw new Error('Errore caricamento');

        allContatti = await contattiRes.json();
        const stats = await statsRes.json();

        // Note count
        if (noteRes.ok) {
            noteCountMap = await noteRes.json();
        }

        // Stats
        document.getElementById('stat-contatti').textContent = stats.tot_contatti;
        document.getElementById('stat-odoo').textContent = stats.nuovi_odoo;
        document.getElementById('stat-score').textContent = stats.con_score;

        // Salva mappa acquisti (contiene contatto_prodotto -> count) e ultima data
        if (allContatti.length > 0 && allContatti[0].acquisti_count) {
            acquistiCountMap = allContatti[0].acquisti_count;
        }
        if (allContatti.length > 0 && allContatti[0].acquisti_last_date) {
            acquistiLastDateMap = allContatti[0].acquisti_last_date;
        }

        // Build product set per contatto for sorting + applica R2 (MM obbligatorio)
        allContatti.forEach(c => {
            c._prodSet = new Set((c.prodotti || []).map(p => p.prodotto));

            // R2: se ha prodotti che richiedono MM ma non ha MM, aggiungi MM
            if (!c._prodSet.has('MM')) {
                const hasProdottoCheRichiedeMM = [...c._prodSet].some(p => !PRODOTTI_INDIPENDENTI_DA_MM.includes(p));
                if (hasProdottoCheRichiedeMM) {
                    c._prodSet.add('MM');
                    c.prodotti.push({ prodotto: 'MM', fonte: 'regola_R2', data_inserimento: null });
                }
            }

            c._numProd = c._prodSet.size;
            c._displayCognome = c.cognome || c.nome_azienda || '';
            c._displayNome = c.cognome ? (c.nome || '') : '';
        });

        sortContatti();
        renderTableBody();
    } catch (err) {
        console.error('Errore:', err);
        document.getElementById('crm-tbody').innerHTML =
            '<tr><td colspan="25"><div class="empty-state"><p>Errore di connessione. Riprova.</p></div></td></tr>';
    }
}

function sortContatti() {
    allContatti.sort((a, b) => {
        switch (currentSort) {
            case 'cognome':
                return (a._displayCognome || '').localeCompare(b._displayCognome || '', 'it', {sensitivity: 'base'})
                    || (a._displayNome || '').localeCompare(b._displayNome || '', 'it', {sensitivity: 'base'});
            case 'citta':
                return (a.citta || '').localeCompare(b.citta || '', 'it', {sensitivity: 'base'});
            case 'prodotti':
                return b._numProd - a._numProd;
            case 'score':
                return (b.score || 0) - (a.score || 0);
            default:
                return 0;
        }
    });
}

function renderTableBody() {
    const tbody = document.getElementById('crm-tbody');
    const filtered = searchTerm
        ? allContatti.filter(c => {
            const s = searchTerm;
            return (c._displayCognome || '').toLowerCase().includes(s)
                || (c._displayNome || '').toLowerCase().includes(s)
                || (c.citta || '').toLowerCase().includes(s)
                || (c.email || '').toLowerCase().includes(s)
                || (c.nome_azienda || '').toLowerCase().includes(s);
        })
        : allContatti;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="25"><div class="empty-state"><p>Nessun contatto trovato</p></div></td></tr>';
        return;
    }

    let html = '';
    filtered.forEach((c, idx) => {
        const rowNum = idx + 1;
        const isNuovo = c.fonte_sync ? ' crm-row-nuovo' : '';

        html += `<tr class="crm-row${isNuovo}" data-id="${c.id}">`;
        html += `<td>${rowNum}</td>`;
        html += `<td>${esc(c._displayCognome)}</td>`;
        html += `<td>${esc(c._displayNome)}</td>`;
        html += `<td class="crm-editable" onclick="inlineEdit(${c.id}, 'email', this)" title="Clicca per modificare">${esc(c.email || '')}</td>`;
        html += `<td class="crm-editable" onclick="inlineEdit(${c.id}, 'telefono', this)" title="Clicca per modificare">${esc(c.telefono || '')}</td>`;
        html += `<td class="crm-editable" onclick="inlineEdit(${c.id}, 'cellulare', this)" title="Clicca per modificare">${esc(c.cellulare || '')}</td>`;
        html += `<td class="crm-editable${c.citta ? '' : ' crm-empty'}" onclick="inlineEdit(${c.id}, 'citta', this)" title="Clicca per modificare">${c.citta ? esc(c.citta) : '&mdash;'}</td>`;

        // Prodotti
        for (const p of PRODOTTI) {
            if (c._prodSet.has(p)) {
                const prodInfo = (c.prodotti || []).find(pr => pr.prodotto === p);
                const isOdoo = prodInfo && prodInfo.fonte && prodInfo.fonte.startsWith('odoo:');
                const isManual = prodInfo && prodInfo.fonte === 'dashboard_manual';
                const isRicorrente = PRODOTTI_RICORRENTI.includes(p);

                if (isRicorrente) {
                    const acqKey = `${c.id}_${p}`;
                    const haStorico = (acquistiCountMap[acqKey] || 0) > 0;
                    let cls;
                    if (!haStorico) {
                        cls = 'crm-x-no-storico crm-x-ricorrente';
                    } else if (isOdoo) {
                        cls = 'crm-x-new crm-x-ricorrente';
                    } else {
                        cls = 'crm-x crm-x-ricorrente';
                    }
                    const alert = haStorico && needsReorderAlert(c.id, p);
                    const cellContent = 'X';
                    if (alert) cls += ' crm-reorder-alert-cell';
                    const defaultMesiTooltip = (p === 'BLEXO') ? 4 : 2;
                    const mesiSoglia = (c.mesi_riordino || defaultMesiTooltip);
                    const titleText = alert
                        ? `Ultimo acquisto oltre ${mesiSoglia} mesi fa - riordinare!`
                        : (haStorico ? 'Clicca per storico acquisti' : 'Nessun acquisto registrato - clicca per dettagli');
                    html += `<td class="${cls}" onclick="toggleAcquisti(${c.id}, '${p}', this)" ondblclick="rimuoviProdotto(${c.id}, '${p}', this, event)" title="${titleText}">${cellContent}</td>`;
                } else if (isOdoo) {
                    html += `<td class="crm-x-new" ondblclick="rimuoviProdotto(${c.id}, '${p}', this, event)" title="Doppio click per rimuovere">X</td>`;
                } else if (isManual) {
                    html += `<td class="crm-x crm-x-manual" ondblclick="rimuoviProdotto(${c.id}, '${p}', this, event)" title="Aggiunto manualmente - doppio click per rimuovere">X</td>`;
                } else {
                    html += `<td class="crm-x" ondblclick="rimuoviProdotto(${c.id}, '${p}', this, event)" title="Doppio click per rimuovere">X</td>`;
                }
            } else {
                // Cella vuota cliccabile per aggiungere prodotto
                html += `<td class="crm-cell-empty" onclick="aggiungiProdotto(${c.id}, '${p}', this)" title="Aggiungi ${p}"></td>`;
            }
        }

        // Score
        if (c.score) {
            html += `<td class="crm-score">${c.score}</td>`;
        } else {
            html += '<td></td>';
        }

        // Note
        const numNote = noteCountMap[c.id] || 0;
        const noteClass = numNote > 0 ? 'crm-note-icon crm-note-has' : 'crm-note-icon';
        const noteTitle = numNote > 0 ? `${numNote} nota/e - clicca per vedere` : 'Aggiungi nota';
        html += `<td class="${noteClass}" onclick="apriNote(${c.id}, '${esc(c._displayCognome)}', '${esc(c._displayNome)}')" title="${noteTitle}">&#9998;</td>`;

        html += '</tr>';
    });

    tbody.innerHTML = html;

    // Aggiorna header alert riordini
    aggiornaHeaderAlert();
}

// ==================== INLINE EDIT CAMPI CONTATTO ====================

function inlineEdit(contattoId, campo, tdEl) {
    // Evita doppio click se già in editing
    if (tdEl.querySelector('input')) return;

    const contatto = allContatti.find(c => c.id === contattoId);
    if (!contatto) return;

    const valoreAttuale = contatto[campo] || '';
    const larghezza = Math.max(tdEl.offsetWidth - 12, 60);

    tdEl.classList.add('crm-editing');
    tdEl.innerHTML = `<input type="text" class="crm-inline-input" value="${esc(valoreAttuale)}" style="width:${larghezza}px;" />`;

    const input = tdEl.querySelector('input');
    input.focus();
    input.select();

    // Salva su Enter, annulla su Escape
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); salvaInlineEdit(contattoId, campo, input.value, tdEl, valoreAttuale); }
        if (e.key === 'Escape') { ripristinaCell(tdEl, campo, valoreAttuale); }
    });

    // Salva su blur (click fuori)
    input.addEventListener('blur', () => {
        // Piccolo delay per evitare conflitto con Enter
        setTimeout(() => {
            if (tdEl.querySelector('input')) {
                salvaInlineEdit(contattoId, campo, input.value, tdEl, valoreAttuale);
            }
        }, 100);
    });
}

async function salvaInlineEdit(contattoId, campo, nuovoValore, tdEl, vecchioValore) {
    nuovoValore = nuovoValore.trim();
    // R3: citta maiuscolo lato client per feedback immediato
    if (campo === 'citta') nuovoValore = nuovoValore.toUpperCase();

    // Se non è cambiato, ripristina senza chiamata API
    if (nuovoValore === (vecchioValore || '')) {
        ripristinaCell(tdEl, campo, vecchioValore);
        return;
    }

    try {
        const res = await fetch(`${API_URL}/crm/contatti/${contattoId}?key=${ADMIN_KEY}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campo, valore: nuovoValore })
        });
        const data = await res.json();
        if (!res.ok) { mostraToast(data.error || 'Errore', 'error'); ripristinaCell(tdEl, campo, vecchioValore); return; }

        // Aggiorna dato locale
        const contatto = allContatti.find(c => c.id === contattoId);
        if (contatto) contatto[campo] = data.valore || '';

        ripristinaCell(tdEl, campo, data.valore || '');
        mostraToast(`${campo} aggiornato`, 'success');
    } catch (err) {
        mostraToast('Errore di connessione', 'error');
        ripristinaCell(tdEl, campo, vecchioValore);
    }
}

function ripristinaCell(tdEl, campo, valore) {
    tdEl.classList.remove('crm-editing');
    if (!valore && campo === 'citta') {
        tdEl.classList.add('crm-empty');
        tdEl.innerHTML = '&mdash;';
    } else {
        tdEl.classList.remove('crm-empty');
        tdEl.textContent = valore || '';
    }
}

// ==================== HEADER ALERT RIORDINI ====================

function aggiornaHeaderAlert() {
    const msgEl = document.getElementById('header-alert-msg');
    const boxEl = document.getElementById('header-alert-riordini');
    if (!msgEl || !boxEl) return;

    // Conta contatti UNICI che hanno almeno un prodotto ricorrente in alert
    const contattiConAlert = new Set();
    for (const c of allContatti) {
        for (const p of PRODOTTI_RICORRENTI) {
            if (c._prodSet.has(p)) {
                const acqKey = `${c.id}_${p}`;
                const haStorico = (acquistiCountMap[acqKey] || 0) > 0;
                if (haStorico && needsReorderAlert(c.id, p)) {
                    contattiConAlert.add(c.id);
                }
            }
        }
    }

    const n = contattiConAlert.size;
    boxEl.classList.remove('header-alert-red', 'header-alert-yellow', 'header-alert-green');

    if (n > 5) {
        msgEl.innerHTML = `Varda che a-i &eacute; pi che sinch clienti pront p&euml;r &euml;l r&euml;&ograve;rdin, neh. <strong>(${n})</strong>`;
        boxEl.classList.add('header-alert-red');
    } else if (n > 0) {
        msgEl.textContent = `Alcuni riordini da valutare (${n})`;
        boxEl.classList.add('header-alert-yellow');
    } else {
        msgEl.textContent = 'Nessun riordino da sollecitare al momento';
        boxEl.classList.add('header-alert-green');
    }
}

// ==================== ALERT RIORDINO PRODOTTI RICORRENTI ====================

function needsReorderAlert(contattoId, prodotto) {
    const acqKey = `${contattoId}_${prodotto}`;
    const ultimaData = acquistiLastDateMap[acqKey];
    if (!ultimaData) return false;  // nessuna data = nessun alert (X rossa non ha storico)

    const contatto = allContatti.find(c => c.id === contattoId);
    const defaultMesi = (prodotto === 'BLEXO') ? 4 : 2;
    const mesiSoglia = (contatto && contatto.mesi_riordino) || defaultMesi;

    const lastDate = new Date(ultimaData);
    const oggi = new Date();
    const diffMs = oggi - lastDate;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const sogliaGiorni = mesiSoglia * 30;

    return diffDays > sogliaGiorni;
}

// ==================== FEATURE 1: ADD/REMOVE PRODOTTI ====================

function aggiungiProdotto(contattoId, prodotto, cellEl) {
    chiudiPopup();
    const rect = cellEl.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.className = 'crm-confirm-popup';
    popup.innerHTML = `
        <p>Aggiungere <strong>${prodotto}</strong>?</p>
        <div class="crm-confirm-btns">
            <button class="crm-btn-si" onclick="confermaAggiungiProdotto(${contattoId}, '${prodotto}')">Si</button>
            <button class="crm-btn-no" onclick="chiudiPopup()">No</button>
        </div>
    `;
    popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    popup.style.left = (rect.left + window.scrollX) + 'px';
    document.body.appendChild(popup);
}

async function confermaAggiungiProdotto(contattoId, prodotto) {
    chiudiPopup();
    try {
        const res = await fetch(`${API_URL}/crm/contatti/${contattoId}/prodotti?key=${ADMIN_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prodotto })
        });
        const data = await res.json();
        if (!res.ok) {
            mostraToast(data.error || 'Errore', 'error');
            return;
        }
        // Aggiorna dati locali
        const contatto = allContatti.find(c => c.id === contattoId);
        if (contatto) {
            for (const p of data.prodotti_aggiunti) {
                if (!contatto._prodSet.has(p)) {
                    contatto._prodSet.add(p);
                    contatto.prodotti.push({ prodotto: p, fonte: 'dashboard_manual', data_inserimento: new Date().toISOString().split('T')[0] });
                }
            }
            contatto._numProd = contatto._prodSet.size;
        }
        renderTableBody();
        mostraToast(data.messaggio, 'success');
    } catch (err) {
        mostraToast('Errore di connessione', 'error');
    }
}

function rimuoviProdotto(contattoId, prodotto, cellEl, event) {
    if (event) event.stopPropagation();
    chiudiPopup();
    const rect = cellEl.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.className = 'crm-confirm-popup';
    popup.innerHTML = `
        <p>Rimuovere <strong>${prodotto}</strong>?</p>
        <div class="crm-confirm-btns">
            <button class="crm-btn-si crm-btn-danger" onclick="confermaRimuoviProdotto(${contattoId}, '${prodotto}')">Si</button>
            <button class="crm-btn-no" onclick="chiudiPopup()">No</button>
        </div>
    `;
    popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    popup.style.left = (rect.left + window.scrollX) + 'px';
    document.body.appendChild(popup);
}

async function confermaRimuoviProdotto(contattoId, prodotto) {
    chiudiPopup();
    try {
        const res = await fetch(`${API_URL}/crm/contatti/${contattoId}/prodotti/${encodeURIComponent(prodotto)}?key=${ADMIN_KEY}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (!res.ok) {
            mostraToast(data.error || 'Errore', 'error');
            return;
        }
        // Aggiorna dati locali
        const contatto = allContatti.find(c => c.id === contattoId);
        if (contatto) {
            for (const p of data.prodotti_rimossi) {
                contatto._prodSet.delete(p);
                contatto.prodotti = contatto.prodotti.filter(pr => pr.prodotto !== p);
            }
            contatto._numProd = contatto._prodSet.size;
        }
        // Chiudi eventuali detail row aperti
        document.querySelectorAll('.crm-detail-row').forEach(el => el.remove());
        renderTableBody();
        mostraToast(data.messaggio, 'success');
    } catch (err) {
        mostraToast('Errore di connessione', 'error');
    }
}

function chiudiPopup() {
    document.querySelectorAll('.crm-confirm-popup').forEach(el => el.remove());
}

// ==================== FEATURE 2: ACQUISTI RICORRENTI ====================

async function toggleAcquisti(contattoId, prodotto, cellEl) {
    const row = cellEl.closest('tr');
    const existingDetail = row.nextElementSibling;

    // Se il dettaglio e' gia' visibile, chiudilo
    if (existingDetail && existingDetail.classList.contains('crm-detail-row')) {
        existingDetail.remove();
        return;
    }

    // Rimuovi eventuali altri dettagli aperti
    document.querySelectorAll('.crm-detail-row').forEach(el => el.remove());

    // Fetch acquisti (con cache)
    const cacheKey = `${contattoId}`;
    let acquisti;
    if (acquistiCache[cacheKey]) {
        acquisti = acquistiCache[cacheKey];
    } else {
        try {
            const res = await fetch(`${API_URL}/crm/contatti/${contattoId}/acquisti?key=${ADMIN_KEY}`);
            if (!res.ok) throw new Error('Errore');
            acquisti = await res.json();
            acquistiCache[cacheKey] = acquisti;
        } catch (err) {
            console.error('Errore fetch acquisti:', err);
            return;
        }
    }

    // Filtra per prodotto
    const filtrati = acquisti.filter(a => a.prodotto === prodotto);

    // Crea riga dettaglio
    const detailRow = document.createElement('tr');
    detailRow.classList.add('crm-detail-row');
    const totalCols = 7 + PRODOTTI.length + 2; // # + 6 campi + prodotti + score + note

    let contentHtml = `<td colspan="${totalCols}" class="crm-detail-cell"><div class="crm-detail-content">`;

    if (filtrati.length === 0) {
        contentHtml += `<strong>Storico ${prodotto}</strong><p>Nessun acquisto registrato nello storico.</p>`;
    } else {
        contentHtml += `<strong>Storico acquisti ${prodotto} (${filtrati.length} ${filtrati.length === 1 ? 'acquisto' : 'acquisti'})</strong>`;
        contentHtml += '<table class="crm-acquisti-table"><thead><tr><th>Fattura</th><th>Data</th><th>Descrizione</th><th>Fonte</th><th></th></tr></thead><tbody>';
        for (const a of filtrati) {
            const dataFmt = a.data_fattura ? formatDate(a.data_fattura) : '-';
            contentHtml += `<tr>
                <td>${esc(a.numero_fattura || '-')}</td>
                <td>${dataFmt}</td>
                <td>${esc(a.descrizione || '-')}</td>
                <td>${esc(a.fonte || '-')}</td>
                <td><span class="crm-delete-acq" title="Elimina" onclick="eliminaAcquisto(${a.id}, ${contattoId}, '${prodotto}')">&times;</span></td>
            </tr>`;
        }
        contentHtml += '</tbody></table>';
    }

    // Form aggiungi acquisto
    contentHtml += `
        <div class="crm-add-acquisto" style="margin-top:12px;padding-top:12px;border-top:1px dashed #ccc;">
            <strong style="font-size:12px;">Aggiungi acquisto ${prodotto}:</strong>
            <div class="crm-add-acquisto-form">
                <input type="text" placeholder="N. Fattura" id="acq-fattura-${contattoId}-${prodotto}" class="crm-input-small">
                <input type="text" placeholder="gg/mm/aaaa" id="acq-data-${contattoId}-${prodotto}" class="crm-input-small" style="width:110px">
                <input type="text" placeholder="Descrizione (opzionale)" id="acq-desc-${contattoId}-${prodotto}" class="crm-input-small" style="width:200px">
                <button class="crm-btn-si" onclick="salvaAcquisto(${contattoId}, '${prodotto}')">Salva</button>
            </div>
        </div>`;

    // Soglia riordino personalizzabile
    const contatto = allContatti.find(c => c.id === contattoId);
    const defaultMesiSel = (prodotto === 'BLEXO') ? 4 : 2;
    const mesiAttuali = (contatto && contatto.mesi_riordino) || defaultMesiSel;
    contentHtml += `
        <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #ccc;">
            <strong style="font-size:12px;">Soglia alert riordino per questo contatto:</strong>
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                <select id="mesi-riordino-${contattoId}" class="crm-input-small" style="width:80px;">
                    ${[1,2,3,4,5,6].map(m =>
                        `<option value="${m}" ${m === mesiAttuali ? 'selected' : ''}>${m} ${m === 1 ? 'mese' : 'mesi'}</option>`
                    ).join('')}
                </select>
                <button class="crm-btn-si" onclick="salvaMesiRiordino(${contattoId})">Salva</button>
                <span style="font-size:11px;color:#7f8c8d;">Avviso se l'ultimo acquisto supera questa soglia</span>
            </div>
        </div>`;

    contentHtml += '</div></td>';
    detailRow.innerHTML = contentHtml;
    row.after(detailRow);
}

async function salvaAcquisto(contattoId, prodotto) {
    const fattura = document.getElementById(`acq-fattura-${contattoId}-${prodotto}`);
    const dataInput = document.getElementById(`acq-data-${contattoId}-${prodotto}`);
    const descInput = document.getElementById(`acq-desc-${contattoId}-${prodotto}`);

    if (!fattura || !dataInput) return;

    const numeroFattura = fattura.value.trim();
    const dataItStr = dataInput.value.trim();
    const descrizione = descInput ? descInput.value.trim() : '';

    if (!numeroFattura) {
        mostraToast('Inserisci il numero fattura', 'error');
        fattura.focus();
        return;
    }
    if (!dataItStr) {
        mostraToast('Inserisci la data (gg/mm/aaaa)', 'error');
        dataInput.focus();
        return;
    }

    // Converti gg/mm/aaaa -> YYYY-MM-DD
    const dataFattura = convertiDataItToIso(dataItStr);
    if (!dataFattura) {
        mostraToast('Formato data non valido. Usa gg/mm/aaaa', 'error');
        dataInput.focus();
        return;
    }

    try {
        const res = await fetch(`${API_URL}/crm/contatti/${contattoId}/acquisti?key=${ADMIN_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prodotto, numero_fattura: numeroFattura, data_fattura: dataFattura, descrizione })
        });
        const data = await res.json();
        if (!res.ok) {
            mostraToast(data.error || 'Errore', 'error');
            return;
        }

        // Invalida cache e aggiorna count + ultima data
        delete acquistiCache[`${contattoId}`];
        const acqKey = `${contattoId}_${prodotto}`;
        acquistiCountMap[acqKey] = (acquistiCountMap[acqKey] || 0) + 1;
        // Aggiorna ultima data se questa e' piu' recente
        if (!acquistiLastDateMap[acqKey] || dataFattura > acquistiLastDateMap[acqKey]) {
            acquistiLastDateMap[acqKey] = dataFattura;
        }

        // Se il prodotto e' stato aggiunto automaticamente, aggiorna dati locali
        if (data.prodotto_aggiunto) {
            const contatto = allContatti.find(c => c.id === contattoId);
            if (contatto && !contatto._prodSet.has(prodotto)) {
                contatto._prodSet.add(prodotto);
                contatto.prodotti.push({ prodotto, fonte: 'dashboard_manual', data_inserimento: new Date().toISOString().split('T')[0] });
                contatto._numProd = contatto._prodSet.size;
            }
        }

        // Chiudi detail row e re-render (la X passera' da rossa a verde se era il primo acquisto)
        document.querySelectorAll('.crm-detail-row').forEach(el => el.remove());
        renderTableBody();
        mostraToast(`Acquisto ${prodotto} registrato`, 'success');
    } catch (err) {
        mostraToast('Errore di connessione', 'error');
    }
}

async function eliminaAcquisto(acquistoId, contattoId, prodotto) {
    if (!confirm(`Eliminare questo acquisto ${prodotto}?`)) return;
    try {
        const res = await fetch(`${API_URL}/crm/acquisti/${acquistoId}?key=${ADMIN_KEY}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
            mostraToast(data.error || 'Errore', 'error');
            return;
        }
        // Aggiorna count
        delete acquistiCache[`${contattoId}`];
        const acqKey = `${contattoId}_${prodotto}`;
        if (acquistiCountMap[acqKey]) acquistiCountMap[acqKey]--;

        // Chiudi detail row e re-render
        document.querySelectorAll('.crm-detail-row').forEach(el => el.remove());
        renderTableBody();
        mostraToast('Acquisto eliminato', 'success');
    } catch (err) {
        mostraToast('Errore di connessione', 'error');
    }
}

function convertiDataItToIso(dataIt) {
    // gg/mm/aaaa -> YYYY-MM-DD
    const match = dataIt.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (!match) return null;
    const gg = match[1].padStart(2, '0');
    const mm = match[2].padStart(2, '0');
    const aaaa = match[3];
    if (parseInt(mm) < 1 || parseInt(mm) > 12 || parseInt(gg) < 1 || parseInt(gg) > 31) return null;
    return `${aaaa}-${mm}-${gg}`;
}

// ==================== SOGLIA RIORDINO ====================

async function salvaMesiRiordino(contattoId) {
    const select = document.getElementById(`mesi-riordino-${contattoId}`);
    if (!select) return;
    const mesi = parseInt(select.value);

    try {
        const res = await fetch(`${API_URL}/crm/contatti/${contattoId}/mesi-riordino?key=${ADMIN_KEY}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mesi })
        });
        const data = await res.json();
        if (!res.ok) {
            mostraToast(data.error || 'Errore', 'error');
            return;
        }
        // Aggiorna dati locali
        const contatto = allContatti.find(c => c.id === contattoId);
        if (contatto) contatto.mesi_riordino = mesi;

        // Chiudi detail e ri-renderizza (gli alert si aggiornano)
        document.querySelectorAll('.crm-detail-row').forEach(el => el.remove());
        renderTableBody();
        mostraToast(`Soglia impostata a ${mesi} ${mesi === 1 ? 'mese' : 'mesi'}`, 'success');
    } catch (err) {
        mostraToast('Errore di connessione', 'error');
    }
}

// ==================== FEATURE 3: NOTE CON AUDIO ====================

async function apriNote(contattoId, cognome, nome) {
    currentNoteContattoId = contattoId;
    const panel = document.getElementById('crm-notes-panel');
    const title = document.getElementById('notes-panel-title');
    const lista = document.getElementById('notes-lista');
    const textarea = document.getElementById('notes-textarea');

    title.textContent = `Note: ${cognome}${nome ? ' ' + nome : ''}`;
    textarea.value = '';
    lista.innerHTML = '<p style="color:#999;font-size:12px;">Caricamento...</p>';

    panel.classList.add('open');

    // Carica note
    try {
        const res = await fetch(`${API_URL}/crm/contatti/${contattoId}/note?key=${ADMIN_KEY}`);
        if (!res.ok) throw new Error('Errore');
        const note = await res.json();

        if (note.length === 0) {
            lista.innerHTML = '<p style="color:#999;font-size:12px;">Nessuna nota ancora.</p>';
        } else {
            lista.innerHTML = renderNoteList(note);
        }
    } catch (err) {
        lista.innerHTML = '<p style="color:#e74c3c;font-size:12px;">Errore caricamento note.</p>';
    }
}

function renderNoteList(note) {
    let html = '';
    for (const n of note) {
        const dataFmt = n.created_at ? new Date(n.created_at).toLocaleString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : '';
        html += `<div class="crm-nota-entry" id="nota-${n.id}">
            <div class="crm-nota-header">
                <span class="crm-nota-data">${dataFmt}</span>
                <span class="crm-nota-actions">
                    <span class="crm-nota-btn" title="Modifica" onclick="modificaNota(${n.id})">&#9998;</span>
                    <span class="crm-nota-btn crm-nota-btn-del" title="Elimina" onclick="eliminaNota(${n.id})">&times;</span>
                </span>
            </div>
            <p class="crm-nota-testo" id="nota-testo-${n.id}">${esc(n.testo)}</p>
        </div>`;
    }
    return html;
}

async function eliminaNota(noteId) {
    if (!confirm('Eliminare questa nota?')) return;
    try {
        const res = await fetch(`${API_URL}/crm/note/${noteId}?key=${ADMIN_KEY}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
            mostraToast(data.error || 'Errore', 'error');
            return;
        }
        // Rimuovi dal DOM
        const entry = document.getElementById(`nota-${noteId}`);
        if (entry) entry.remove();
        // Aggiorna conteggio
        if (currentNoteContattoId && noteCountMap[currentNoteContattoId]) {
            noteCountMap[currentNoteContattoId]--;
            renderTableBody();
        }
        const lista = document.getElementById('notes-lista');
        if (!lista.querySelector('.crm-nota-entry')) {
            lista.innerHTML = '<p style="color:#999;font-size:12px;">Nessuna nota ancora.</p>';
        }
        mostraToast('Nota eliminata', 'success');
    } catch (err) {
        mostraToast('Errore di connessione', 'error');
    }
}

function modificaNota(noteId) {
    const testoEl = document.getElementById(`nota-testo-${noteId}`);
    if (!testoEl) return;
    const testoAttuale = testoEl.textContent;
    const entry = document.getElementById(`nota-${noteId}`);
    // Sostituisci il testo con una textarea editabile
    testoEl.style.display = 'none';
    const editDiv = document.createElement('div');
    editDiv.className = 'crm-nota-edit';
    editDiv.innerHTML = `
        <textarea class="crm-nota-edit-textarea" id="nota-edit-${noteId}" rows="3">${esc(testoAttuale)}</textarea>
        <div class="crm-nota-edit-actions">
            <button class="crm-btn-si" onclick="salvaModificaNota(${noteId})">Salva</button>
            <button class="crm-btn-no" onclick="annullaModificaNota(${noteId})">Annulla</button>
        </div>`;
    entry.appendChild(editDiv);
    document.getElementById(`nota-edit-${noteId}`).focus();
}

function annullaModificaNota(noteId) {
    const entry = document.getElementById(`nota-${noteId}`);
    const editDiv = entry.querySelector('.crm-nota-edit');
    if (editDiv) editDiv.remove();
    const testoEl = document.getElementById(`nota-testo-${noteId}`);
    if (testoEl) testoEl.style.display = '';
}

async function salvaModificaNota(noteId) {
    const textarea = document.getElementById(`nota-edit-${noteId}`);
    if (!textarea) return;
    const nuovoTesto = textarea.value.trim();
    if (!nuovoTesto) {
        mostraToast('Il testo non puo essere vuoto', 'error');
        return;
    }
    try {
        const res = await fetch(`${API_URL}/crm/note/${noteId}?key=${ADMIN_KEY}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testo: nuovoTesto })
        });
        const data = await res.json();
        if (!res.ok) {
            mostraToast(data.error || 'Errore', 'error');
            return;
        }
        // Aggiorna nel DOM
        const testoEl = document.getElementById(`nota-testo-${noteId}`);
        testoEl.textContent = nuovoTesto;
        annullaModificaNota(noteId);
        mostraToast('Nota modificata', 'success');
    } catch (err) {
        mostraToast('Errore di connessione', 'error');
    }
}

function chiudiNote() {
    document.getElementById('crm-notes-panel').classList.remove('open');
    currentNoteContattoId = null;
    stopDettatura();
}

async function salvaNote() {
    if (!currentNoteContattoId) return;
    const textarea = document.getElementById('notes-textarea');
    const testo = textarea.value.trim();
    if (!testo) {
        mostraToast('Scrivi qualcosa prima di salvare', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/crm/contatti/${currentNoteContattoId}/note?key=${ADMIN_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testo })
        });
        const data = await res.json();
        if (!res.ok) {
            mostraToast(data.error || 'Errore', 'error');
            return;
        }

        // Aggiorna conteggio note locali
        noteCountMap[currentNoteContattoId] = (noteCountMap[currentNoteContattoId] || 0) + 1;
        renderTableBody();

        // Ricarica lista note dal server (per avere gli id corretti)
        const lista = document.getElementById('notes-lista');
        try {
            const res2 = await fetch(`${API_URL}/crm/contatti/${currentNoteContattoId}/note?key=${ADMIN_KEY}`);
            const noteAggiornate = await res2.json();
            lista.innerHTML = noteAggiornate.length > 0 ? renderNoteList(noteAggiornate) : '<p style="color:#999;font-size:12px;">Nessuna nota ancora.</p>';
        } catch (e) { /* ignora, la nota e' salvata comunque */ }

        textarea.value = '';
        mostraToast('Nota salvata', 'success');
    } catch (err) {
        mostraToast('Errore di connessione', 'error');
    }
}

// ==================== TRASCRIZIONE AUDIO ====================

function toggleDettatura() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        mostraToast('Browser non supportato. Usa Chrome o Edge.', 'error');
        return;
    }

    if (recognition) {
        stopDettatura();
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'it-IT';
    recognition.continuous = true;
    recognition.interimResults = true;

    const micBtn = document.getElementById('btn-mic');
    const micStatus = document.getElementById('mic-status');
    const textarea = document.getElementById('notes-textarea');

    let finalTranscript = textarea.value;

    recognition.onstart = () => {
        micBtn.classList.add('recording');
        micStatus.textContent = 'In ascolto...';
    };

    recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += (finalTranscript ? ' ' : '') + transcript;
            } else {
                interim += transcript;
            }
        }
        textarea.value = finalTranscript + (interim ? ' ' + interim : '');
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
            mostraToast('Permesso microfono negato', 'error');
        }
        stopDettatura();
    };

    recognition.onend = () => {
        // Auto-restart se ancora in modalita' registrazione
        if (recognition) {
            try { recognition.start(); } catch (e) { stopDettatura(); }
        }
    };

    try {
        recognition.start();
    } catch (e) {
        mostraToast('Errore avvio microfono', 'error');
        stopDettatura();
    }
}

function stopDettatura() {
    if (recognition) {
        const r = recognition;
        recognition = null; // Imposta a null PRIMA di stop per evitare auto-restart
        try { r.stop(); } catch (e) {}
    }
    const micBtn = document.getElementById('btn-mic');
    const micStatus = document.getElementById('mic-status');
    if (micBtn) micBtn.classList.remove('recording');
    if (micStatus) micStatus.textContent = '';
}

// ==================== UTILITY ====================

function mostraToast(messaggio, tipo) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `crm-toast crm-toast-${tipo || 'info'}`;
    toast.textContent = messaggio;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return dateStr;
}

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
