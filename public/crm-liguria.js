// CRM Liguria - Dashboard interattiva
const API_URL = window.location.origin + '/api';
const ADMIN_KEY = new URLSearchParams(window.location.search).get('key') || '';

const PRODOTTI = ['MM','ELEVATE','BLACK RUBY','LC','FIRST','EASY IN','EASY PIN',
                  'CEP','GENOA','EASYROOT','IMPIANTI','SUTURE','BLEXO','GUIDATA','PT1'];
const PRODOTTI_RICORRENTI = ['BLEXO', 'CEP', 'SUTURE'];

let allContatti = [];
let acquistiCache = {};
let currentSort = 'cognome';
let searchTerm = '';

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
});

function renderTableHeader() {
    const thead = document.getElementById('crm-thead');
    let html = '<tr><th>#</th><th>Cognome</th><th>Nome</th><th>Email</th><th>Telefono</th><th>Cellulare</th><th>Citta</th>';
    for (const p of PRODOTTI) {
        html += `<th class="prod">${p}</th>`;
    }
    html += '<th>Score</th></tr>';
    thead.innerHTML = html;
}

async function caricaDati() {
    try {
        const [contattiRes, statsRes] = await Promise.all([
            fetch(`${API_URL}/crm/contatti?regione=LIGURIA&key=${ADMIN_KEY}`),
            fetch(`${API_URL}/crm/stats?regione=LIGURIA&key=${ADMIN_KEY}`)
        ]);

        if (!contattiRes.ok || !statsRes.ok) throw new Error('Errore caricamento');

        allContatti = await contattiRes.json();
        const stats = await statsRes.json();

        // Stats
        document.getElementById('stat-contatti').textContent = stats.tot_contatti;
        document.getElementById('stat-odoo').textContent = stats.nuovi_odoo;
        document.getElementById('stat-score').textContent = stats.con_score;

        // Build product set per contatto for sorting
        allContatti.forEach(c => {
            c._prodSet = new Set((c.prodotti || []).map(p => p.prodotto));
            c._numProd = c._prodSet.size;
            c._displayCognome = c.cognome || c.nome_azienda || '';
            c._displayNome = c.cognome ? (c.nome || '') : '';
        });

        sortContatti();
        renderTableBody();
    } catch (err) {
        console.error('Errore:', err);
        document.getElementById('crm-tbody').innerHTML =
            '<tr><td colspan="24"><div class="empty-state"><p>Errore di connessione. Riprova.</p></div></td></tr>';
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
        tbody.innerHTML = '<tr><td colspan="24"><div class="empty-state"><p>Nessun contatto trovato</p></div></td></tr>';
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
        html += `<td>${esc(c.email || '')}</td>`;
        html += `<td>${esc(c.telefono || '')}</td>`;
        html += `<td>${esc(c.cellulare || '')}</td>`;

        if (c.citta) {
            html += `<td>${esc(c.citta)}</td>`;
        } else {
            html += '<td class="crm-empty">&mdash;</td>';
        }

        // Prodotti
        for (const p of PRODOTTI) {
            if (c._prodSet.has(p)) {
                const prodInfo = (c.prodotti || []).find(pr => pr.prodotto === p);
                const isOdoo = prodInfo && prodInfo.fonte && prodInfo.fonte.startsWith('odoo:');
                const isRicorrente = PRODOTTI_RICORRENTI.includes(p);

                if (isRicorrente) {
                    const cls = isOdoo ? 'crm-x-new crm-x-ricorrente' : 'crm-x crm-x-ricorrente';
                    html += `<td class="${cls}" onclick="toggleAcquisti(${c.id}, '${p}', this)" title="Clicca per storico acquisti">X</td>`;
                } else if (isOdoo) {
                    html += '<td class="crm-x-new">X</td>';
                } else {
                    html += '<td class="crm-x">X</td>';
                }
            } else {
                html += '<td></td>';
            }
        }

        // Score
        if (c.score) {
            html += `<td class="crm-score">${c.score}</td>`;
        } else {
            html += '<td></td>';
        }

        html += '</tr>';
    });

    tbody.innerHTML = html;
}

async function toggleAcquisti(contattoId, prodotto, cellEl) {
    const row = cellEl.closest('tr');
    const existingDetail = row.nextElementSibling;

    // Se il dettaglio è già visibile, chiudilo
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
    const totalCols = 7 + PRODOTTI.length + 1; // # + 6 campi + prodotti + score

    if (filtrati.length === 0) {
        detailRow.innerHTML = `<td colspan="${totalCols}" class="crm-detail-cell">
            <div class="crm-detail-content">
                <strong>Storico ${prodotto}</strong>
                <p>Nessun acquisto registrato nello storico.</p>
            </div>
        </td>`;
    } else {
        let tableHtml = `<td colspan="${totalCols}" class="crm-detail-cell">
            <div class="crm-detail-content">
                <strong>Storico acquisti ${prodotto} (${filtrati.length} ${filtrati.length === 1 ? 'acquisto' : 'acquisti'})</strong>
                <table class="crm-acquisti-table">
                    <thead><tr><th>Fattura</th><th>Data</th><th>Quantita</th><th>Fonte</th></tr></thead>
                    <tbody>`;
        for (const a of filtrati) {
            const dataFmt = a.data_fattura ? formatDate(a.data_fattura) : '-';
            tableHtml += `<tr>
                <td>${esc(a.numero_fattura || '-')}</td>
                <td>${dataFmt}</td>
                <td style="text-align:center">${a.quantita || 1}</td>
                <td>${esc(a.fonte || '-')}</td>
            </tr>`;
        }
        tableHtml += '</tbody></table></div></td>';
        detailRow.innerHTML = tableHtml;
    }

    row.after(detailRow);
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return dateStr;
}

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
