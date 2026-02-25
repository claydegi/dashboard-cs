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
    caricaConsensi();
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

async function caricaConsensi() {
    const container = document.getElementById('consentStats');
    if (!container) return;
    container.innerHTML = '<p class="loading">Caricamento...</p>';

    try {
        const response = await fetch(`${API_URL}/consent-stats?key=${ADMIN_KEY}`);
        if (!response.ok) throw new Error('Errore caricamento');
        const data = await response.json();

        container.innerHTML = renderConsentCard('Account', data.account) + renderConsentCard('Lead', data.lead);
    } catch (err) {
        console.error('Errore consensi:', err);
        container.innerHTML = '<div class="empty-state"><p>Errore caricamento consensi</p></div>';
    }
}

function renderConsentCard(label, s) {
    const pctCompleto = s.totale > 0 ? Math.round(s.consenso_completo / s.totale * 100) : 0;
    const pctEmail = s.totale > 0 ? Math.round(s.solo_email / s.totale * 100) : 0;
    const pctNegato = s.totale > 0 ? Math.round(s.negato / s.totale * 100) : 0;
    const pctAttesa = s.totale > 0 ? Math.round(s.in_attesa / s.totale * 100) : 0;
    const borderColor = label === 'Account' ? 'var(--primary)' : 'var(--warning, #f59e0b)';
    const tipoColor = label === 'Account' ? 'var(--primary)' : 'var(--warning, #f59e0b)';

    return `
        <div class="report-card" style="border-left-color: ${borderColor}; cursor: default;">
            <div class="report-card-tipo" style="color: ${tipoColor}; margin-bottom: 12px;">CONSENSI ${label.toUpperCase()}</div>
            <div style="font-size: 2rem; font-weight: 700; color: var(--gray-900); margin-bottom: 4px;">${s.totale}</div>
            <div style="font-size: 0.8rem; color: var(--gray-500); margin-bottom: 16px;">contatti sollecitati</div>
            <div class="consent-row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f0f0f0;">
                <span style="font-size:0.85rem;color:#2E7D32;font-weight:600;">&#10003; Consenso completo</span>
                <span style="font-size:0.95rem;font-weight:700;color:#2E7D32;">${s.consenso_completo} <span style="font-size:0.75rem;font-weight:400;">(${pctCompleto}%)</span></span>
            </div>
            <div class="consent-row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f0f0f0;">
                <span style="font-size:0.85rem;color:#666;">&#9993; Solo email</span>
                <span style="font-size:0.95rem;font-weight:700;color:#666;">${s.solo_email} <span style="font-size:0.75rem;font-weight:400;">(${pctEmail}%)</span></span>
            </div>
            <div class="consent-row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f0f0f0;">
                <span style="font-size:0.85rem;color:#c00;">&#10007; Negato</span>
                <span style="font-size:0.95rem;font-weight:700;color:#c00;">${s.negato} <span style="font-size:0.75rem;font-weight:400;">(${pctNegato}%)</span></span>
            </div>
            <div class="consent-row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;">
                <span style="font-size:0.85rem;color:#999;">&#8987; In attesa</span>
                <span style="font-size:0.95rem;font-weight:700;color:#999;">${s.in_attesa} <span style="font-size:0.75rem;font-weight:400;">(${pctAttesa}%)</span></span>
            </div>
        </div>
    `;
}
