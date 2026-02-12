// CRM Score - Engagement per linea prodotto
const API_URL = window.location.origin + '/api';
const ADMIN_KEY = new URLSearchParams(window.location.search).get('key') || '';

const SOGLIA_HOT = 40;

document.addEventListener('DOMContentLoaded', () => {
    if (!ADMIN_KEY) {
        document.body.innerHTML = '<div class="container"><h1>Accesso negato</h1><p>Link non valido.</p></div>';
        return;
    }

    document.getElementById('btn-back').href = `/crm-liguria?key=${ADMIN_KEY}`;
    caricaScore();
});

async function caricaScore() {
    try {
        const res = await fetch(`${API_URL}/crm/score?regione=LIGURIA&key=${ADMIN_KEY}`);
        if (!res.ok) throw new Error('Errore caricamento');

        const data = await res.json();
        const { contatti, linee_prodotto } = data;

        // Separa account e lead
        const accountContatti = contatti.filter(c => c.tipo === 'account' || !c.tipo);
        const leadContatti = contatti.filter(c => c.tipo === 'lead');

        // Account: senza colonna GENERICO (non applicabile)
        const accountLinee = linee_prodotto.filter(lp => lp !== 'GENERICO');
        renderHeader('score-thead', accountLinee);
        renderBody('score-tbody', accountContatti, accountLinee);

        // Lead: con GENERICO se presente nei dati
        renderHeader('score-lead-thead', linee_prodotto);
        renderBody('score-lead-tbody', leadContatti, linee_prodotto);
    } catch (err) {
        console.error('Errore:', err);
        document.getElementById('score-tbody').innerHTML =
            '<tr><td colspan="10"><div class="empty-state"><p>Errore di connessione. Riprova.</p></div></td></tr>';
    }
}

function renderHeader(theadId, lineeProdotto) {
    const thead = document.getElementById(theadId);
    if (!thead) return;
    let html = '<tr><th>#</th><th>Nome</th>';
    for (const lp of lineeProdotto) {
        html += `<th class="score-prod-col">${lp}</th>`;
    }
    html += '</tr>';
    thead.innerHTML = html;
}

function renderBody(tbodyId, contatti, lineeProdotto) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    if (contatti.length === 0) {
        const cols = 2 + lineeProdotto.length;
        tbody.innerHTML = `<tr><td colspan="${cols}"><div class="empty-state"><p>Nessun contatto con score</p></div></td></tr>`;
        return;
    }

    // Ordina per score max tra le linee prodotto (decrescente)
    contatti.sort((a, b) => {
        const maxA = Math.max(...Object.values(a.score_prodotti));
        const maxB = Math.max(...Object.values(b.score_prodotti));
        return maxB - maxA;
    });

    let html = '';
    contatti.forEach((c, idx) => {
        const displayCognome = c.cognome || c.nome_azienda || '';
        const displayNome = c.cognome ? (c.nome || '') : '';
        const fullName = displayNome ? `${displayCognome} ${displayNome}` : displayCognome;

        html += `<tr class="score-row">`;
        html += `<td>${idx + 1}</td>`;
        html += `<td>${esc(fullName)}</td>`;

        for (const lp of lineeProdotto) {
            const val = c.score_prodotti[lp] || 0;
            if (val > 0) {
                const isHot = val >= SOGLIA_HOT;
                const cls = isHot ? 'score-cell score-hot' : 'score-cell';
                html += `<td class="${cls}">${val}</td>`;
            } else {
                html += '<td class="score-cell score-empty"></td>';
            }
        }

        html += '</tr>';
    });

    tbody.innerHTML = html;
}

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
