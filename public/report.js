const API_URL = window.location.origin + '/api';
const ADMIN_KEY = new URLSearchParams(window.location.search).get('key') || '';

document.addEventListener('DOMContentLoaded', () => {
    if (!ADMIN_KEY) {
        document.body.innerHTML = '<div class="container"><h1>Accesso negato</h1><p>Chiave admin mancante.</p></div>';
        return;
    }

    // Propaga chiave ai link
    const backLink = document.querySelector('.nav-back');
    if (backLink) backLink.href = `admin.html?key=${ADMIN_KEY}`;

    document.getElementById('folderOrdini').href = `report-ordini.html?key=${ADMIN_KEY}`;
    document.getElementById('folderTrend').href = `report-trend.html?key=${ADMIN_KEY}`;
    document.getElementById('folderFinanza').href = `report-finanza.html?key=${ADMIN_KEY}`;
    document.getElementById('folderProgressivo').href = `report-progressivo.html?key=${ADMIN_KEY}`;

    caricaReportRecenti();
    caricaMarketing();
});

async function caricaReportRecenti() {
    const container = document.getElementById('latestReports');
    container.innerHTML = '<p class="loading">Caricamento...</p>';

    try {
        const response = await fetch(`${API_URL}/reports/latest?key=${ADMIN_KEY}`);
        if (!response.ok) throw new Error('Errore caricamento');
        const reports = await response.json();

        if (reports.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Nessun report disponibile</p></div>';
            return;
        }

        const ordine = ['vendite_giornaliero', 'trend_mensile', 'finanziario', 'trend_progressivo'];
        reports.sort((a, b) => ordine.indexOf(a.tipo) - ordine.indexOf(b.tipo));

        container.innerHTML = reports.map(r => `
            <div class="report-card report-card-${r.tipo}" onclick="apriReport(${r.id})">
                <div class="report-card-tipo">${labelTipo(r.tipo)}</div>
                <div class="report-card-titolo">${escapeHtml(r.titolo)}</div>
                <div class="report-card-data">${formattaData(r.data_report)}</div>
                <div class="report-card-size">${r.dimensione_kb || '?'} KB</div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Errore:', err);
        container.innerHTML = '<div class="empty-state"><p>Errore di connessione</p></div>';
    }
}

function apriReport(id) {
    window.location.href = `${API_URL}/reports/${id}/html?key=${ADMIN_KEY}`;
}

function labelTipo(tipo) {
    const labels = {
        'vendite_giornaliero': 'Vendite giornaliero',
        'trend_mensile': 'Trend mensile',
        'finanziario': 'Finanziario',
        'trend_progressivo': 'Progressivo YTD'
    };
    return labels[tipo] || tipo;
}

function formattaData(dataStr) {
    const d = new Date(dataStr);
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== SEZIONE MARKETING ====================

async function caricaMarketing() {
    const container = document.getElementById('marketingSection');
    if (!container) return;

    try {
        const [campagneResp, consensiResp] = await Promise.all([
            fetch(`${API_URL}/campagne?key=${ADMIN_KEY}`),
            fetch(`${API_URL}/consent-stats?key=${ADMIN_KEY}`)
        ]);

        let html = '';

        if (campagneResp.ok) {
            const campagne = await campagneResp.json();
            html += campagne.map(c => renderCampagnaCard(c)).join('');
        }

        if (consensiResp.ok) {
            const data = await consensiResp.json();
            html += renderConsentCard('Account', data.account);
            html += renderConsentCard('Lead', data.lead);
        }

        container.innerHTML = html || '<div class="empty-state"><p>Nessuna attivita\' in programma</p></div>';
    } catch (err) {
        console.error('Errore marketing:', err);
        container.innerHTML = '<div class="empty-state"><p>Errore di connessione</p></div>';
    }
}

function renderCampagnaCard(c) {
    const isInviata = c.stato === 'inviata';
    const borderColor = isInviata ? 'var(--gray-300)' : '#8b5cf6';
    const tipoColor = isInviata ? 'var(--gray-400)' : '#8b5cf6';
    const opacity = isInviata ? '0.6' : '1';

    return `
        <div class="report-card" style="border-left-color:${borderColor};opacity:${opacity};cursor:default;">
            <div class="report-card-tipo" style="color:${tipoColor};">
                ${isInviata ? '&#10003; Eseguita' : '&#9993; Da eseguire'}
            </div>
            <div class="report-card-titolo">${escapeHtml(c.nome)}</div>
        </div>
    `;
}

function renderConsentCard(label, s) {
    const borderColor = label === 'Account' ? 'var(--primary)' : 'var(--warning, #f59e0b)';
    const tipoColor = label === 'Account' ? 'var(--primary)' : 'var(--warning, #f59e0b)';

    const riga = (icona, testo, n, colore) =>
        `<span style="font-size:0.8rem;color:${colore};">${icona} ${testo} <strong>${n}</strong></span>`;

    return `
        <div class="report-card" style="border-left-color: ${borderColor}; cursor: default;">
            <div class="report-card-tipo" style="color: ${tipoColor};">Consensi ${label}</div>
            <div class="report-card-titolo">${s.totale} sollecitati</div>
            <div class="report-card-data" style="display:flex;flex-direction:column;gap:3px;">
                ${riga('&#10003;', 'Completo', s.consenso_completo, '#2E7D32')}
                ${riga('&#9993;', 'Solo email', s.solo_email, '#666')}
                ${riga('&#10007;', 'Negato', s.negato, '#c00')}
                ${riga('&#8987;', 'In attesa', s.in_attesa, '#999')}
            </div>
        </div>
    `;
}
