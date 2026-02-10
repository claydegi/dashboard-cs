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

        renderHeader(linee_prodotto);
        renderBody(contatti, linee_prodotto);
    } catch (err) {
        console.error('Errore:', err);
        document.getElementById('score-tbody').innerHTML =
            '<tr><td colspan="10"><div class="empty-state"><p>Errore di connessione. Riprova.</p></div></td></tr>';
    }
}

function renderHeader(lineeProdotto) {
    const thead = document.getElementById('score-thead');
    let html = '<tr><th>#</th><th>Cognome</th><th>Nome</th>';
    for (const lp of lineeProdotto) {
        html += `<th class="score-prod-col">${lp}</th>`;
    }
    html += '<th class="score-tot-col">TOTALE</th></tr>';
    thead.innerHTML = html;
}

function renderBody(contatti, lineeProdotto) {
    const tbody = document.getElementById('score-tbody');

    if (contatti.length === 0) {
        const cols = 3 + lineeProdotto.length + 1;
        tbody.innerHTML = `<tr><td colspan="${cols}"><div class="empty-state"><p>Nessun contatto con score</p></div></td></tr>`;
        return;
    }

    // Ordina per score totale decrescente
    contatti.sort((a, b) => b.score_totale - a.score_totale);

    let html = '';
    contatti.forEach((c, idx) => {
        const displayCognome = c.cognome || c.nome_azienda || '';
        const displayNome = c.cognome ? (c.nome || '') : '';

        html += `<tr class="score-row">`;
        html += `<td>${idx + 1}</td>`;
        html += `<td>${esc(displayCognome)}</td>`;
        html += `<td>${esc(displayNome)}</td>`;

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

        // Totale
        const totHot = c.score_totale >= SOGLIA_HOT;
        const totCls = totHot ? 'score-cell score-tot score-hot' : 'score-cell score-tot';
        html += `<td class="${totCls}">${c.score_totale}</td>`;

        html += '</tr>';
    });

    tbody.innerHTML = html;
}

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
