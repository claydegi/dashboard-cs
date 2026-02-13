// CRM Liguria - Dashboard interattiva
const API_URL = window.location.origin + '/api';
const ADMIN_KEY = new URLSearchParams(window.location.search).get('key') || '';

const PRODOTTI = ['MM','ELEVATE','BLACK RUBY','LC','FIRST','EASY IN','EASY PIN',
                  'CEP','GENOA','EASYROOT','IMPIANTI','SUTURE','BLEXO','GUIDATA','PT1'];
const PRODOTTI_RICORRENTI = ['BLEXO', 'CEP', 'SUTURE'];
// R2: prodotti indipendenti da MM (non richiedono Magnetic Mallet)
const PRODOTTI_INDIPENDENTI_DA_MM = ['IMPIANTI', 'EASYROOT', 'SUTURE', 'CEP'];

const REGIONI_ITALIA = [
    'PIEMONTE', 'LIGURIA', "VALLE D'AOSTA", 'LOMBARDIA', 'VENETO',
    'TRENTINO-ALTO ADIGE', 'FRIULI VENEZIA GIULIA', 'EMILIA-ROMAGNA',
    'TOSCANA', 'UMBRIA', 'MARCHE', 'LAZIO', 'ABRUZZO', 'MOLISE',
    'CAMPANIA', 'PUGLIA', 'BASILICATA', 'CALABRIA', 'SICILIA', 'SARDEGNA'
];

let allContatti = [];
let accountContatti = [];
let leadContatti = [];
let acquistiCache = {};
let acquistiCountMap = {};  // mappa contatto_prodotto -> count acquisti
let acquistiLastDateMap = {};  // mappa contatto_prodotto -> ultima data_fattura (YYYY-MM-DD)
let noteCountMap = {};      // mappa contatto_id -> num note
let oppCountMap = {};       // mappa contatto_id -> num opportunita
let oppScaduteMap = {};     // mappa contatto_id -> num opportunita scadute non viste
let scoreHotMap = {};       // mappa contatto_id -> {linea_prodotto: score} per score >= 40
let currentSort = 'cognome';
let currentLeadSort = 'cognome';
let searchTerm = '';
let filterWhatsApp = false;
let currentNoteContattoId = null;
let recognition = null;
let currentDettTarget = null; // 'note' o 'opp' - quale textarea sta usando la dettatura
let promuoviContattoId = null; // ID contatto per popup promuovi
let retrocediContattoId = null; // ID contatto per popup retrocedi
let scoreContattoId = null; // ID contatto per modal score manuale
let scoreContattoTipo = null; // 'account' o 'lead'

document.addEventListener('DOMContentLoaded', () => {
    if (!ADMIN_KEY) {
        document.body.innerHTML = '<div class="container"><h1>Accesso negato</h1><p>Link non valido.</p></div>';
        return;
    }

    // Back button
    document.getElementById('btn-back').href = `/dashboard-kim.html?key=${ADMIN_KEY}`;

    renderTableHeader();
    caricaDati();

    // Stat card score -> naviga a pagina score
    document.getElementById('stat-card-score').addEventListener('click', () => {
        window.location.href = `/crm-score?key=${ADMIN_KEY}`;
    });

    document.getElementById('crm-search').addEventListener('input', (e) => {
        searchTerm = e.target.value.toLowerCase();
        renderTableBody();
        renderLeadTable();
    });

    document.getElementById('btn-filter-whatsapp').addEventListener('click', () => {
        filterWhatsApp = !filterWhatsApp;
        document.getElementById('btn-filter-whatsapp').classList.toggle('active', filterWhatsApp);
        renderTableBody();
        renderLeadTable();
    });

    document.getElementById('crm-sort').addEventListener('change', (e) => {
        currentSort = e.target.value;
        sortContatti();
        renderTableBody();
        renderLeadTable();
    });

    document.getElementById('crm-lead-sort').addEventListener('change', (e) => {
        currentLeadSort = e.target.value;
        sortContatti();
        renderLeadTable();
    });

    // Chiudi popup conferma cliccando fuori
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.crm-confirm-popup') && !e.target.closest('.crm-cell-empty') && !e.target.closest('.crm-x') && !e.target.closest('.crm-x-new') && !e.target.closest('.crm-x-no-storico')) {
            chiudiPopup();
        }
    });

    // Nuovo contatto: event listener
    document.getElementById('btn-nuovo-contatto').addEventListener('click', apriModalNuovoContatto);
    document.getElementById('modal-nuovo-close').addEventListener('click', chiudiModalNuovo);
    document.getElementById('btn-annulla-nuovo').addEventListener('click', chiudiModalNuovo);
    document.getElementById('btn-salva-nuovo').addEventListener('click', salvaNuovoContatto);

    document.querySelectorAll('input[name="nuovo-tipo"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            document.getElementById('nuovo-prodotti-section').style.display = e.target.value === 'account' ? 'block' : 'none';
        });
    });

    document.getElementById('modal-nuovo-contatto').addEventListener('click', (e) => {
        if (e.target.id === 'modal-nuovo-contatto') chiudiModalNuovo();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.getElementById('modal-promuovi').classList.contains('show')) {
                chiudiModalPromuovi();
            } else if (document.getElementById('modal-nuovo-contatto').classList.contains('show')) {
                chiudiModalNuovo();
            }
        }
    });

    // Promuovi lead: event listener
    document.getElementById('modal-promuovi-close').addEventListener('click', chiudiModalPromuovi);
    document.getElementById('btn-annulla-promuovi').addEventListener('click', chiudiModalPromuovi);
    document.getElementById('btn-conferma-promuovi').addEventListener('click', confermaPromuovi);
    document.getElementById('modal-promuovi').addEventListener('click', (e) => {
        if (e.target.id === 'modal-promuovi') chiudiModalPromuovi();
    });

    // Retrocedi modal
    document.getElementById('modal-retrocedi-close').addEventListener('click', chiudiModalRetrocedi);
    document.getElementById('btn-annulla-retrocedi').addEventListener('click', chiudiModalRetrocedi);
    document.getElementById('btn-conferma-retrocedi').addEventListener('click', confermaRetrocedi);
    document.getElementById('modal-retrocedi').addEventListener('click', (e) => {
        if (e.target.id === 'modal-retrocedi') chiudiModalRetrocedi();
    });

    // Score manuale modal
    document.getElementById('modal-score-close').addEventListener('click', chiudiModalScore);
    document.getElementById('btn-annulla-score').addEventListener('click', chiudiModalScore);
    document.getElementById('btn-conferma-score').addEventListener('click', confermaScore);
    document.getElementById('modal-score').addEventListener('click', (e) => {
        if (e.target.id === 'modal-score') chiudiModalScore();
    });
});

function renderTableHeader() {
    const thead = document.getElementById('crm-thead');
    let html = '<tr><th>#</th><th>Cognome</th><th>Nome</th><th>Email</th><th>Telefono</th><th>Cellulare</th><th>Citta</th>';
    for (const p of PRODOTTI) {
        html += `<th class="prod">${p}</th>`;
    }
    html += '<th class="prod" title="Note">&#9998;</th><th>Azioni</th></tr>';
    thead.innerHTML = html;

    // Header tabella lead
    const leadThead = document.getElementById('crm-lead-thead');
    if (leadThead) {
        leadThead.innerHTML = '<tr><th>#</th><th>Cognome</th><th>Nome</th><th>Email</th><th>Telefono</th><th>Cellulare</th><th>Citta</th><th class="prod" title="Note">&#9998;</th><th>Azioni</th></tr>';
    }
}

async function caricaDati() {
    try {
        const [contattiRes, statsRes, noteRes] = await Promise.all([
            fetch(`${API_URL}/crm/contatti?regione=PIEMONTE&key=${ADMIN_KEY}`),
            fetch(`${API_URL}/crm/stats?regione=PIEMONTE&key=${ADMIN_KEY}`),
            fetch(`${API_URL}/crm/note/bulk?regione=PIEMONTE&key=${ADMIN_KEY}`)
        ]);

        if (!contattiRes.ok || !statsRes.ok) throw new Error('Errore caricamento');

        allContatti = await contattiRes.json();
        const stats = await statsRes.json();

        // Note + Opportunita count
        if (noteRes.ok) {
            const bulkData = await noteRes.json();
            noteCountMap = bulkData.note || {};
            oppCountMap = bulkData.opportunita || {};
            oppScaduteMap = bulkData.opportunita_scadute || {};
        }

        // Stats
        document.getElementById('stat-contatti').textContent = stats.tot_contatti;
        document.getElementById('stat-odoo').textContent = stats.nuovi_odoo;
        document.getElementById('stat-score').textContent = stats.con_score;
        if (document.getElementById('stat-lead')) {
            document.getElementById('stat-lead').textContent = stats.tot_lead || 0;
        }

        // Salva mappa acquisti (contiene contatto_prodotto -> count) e ultima data
        if (allContatti.length > 0 && allContatti[0].acquisti_count) {
            acquistiCountMap = allContatti[0].acquisti_count;
        }
        if (allContatti.length > 0 && allContatti[0].acquisti_last_date) {
            acquistiLastDateMap = allContatti[0].acquisti_last_date;
        }

        // Score hot per contatto (linee prodotto con score >= 40)
        if (allContatti.length > 0 && allContatti[0].score_hot) {
            // score_hot e' incluso in ogni contatto
            for (const c of allContatti) {
                if (c.score_hot && Object.keys(c.score_hot).length > 0) {
                    scoreHotMap[c.id] = c.score_hot;
                }
            }
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

        // Separa account e lead
        accountContatti = allContatti.filter(c => c.tipo === 'account' || !c.tipo);
        leadContatti = allContatti.filter(c => c.tipo === 'lead');

        // Aggiorna conteggio lead nella sezione
        const leadCountEl = document.getElementById('crm-lead-count');
        if (leadCountEl) leadCountEl.textContent = `(${leadContatti.length})`;

        sortContatti();
        renderTableBody();
        renderLeadTable();
    } catch (err) {
        console.error('Errore:', err);
        document.getElementById('crm-tbody').innerHTML =
            '<tr><td colspan="25"><div class="empty-state"><p>Errore di connessione. Riprova.</p></div></td></tr>';
    }
}

function sortContatti() {
    const sortFn = (a, b) => {
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
    };
    accountContatti.sort(sortFn);
    const leadSortFn = (a, b) => {
        switch (currentLeadSort) {
            case 'citta':
                return (a.citta || '').localeCompare(b.citta || '', 'it', {sensitivity: 'base'});
            default:
                return (a._displayCognome || '').localeCompare(b._displayCognome || '', 'it', {sensitivity: 'base'})
                    || (a._displayNome || '').localeCompare(b._displayNome || '', 'it', {sensitivity: 'base'});
        }
    };
    leadContatti.sort(leadSortFn);
}

function renderTableBody() {
    const tbody = document.getElementById('crm-tbody');
    let filtered = accountContatti;
    if (filterWhatsApp) {
        filtered = filtered.filter(c => c.gruppo_whatsapp);
    }
    if (searchTerm) {
        filtered = filtered.filter(c => {
            const s = searchTerm;
            return (c._displayCognome || '').toLowerCase().includes(s)
                || (c._displayNome || '').toLowerCase().includes(s)
                || (c.citta || '').toLowerCase().includes(s)
                || (c.email || '').toLowerCase().includes(s)
                || (c.nome_azienda || '').toLowerCase().includes(s);
        });
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="26"><div class="empty-state"><p>Nessun contatto trovato</p></div></td></tr>';
        return;
    }

    let html = '';
    filtered.forEach((c, idx) => {
        const rowNum = idx + 1;
        const isNuovo = c.fonte_sync ? ' crm-row-nuovo' : '';

        html += `<tr class="crm-row${isNuovo}" data-id="${c.id}">`;
        html += `<td>${rowNum}</td>`;
        const waIcon = c.gruppo_whatsapp ? '<span class="crm-wa-icon" title="Gruppo WhatsApp"><svg viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></span>' : '';
        html += `<td>${esc(c._displayCognome)}${waIcon}</td>`;
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
                // Controlla se c'è un hot score per questa linea prodotto
                const hotScore = scoreHotMap[c.id] && scoreHotMap[c.id][p];
                if (hotScore) {
                    html += `<td class="crm-cell-empty crm-hot-opportunity" onclick="aggiungiProdotto(${c.id}, '${p}', this)" title="&#128293; Hot Opportunity! Score ${hotScore} - Aggiungi ${p}">&#128293;</td>`;
                } else {
                    // Cella vuota cliccabile per aggiungere prodotto
                    html += `<td class="crm-cell-empty" onclick="aggiungiProdotto(${c.id}, '${p}', this)" title="Aggiungi ${p}"></td>`;
                }
            }
        }

        // Note + Opportunita icon
        const numNote = noteCountMap[c.id] || 0;
        const numOpp = oppCountMap[c.id] || 0;
        const numOppScadute = oppScaduteMap[c.id] || 0;

        let noteClass = 'crm-note-icon';
        let noteTitle = 'Aggiungi nota o opportunita';

        if (numOppScadute > 0) {
            noteClass = 'crm-note-icon crm-note-opp-scaduta';
            noteTitle = `${numOppScadute} opportunita scaduta/e! Clicca per vedere`;
        } else if (numNote > 0 || numOpp > 0) {
            noteClass = 'crm-note-icon crm-note-has';
            const parts = [];
            if (numNote > 0) parts.push(`${numNote} nota/e`);
            if (numOpp > 0) parts.push(`${numOpp} opportunita`);
            noteTitle = parts.join(', ') + ' - clicca per vedere';
        }

        html += `<td class="${noteClass}" onclick="apriNote(${c.id}, '${esc(c._displayCognome)}', '${esc(c._displayNome)}')" title="${noteTitle}">&#9998;</td>`;

        // Bottoni Azioni: Score manuale + Retrocedi
        html += `<td><button class="crm-btn-score" onclick="apriScore(${c.id})" title="Assegna score manuale">&#9733;</button><button class="crm-btn-retrocedi" onclick="apriRetrocedi(${c.id})" title="Retrocedi a Lead">&#x2B07;R</button></td>`;

        html += '</tr>';
    });

    tbody.innerHTML = html;

    // Aggiorna header alert riordini
    aggiornaHeaderAlert();
}

// ==================== TABELLA LEAD ====================

function renderLeadTable() {
    const tbody = document.getElementById('crm-lead-tbody');
    if (!tbody) return;

    let filtered = leadContatti;
    if (filterWhatsApp) {
        filtered = filtered.filter(c => c.gruppo_whatsapp);
    }
    if (searchTerm) {
        filtered = filtered.filter(c => {
            const s = searchTerm;
            return (c._displayCognome || '').toLowerCase().includes(s)
                || (c._displayNome || '').toLowerCase().includes(s)
                || (c.citta || '').toLowerCase().includes(s)
                || (c.email || '').toLowerCase().includes(s)
                || (c.nome_azienda || '').toLowerCase().includes(s);
        });
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><p>Nessuna lead trovata</p></div></td></tr>';
        return;
    }

    let html = '';
    filtered.forEach((c, idx) => {
        html += `<tr class="crm-row crm-lead-row" data-id="${c.id}">`;
        html += `<td>${idx + 1}</td>`;
        const waIconLead = c.gruppo_whatsapp ? '<span class="crm-wa-icon" title="Gruppo WhatsApp"><svg viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></span>' : '';
        html += `<td>${esc(c._displayCognome)}${waIconLead}</td>`;
        html += `<td>${esc(c._displayNome)}</td>`;
        html += `<td class="crm-editable" onclick="inlineEdit(${c.id}, 'email', this)" title="Clicca per modificare">${esc(c.email || '')}</td>`;
        html += `<td class="crm-editable" onclick="inlineEdit(${c.id}, 'telefono', this)" title="Clicca per modificare">${esc(c.telefono || '')}</td>`;
        html += `<td class="crm-editable" onclick="inlineEdit(${c.id}, 'cellulare', this)" title="Clicca per modificare">${esc(c.cellulare || '')}</td>`;
        html += `<td class="crm-editable${c.citta ? '' : ' crm-empty'}" onclick="inlineEdit(${c.id}, 'citta', this)" title="Clicca per modificare">${c.citta ? esc(c.citta) : '&mdash;'}</td>`;

        // Note + Opportunita icon
        const numNote = noteCountMap[c.id] || 0;
        const numOpp = oppCountMap[c.id] || 0;
        const numOppScadute = oppScaduteMap[c.id] || 0;

        let noteClass = 'crm-note-icon';
        let noteTitle = 'Aggiungi nota o opportunita';

        if (numOppScadute > 0) {
            noteClass = 'crm-note-icon crm-note-opp-scaduta';
            noteTitle = `${numOppScadute} opportunita scaduta/e! Clicca per vedere`;
        } else if (numNote > 0 || numOpp > 0) {
            noteClass = 'crm-note-icon crm-note-has';
            const parts = [];
            if (numNote > 0) parts.push(`${numNote} nota/e`);
            if (numOpp > 0) parts.push(`${numOpp} opportunita`);
            noteTitle = parts.join(', ') + ' - clicca per vedere';
        }

        html += `<td class="${noteClass}" onclick="apriNote(${c.id}, '${esc(c._displayCognome)}', '${esc(c._displayNome)}')" title="${noteTitle}">&#9998;</td>`;

        html += `<td><button class="crm-btn-score" onclick="apriScore(${c.id})" title="Assegna score manuale">&#9733;</button><button class="crm-btn-promuovi" onclick="apriPromuovi(${c.id})" title="Promuovi a Account">&#x2B06; Promuovi</button></td>`;
        html += '</tr>';
    });

    tbody.innerHTML = html;
}

// ==================== PROMOZIONE LEAD -> ACCOUNT ====================

function apriPromuovi(contattoId) {
    const contatto = leadContatti.find(c => c.id === contattoId);
    if (!contatto) return;

    promuoviContattoId = contattoId;

    // Info contatto
    const info = document.getElementById('promuovi-info');
    info.textContent = `${contatto._displayCognome} ${contatto._displayNome} - ${contatto.citta || ''}`.trim();

    // Griglia checkbox prodotti
    const grid = document.getElementById('promuovi-prodotti-grid');
    grid.innerHTML = PRODOTTI.map(p =>
        `<label class="crm-prodotto-check">
            <input type="checkbox" value="${p}" ${p === 'MM' ? 'id="promuovi-mm"' : ''}>
            <span>${p}</span>
        </label>`
    ).join('');

    // Mostra modal
    document.getElementById('modal-promuovi').classList.add('show');
}

function chiudiModalPromuovi() {
    document.getElementById('modal-promuovi').classList.remove('show');
    promuoviContattoId = null;
}

async function confermaPromuovi() {
    if (!promuoviContattoId) return;

    const grid = document.getElementById('promuovi-prodotti-grid');
    const checked = [...grid.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);

    if (checked.length === 0) {
        mostraToast('Seleziona almeno un prodotto', 'error');
        return;
    }

    const btn = document.getElementById('btn-conferma-promuovi');
    btn.disabled = true;
    btn.textContent = 'Promozione in corso...';

    try {
        const res = await fetch(`${API_URL}/crm/contatti/${promuoviContattoId}/promuovi?key=${ADMIN_KEY}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prodotti: checked })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Errore promozione');
        }

        const data = await res.json();
        mostraToast(data.messaggio || 'Lead promossa ad account!', 'success');
        chiudiModalPromuovi();

        // Ricarica dati (la lead sparisce dalla tabella lead e appare in account)
        await caricaDati();
    } catch (err) {
        console.error('Errore promozione:', err);
        mostraToast(err.message || 'Errore durante la promozione', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Promuovi a Account';
    }
}

// ==================== RETROCESSIONE ACCOUNT -> LEAD ====================

function apriRetrocedi(contattoId) {
    const contatto = accountContatti.find(c => c.id === contattoId);
    if (!contatto) return;
    retrocediContattoId = contattoId;
    const info = document.getElementById('retrocedi-info');
    info.textContent = `${contatto._displayCognome} ${contatto._displayNome} - ${contatto.citta || ''}`.trim();
    document.getElementById('modal-retrocedi').classList.add('show');
}

function chiudiModalRetrocedi() {
    document.getElementById('modal-retrocedi').classList.remove('show');
    retrocediContattoId = null;
}

async function confermaRetrocedi() {
    if (!retrocediContattoId) return;
    const btn = document.getElementById('btn-conferma-retrocedi');
    btn.disabled = true;
    btn.textContent = 'Retrocessione in corso...';
    try {
        const res = await fetch(`${API_URL}/crm/contatti/${retrocediContattoId}/retrocedi?key=${ADMIN_KEY}`, {
            method: 'PUT'
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Errore retrocessione');
        }
        const data = await res.json();
        mostraToast(data.messaggio || 'Account retrocesso a lead!', 'success');
        chiudiModalRetrocedi();
        await caricaDati();
    } catch (err) {
        console.error('Errore retrocessione:', err);
        mostraToast(err.message || 'Errore durante la retrocessione', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Retrocedi a Lead';
    }
}

// ==================== SCORE MANUALE ====================

function apriScore(contattoId) {
    const contatto = allContatti.find(c => c.id === contattoId);
    if (!contatto) return;

    scoreContattoId = contattoId;
    scoreContattoTipo = contatto.tipo || 'account';

    // Info contatto
    const displayName = ((contatto._displayCognome || '') + ' ' + (contatto._displayNome || '')).trim();
    document.getElementById('score-info').textContent = displayName + (contatto.citta ? ' - ' + contatto.citta : '');

    // Popola dropdown linea prodotto
    const select = document.getElementById('score-linea-prodotto');
    let opts = '<option value="">-- Seleziona prodotto --</option>';
    for (const p of PRODOTTI) {
        opts += `<option value="${p}">${p}</option>`;
    }
    if (scoreContattoTipo === 'lead') {
        opts += '<option value="GENERICO">GENERICO (non legato a prodotto)</option>';
    }
    select.innerHTML = opts;

    // Reset form
    document.getElementById('score-tipo-attivita').value = '';

    document.getElementById('modal-score').classList.add('show');
}

function chiudiModalScore() {
    document.getElementById('modal-score').classList.remove('show');
    scoreContattoId = null;
    scoreContattoTipo = null;
}

async function confermaScore() {
    if (!scoreContattoId) return;

    const tipoAttivita = document.getElementById('score-tipo-attivita').value;
    const lineaProdotto = document.getElementById('score-linea-prodotto').value;

    if (!tipoAttivita) {
        mostraToast('Seleziona un tipo di attivita', 'error');
        return;
    }
    if (!lineaProdotto) {
        mostraToast('Seleziona una linea prodotto', 'error');
        return;
    }

    const btn = document.getElementById('btn-conferma-score');
    btn.disabled = true;
    btn.textContent = 'Assegnazione...';

    try {
        const res = await fetch(`${API_URL}/crm/contatti/${scoreContattoId}/score?key=${ADMIN_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo_attivita: tipoAttivita, linea_prodotto: lineaProdotto })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Errore assegnazione score');
        }

        const data = await res.json();
        mostraToast(data.messaggio, 'success');
        chiudiModalScore();
        await caricaDati();
    } catch (err) {
        console.error('Errore score:', err);
        mostraToast(err.message || 'Errore durante assegnazione score', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Assegna Score';
    }
}

// ==================== INLINE EDIT CAMPI CONTATTO ====================

function inlineEdit(contattoId, campo, tdEl) {
    // Evita doppio click se già in editing
    if (tdEl.querySelector('input')) return;

    const contatto = allContatti.find(c => c.id === contattoId);
    if (!contatto) return;

    const valoreAttuale = contatto[campo] || '';

    // Campo citta: mini-form con input citta + dropdown regione
    if (campo === 'citta') {
        const regioneAttuale = contatto.regione || 'PIEMONTE';
        tdEl.classList.add('crm-editing');
        let optsHtml = REGIONI_ITALIA.map(r =>
            `<option value="${r}"${r === regioneAttuale ? ' selected' : ''}>${r}</option>`
        ).join('');
        tdEl.innerHTML = `<div class="crm-citta-regione-form">
            <input type="text" class="crm-inline-input" value="${esc(valoreAttuale)}" placeholder="Città" />
            <select class="crm-inline-select">${optsHtml}</select>
        </div>`;

        const input = tdEl.querySelector('input');
        const select = tdEl.querySelector('select');
        input.focus();
        input.select();

        // Gestione tastiera su entrambi gli elementi
        const onKeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); salvaCittaRegione(contattoId, input.value, select.value, tdEl, valoreAttuale, regioneAttuale); }
            if (e.key === 'Escape') { ripristinaCell(tdEl, campo, valoreAttuale); }
        };
        input.addEventListener('keydown', onKeydown);
        select.addEventListener('keydown', onKeydown);

        // Blur: salva solo se il focus esce DAL FORM (non spostamento input<->select)
        let blurTimeout = null;
        const onBlur = () => {
            blurTimeout = setTimeout(() => {
                if (tdEl.querySelector('input') && !tdEl.contains(document.activeElement)) {
                    salvaCittaRegione(contattoId, input.value, select.value, tdEl, valoreAttuale, regioneAttuale);
                }
            }, 150);
        };
        const onFocus = () => { if (blurTimeout) clearTimeout(blurTimeout); };
        input.addEventListener('blur', onBlur);
        select.addEventListener('blur', onBlur);
        input.addEventListener('focus', onFocus);
        select.addEventListener('focus', onFocus);
        return;
    }

    // Tutti gli altri campi: input semplice (come prima)
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

async function salvaCittaRegione(contattoId, nuovaCitta, nuovaRegione, tdEl, vecchiaCitta, vecchiaRegione) {
    nuovaCitta = (nuovaCitta || '').trim().toUpperCase();  // R3
    nuovaRegione = (nuovaRegione || '').trim().toUpperCase();

    const cittaCambiata = nuovaCitta !== (vecchiaCitta || '');
    const regioneCambiata = nuovaRegione !== vecchiaRegione;

    // Se nulla è cambiato, ripristina
    if (!cittaCambiata && !regioneCambiata) {
        ripristinaCell(tdEl, 'citta', vecchiaCitta);
        return;
    }

    try {
        // 1. Salva citta (se cambiata)
        if (cittaCambiata) {
            const res = await fetch(`${API_URL}/crm/contatti/${contattoId}?key=${ADMIN_KEY}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ campo: 'citta', valore: nuovaCitta })
            });
            const data = await res.json();
            if (!res.ok) { mostraToast(data.error || 'Errore salvataggio città', 'error'); ripristinaCell(tdEl, 'citta', vecchiaCitta); return; }
            const contatto = allContatti.find(c => c.id === contattoId);
            if (contatto) contatto.citta = data.valore || '';
        }

        // 2. Salva regione (se cambiata)
        if (regioneCambiata) {
            const res = await fetch(`${API_URL}/crm/contatti/${contattoId}?key=${ADMIN_KEY}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ campo: 'regione', valore: nuovaRegione })
            });
            const data = await res.json();
            if (!res.ok) { mostraToast(data.error || 'Errore salvataggio regione', 'error'); ripristinaCell(tdEl, 'citta', vecchiaCitta); return; }

            // Contatto si è spostato in un'altra regione: rimuovilo dagli array locali
            allContatti = allContatti.filter(c => c.id !== contattoId);
            accountContatti = accountContatti.filter(c => c.id !== contattoId);
            leadContatti = leadContatti.filter(c => c.id !== contattoId);

            // Aggiorna stat card
            document.getElementById('stat-contatti').textContent = accountContatti.length;
            if (document.getElementById('stat-lead')) {
                document.getElementById('stat-lead').textContent = leadContatti.length;
            }

            // Re-render tabelle
            renderTableBody();
            renderLeadTable();
            mostraToast(`Contatto spostato in ${nuovaRegione}`, 'success');
            return;
        }

        // Solo citta cambiata (regione uguale)
        ripristinaCell(tdEl, 'citta', nuovaCitta);
        mostraToast('Città aggiornata', 'success');
    } catch (err) {
        mostraToast('Errore di connessione', 'error');
        ripristinaCell(tdEl, 'citta', vecchiaCitta);
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

        // Se 0 prodotti rimanenti, proponi retrocessione a lead
        if (data.prodotti_rimanenti === 0) {
            apriRetrocedi(contattoId);
        }
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
    const totalCols = 7 + PRODOTTI.length + 1; // # + 6 campi + prodotti + note

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
    const noteLista = document.getElementById('notes-lista');
    const oppLista = document.getElementById('opp-lista');
    const notesTextarea = document.getElementById('notes-textarea');
    const oppTextarea = document.getElementById('opp-textarea');
    const oppDate = document.getElementById('opp-data-scadenza');

    title.textContent = `${cognome}${nome ? ' ' + nome : ''}`;
    notesTextarea.value = '';
    oppTextarea.value = '';
    oppDate.value = '';
    noteLista.innerHTML = '<p class="crm-notes-empty">Caricamento...</p>';
    oppLista.innerHTML = '<p class="crm-notes-empty">Caricamento...</p>';

    panel.classList.add('open');

    // Carica note e opportunita in parallelo
    try {
        const [noteRes, oppRes] = await Promise.all([
            fetch(`${API_URL}/crm/contatti/${contattoId}/note?key=${ADMIN_KEY}`),
            fetch(`${API_URL}/crm/contatti/${contattoId}/opportunita?key=${ADMIN_KEY}`)
        ]);

        if (noteRes.ok) {
            const note = await noteRes.json();
            noteLista.innerHTML = note.length > 0 ? renderNoteList(note) : '<p class="crm-notes-empty">Nessuna nota ancora.</p>';
        }

        if (oppRes.ok) {
            const opps = await oppRes.json();
            oppLista.innerHTML = opps.length > 0 ? renderOppList(opps) : '<p class="crm-notes-empty">Nessuna opportunita ancora.</p>';
        }
    } catch (err) {
        noteLista.innerHTML = '<p style="color:#e74c3c;font-size:12px;">Errore caricamento.</p>';
        oppLista.innerHTML = '<p style="color:#e74c3c;font-size:12px;">Errore caricamento.</p>';
    }

    // Segna come viste le opportunita scadute (ferma il lampeggio)
    if (oppScaduteMap[contattoId] && oppScaduteMap[contattoId] > 0) {
        try {
            await fetch(`${API_URL}/crm/contatti/${contattoId}/opportunita/vista-bulk?key=${ADMIN_KEY}`, {
                method: 'PUT'
            });
            delete oppScaduteMap[contattoId];
            renderTableBody();
        } catch (e) { /* ignora */ }
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

function renderOppList(opps) {
    let html = '';
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);
    for (const o of opps) {
        const dataFmt = o.created_at ? new Date(o.created_at).toLocaleString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : '';
        const scadenza = o.data_scadenza ? new Date(o.data_scadenza + 'T00:00:00') : null;
        const scadenzaFmt = scadenza ? scadenza.toLocaleDateString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        }) : '';
        const isScaduta = scadenza && scadenza <= oggi;
        const scadClass = isScaduta ? 'crm-opp-scaduta' : 'crm-opp-futura';

        html += `<div class="crm-opp-entry ${scadClass}" id="opp-${o.id}">
            <div class="crm-nota-header">
                <span class="crm-nota-data">${dataFmt}</span>
                <span class="crm-nota-actions">
                    <span class="crm-nota-btn" title="Modifica" onclick="modificaOpp(${o.id})">&#9998;</span>
                    <span class="crm-nota-btn crm-nota-btn-del" title="Elimina" onclick="eliminaOpp(${o.id})">&times;</span>
                </span>
            </div>
            <div class="crm-opp-scadenza ${scadClass}">
                <span class="crm-opp-scadenza-label">${isScaduta ? '&#9888; Scaduta' : '&#128197; Follow-up'}:</span>
                <span class="crm-opp-scadenza-date">${scadenzaFmt}</span>
            </div>
            <p class="crm-nota-testo" id="opp-testo-${o.id}">${esc(o.testo)}</p>
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

// ==================== OPPORTUNITA DI VENDITA ====================

async function salvaOpportunita() {
    if (!currentNoteContattoId) return;
    const textarea = document.getElementById('opp-textarea');
    const dateInput = document.getElementById('opp-data-scadenza');
    const testo = textarea.value.trim();
    const data_scadenza = dateInput.value;

    if (!testo) {
        mostraToast('Scrivi qualcosa prima di salvare', 'error');
        return;
    }
    if (!data_scadenza) {
        mostraToast('Seleziona una data di follow-up', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/crm/contatti/${currentNoteContattoId}/opportunita?key=${ADMIN_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testo, data_scadenza })
        });
        const data = await res.json();
        if (!res.ok) {
            mostraToast(data.error || 'Errore', 'error');
            return;
        }

        // Aggiorna conteggio locale
        oppCountMap[currentNoteContattoId] = (oppCountMap[currentNoteContattoId] || 0) + 1;
        renderTableBody();

        // Ricarica lista opportunita
        const oppLista = document.getElementById('opp-lista');
        try {
            const res2 = await fetch(`${API_URL}/crm/contatti/${currentNoteContattoId}/opportunita?key=${ADMIN_KEY}`);
            const oppAggiornate = await res2.json();
            oppLista.innerHTML = oppAggiornate.length > 0 ? renderOppList(oppAggiornate) : '<p class="crm-notes-empty">Nessuna opportunita ancora.</p>';
        } catch (e) { }

        textarea.value = '';
        dateInput.value = '';
        mostraToast('Opportunita salvata', 'success');
    } catch (err) {
        mostraToast('Errore di connessione', 'error');
    }
}

async function eliminaOpp(oppId) {
    if (!confirm('Eliminare questa opportunita?')) return;
    try {
        const res = await fetch(`${API_URL}/crm/opportunita/${oppId}?key=${ADMIN_KEY}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
            mostraToast(data.error || 'Errore', 'error');
            return;
        }
        const entry = document.getElementById(`opp-${oppId}`);
        if (entry) entry.remove();
        if (currentNoteContattoId && oppCountMap[currentNoteContattoId]) {
            oppCountMap[currentNoteContattoId]--;
            renderTableBody();
        }
        const lista = document.getElementById('opp-lista');
        if (!lista.querySelector('.crm-opp-entry')) {
            lista.innerHTML = '<p class="crm-notes-empty">Nessuna opportunita ancora.</p>';
        }
        mostraToast('Opportunita eliminata', 'success');
    } catch (err) {
        mostraToast('Errore di connessione', 'error');
    }
}

function modificaOpp(oppId) {
    const testoEl = document.getElementById(`opp-testo-${oppId}`);
    if (!testoEl) return;
    const testoAttuale = testoEl.textContent;
    const entry = document.getElementById(`opp-${oppId}`);
    testoEl.style.display = 'none';
    const editDiv = document.createElement('div');
    editDiv.className = 'crm-nota-edit';
    editDiv.innerHTML = `
        <textarea class="crm-nota-edit-textarea" id="opp-edit-${oppId}" rows="3">${esc(testoAttuale)}</textarea>
        <div class="crm-nota-edit-actions">
            <button class="crm-btn-si crm-btn-opp" onclick="salvaModificaOpp(${oppId})">Salva</button>
            <button class="crm-btn-no" onclick="annullaModificaOpp(${oppId})">Annulla</button>
        </div>`;
    entry.appendChild(editDiv);
    document.getElementById(`opp-edit-${oppId}`).focus();
}

function annullaModificaOpp(oppId) {
    const entry = document.getElementById(`opp-${oppId}`);
    const editDiv = entry.querySelector('.crm-nota-edit');
    if (editDiv) editDiv.remove();
    const testoEl = document.getElementById(`opp-testo-${oppId}`);
    if (testoEl) testoEl.style.display = '';
}

async function salvaModificaOpp(oppId) {
    const textarea = document.getElementById(`opp-edit-${oppId}`);
    if (!textarea) return;
    const nuovoTesto = textarea.value.trim();
    if (!nuovoTesto) {
        mostraToast('Il testo non puo essere vuoto', 'error');
        return;
    }
    try {
        const res = await fetch(`${API_URL}/crm/opportunita/${oppId}?key=${ADMIN_KEY}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testo: nuovoTesto })
        });
        const data = await res.json();
        if (!res.ok) {
            mostraToast(data.error || 'Errore', 'error');
            return;
        }
        const testoEl = document.getElementById(`opp-testo-${oppId}`);
        testoEl.textContent = nuovoTesto;
        annullaModificaOpp(oppId);
        mostraToast('Opportunita modificata', 'success');
    } catch (err) {
        mostraToast('Errore di connessione', 'error');
    }
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

function toggleDettatura(target) {
    // target: undefined/'note' = textarea note, 'opp' = textarea opportunita
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        mostraToast('Browser non supportato. Usa Chrome o Edge.', 'error');
        return;
    }

    if (recognition) {
        stopDettatura();
        return;
    }

    const isOpp = target === 'opp';
    currentDettTarget = isOpp ? 'opp' : 'note';

    recognition = new SpeechRecognition();
    recognition.lang = 'it-IT';
    recognition.continuous = true;
    recognition.interimResults = true;

    const micBtn = document.getElementById(isOpp ? 'btn-mic-opp' : 'btn-mic');
    const micStatus = document.getElementById(isOpp ? 'mic-status-opp' : 'mic-status');
    const textarea = document.getElementById(isOpp ? 'opp-textarea' : 'notes-textarea');

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
    // Resetta entrambi i microfoni
    const micBtn = document.getElementById('btn-mic');
    const micStatus = document.getElementById('mic-status');
    const micBtnOpp = document.getElementById('btn-mic-opp');
    const micStatusOpp = document.getElementById('mic-status-opp');
    if (micBtn) micBtn.classList.remove('recording');
    if (micStatus) micStatus.textContent = '';
    if (micBtnOpp) micBtnOpp.classList.remove('recording');
    if (micStatusOpp) micStatusOpp.textContent = '';
    currentDettTarget = null;
}

// ==================== NUOVO CONTATTO ====================

function apriModalNuovoContatto() {
    const modal = document.getElementById('modal-nuovo-contatto');

    // Reset form
    document.getElementById('nuovo-cognome').value = '';
    document.getElementById('nuovo-nome').value = '';
    document.getElementById('nuovo-email').value = '';
    document.getElementById('nuovo-telefono').value = '';
    document.getElementById('nuovo-cellulare').value = '';
    document.getElementById('nuovo-citta').value = '';
    document.getElementById('nuovo-email-error').textContent = '';
    document.getElementById('nuovo-phone-error').textContent = '';

    // Reset tipo a Lead
    document.querySelector('input[name="nuovo-tipo"][value="lead"]').checked = true;
    document.getElementById('nuovo-prodotti-section').style.display = 'none';

    // Costruisci checkbox prodotti
    const grid = document.getElementById('nuovo-prodotti-grid');
    grid.innerHTML = PRODOTTI.map(p =>
        `<label class="crm-prodotto-check"><input type="checkbox" value="${p}"> ${p}</label>`
    ).join('');

    modal.classList.add('show');
    document.getElementById('nuovo-cognome').focus();
}

function chiudiModalNuovo() {
    document.getElementById('modal-nuovo-contatto').classList.remove('show');
}

async function salvaNuovoContatto() {
    const cognome = document.getElementById('nuovo-cognome').value.trim();
    const nome = document.getElementById('nuovo-nome').value.trim();
    const email = document.getElementById('nuovo-email').value.trim();
    const telefono = document.getElementById('nuovo-telefono').value.trim();
    const cellulare = document.getElementById('nuovo-cellulare').value.trim();
    const citta = document.getElementById('nuovo-citta').value.trim();
    const tipo = document.querySelector('input[name="nuovo-tipo"]:checked').value;

    // Prodotti selezionati (solo per account)
    const prodotti = [];
    if (tipo === 'account') {
        document.querySelectorAll('#nuovo-prodotti-grid input:checked').forEach(cb => {
            prodotti.push(cb.value);
        });
    }

    // Validazione client-side
    const emailError = document.getElementById('nuovo-email-error');
    const phoneError = document.getElementById('nuovo-phone-error');
    emailError.textContent = '';
    phoneError.textContent = '';

    if (!cognome && !nome) {
        mostraToast('Inserire almeno Cognome o Nome', 'error');
        document.getElementById('nuovo-cognome').focus();
        return;
    }
    if (!email) {
        emailError.textContent = 'Email obbligatoria';
        document.getElementById('nuovo-email').focus();
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        emailError.textContent = 'Formato email non valido';
        document.getElementById('nuovo-email').focus();
        return;
    }
    if (!telefono && !cellulare) {
        phoneError.textContent = 'Inserire almeno un numero di telefono o cellulare';
        document.getElementById('nuovo-telefono').focus();
        return;
    }
    if (!citta) {
        mostraToast('Citta obbligatoria', 'error');
        document.getElementById('nuovo-citta').focus();
        return;
    }

    // Disabilita bottone per evitare doppio submit
    const btnSalva = document.getElementById('btn-salva-nuovo');
    btnSalva.disabled = true;
    btnSalva.textContent = 'Salvando...';

    try {
        const res = await fetch(`${API_URL}/crm/contatti?key=${ADMIN_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cognome, nome, email, telefono, cellulare,
                citta, regione: 'PIEMONTE', tipo, prodotti
            })
        });
        const data = await res.json();

        if (!res.ok) {
            if (res.status === 409) {
                emailError.textContent = data.error;
            } else {
                mostraToast(data.error || 'Errore', 'error');
            }
            return;
        }

        chiudiModalNuovo();
        mostraToast(data.messaggio || 'Contatto creato!', 'success');

        // Ricarica dati per mostrare il nuovo contatto
        await caricaDati();

    } catch (err) {
        mostraToast('Errore di connessione', 'error');
    } finally {
        btnSalva.disabled = false;
        btnSalva.textContent = 'Salva Contatto';
    }
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
