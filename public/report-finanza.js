const API_URL = window.location.origin + '/api';
const ADMIN_KEY = new URLSearchParams(window.location.search).get('key') || '';
const TIPO = 'finanziario';

document.addEventListener('DOMContentLoaded', () => {
    if (!ADMIN_KEY) {
        document.body.innerHTML = '<div class="container"><h1>Accesso negato</h1><p>Chiave admin mancante.</p></div>';
        return;
    }

    const backLink = document.querySelector('.nav-back');
    if (backLink) backLink.href = `report.html?key=${ADMIN_KEY}`;

    caricaReport();
});

async function caricaReport() {
    const container = document.getElementById('reportContent');
    container.innerHTML = '<p class="loading">Caricamento...</p>';

    try {
        const response = await fetch(`${API_URL}/reports?key=${ADMIN_KEY}&tipo=${TIPO}&limit=500`);
        if (!response.ok) throw new Error('Errore caricamento');
        const data = await response.json();

        if (data.reports.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Nessun report disponibile</p></div>';
            return;
        }

        const perMese = {};
        data.reports.forEach(r => {
            const d = new Date(r.data_report);
            const chiaveMese = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const labelMese = d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
            if (!perMese[chiaveMese]) {
                perMese[chiaveMese] = { label: labelMese.charAt(0).toUpperCase() + labelMese.slice(1), reports: [] };
            }
            perMese[chiaveMese].reports.push(r);
        });

        const mesiOrdinati = Object.keys(perMese).sort().reverse();

        container.innerHTML = mesiOrdinati.map(chiave => {
            const gruppo = perMese[chiave];
            return `
                <div class="report-month-section">
                    <h3 class="report-month-title">${gruppo.label}</h3>
                    <div class="report-month-list">
                        ${gruppo.reports.map(r => `
                            <div class="report-history-item" onclick="apriReport(${r.id})">
                                <span class="report-item-titolo">${escapeHtml(r.titolo)}</span>
                                <span class="report-item-data">${formattaData(r.data_report)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Errore:', err);
        container.innerHTML = '<div class="empty-state"><p>Errore di connessione</p></div>';
    }
}

function apriReport(id) {
    window.location.href = `${API_URL}/reports/${id}/html?key=${ADMIN_KEY}`;
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
