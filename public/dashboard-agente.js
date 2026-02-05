// Dashboard Agente - Script condiviso per Kim e Massimo
// La variabile AGENTE viene definita nell'HTML prima di questo script

const API_URL = window.location.origin + '/api';
const ADMIN_KEY = new URLSearchParams(window.location.search).get('key') || '';

document.addEventListener('DOMContentLoaded', () => {
    if (!ADMIN_KEY) {
        document.body.innerHTML = '<div class="container"><h1>Accesso negato</h1><p>Link non valido. Contatta l\'amministratore.</p></div>';
        return;
    }

    caricaReports();
    caricaFatture();
});

async function caricaReports() {
    const container = document.getElementById('reports-container');
    container.innerHTML = '<p class="loading">Caricamento...</p>';

    try {
        const response = await fetch(`${API_URL}/reports-antonia/${AGENTE}/info?key=${ADMIN_KEY}`);
        if (!response.ok) throw new Error('Errore caricamento');
        const info = await response.json();

        const nomeAgente = AGENTE.charAt(0).toUpperCase() + AGENTE.slice(1);

        let html = '';

        // Card Report Crediti
        html += `
            <div class="report-card report-card-crediti_${AGENTE}" onclick="apriReport('crediti')">
                <div class="report-card-tipo">Report Crediti</div>
                <div class="report-card-titolo">Situazione crediti ${nomeAgente}</div>
                <div class="report-card-data">${info.crediti ? 'Aggiornato: ' + info.crediti.aggiornato : 'Non disponibile'}</div>
            </div>
        `;

        // Card Report Vendite Progressivo
        html += `
            <div class="report-card report-card-vendite_${AGENTE}" onclick="apriReport('vendite')">
                <div class="report-card-tipo">Vendite Progressivo</div>
                <div class="report-card-titolo">Analisi vendite YTD ${nomeAgente}</div>
                <div class="report-card-data">${info.vendite ? 'Aggiornato: ' + info.vendite.aggiornato : 'Non disponibile'}</div>
            </div>
        `;

        container.innerHTML = html;
    } catch (err) {
        console.error('Errore:', err);
        container.innerHTML = '<div class="empty-state"><p>Errore di connessione. Riprova.</p></div>';
    }
}

function apriReport(tipo) {
    window.location.href = `${API_URL}/reports-antonia/${AGENTE}/${tipo}?key=${ADMIN_KEY}`;
}

async function caricaFatture() {
    const container = document.getElementById('fatture-container');
    if (!container) return;

    container.innerHTML = '<p class="loading">Caricamento...</p>';

    try {
        const response = await fetch(`${API_URL}/fatture/${AGENTE}?key=${ADMIN_KEY}`);
        if (!response.ok) throw new Error('Errore caricamento');
        const fatture = await response.json();

        if (fatture.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Nessuna fattura disponibile</p></div>';
            return;
        }

        container.innerHTML = fatture.map(f => `
            <div class="fattura-item">
                <div class="fattura-info">
                    <span class="fattura-nome">${f.nome_file}</span>
                    <span class="fattura-data">${new Date(f.data_fattura).toLocaleDateString('it-IT')}</span>
                    <span class="fattura-size">${f.dimensione_kb} KB</span>
                </div>
                <div class="fattura-actions">
                    <button class="btn btn-primary btn-small" onclick="window.open('${API_URL}/fatture/${AGENTE}/download/${f.id}?key=${ADMIN_KEY}', '_blank')">
                        Visualizza PDF
                    </button>
                    <button class="btn btn-danger btn-small" onclick="eliminaFattura(${f.id})">Elimina</button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Errore caricamento fatture:', err);
        container.innerHTML = '<div class="empty-state"><p>Errore di connessione. Riprova.</p></div>';
    }
}

async function eliminaFattura(id) {
    if (!confirm('Sei sicuro di voler eliminare questa fattura?')) return;

    try {
        const response = await fetch(`${API_URL}/fatture/${id}?key=${ADMIN_KEY}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Errore eliminazione');
        caricaFatture();
    } catch (err) {
        console.error('Errore eliminazione fattura:', err);
    }
}
