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
