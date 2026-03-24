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
    caricaOpportunita();
    caricaAlertOpportunita();
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

        // Card Crediti da Attenzionare
        html += `
            <div class="report-card report-card-attenzionare" onclick="apriReport('attenzionare')">
                <div class="report-card-tipo">Crediti da Attenzionare</div>
                <div class="report-card-titolo">Posizioni critiche ${nomeAgente}</div>
                <div class="report-card-data">${info.attenzionare ? 'Aggiornato: ' + info.attenzionare.aggiornato : 'Non disponibile'}</div>
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

async function caricaAlertOpportunita() {
    // Alert LIGURIA
    const alertDiv = document.getElementById('crm-opp-alert');
    if (alertDiv) {
        try {
            const res = await fetch(`${API_URL}/crm/opportunita/scadute?regione=LIGURIA&key=${ADMIN_KEY}`);
            if (res.ok) {
                const data = await res.json();
                const totale = data.reduce((sum, r) => sum + parseInt(r.totale), 0);
                if (totale > 0) {
                    const clienti = data.flatMap(r => r.clienti || []).filter(n => n.trim()).join(', ');
                    alertDiv.innerHTML = `<span class="crm-opp-alert-badge">&#9888; Attenzione: ${totale} opportunita di vendita scadute - LIGURIA<br><small style="font-weight:normal;">Clienti: ${clienti}</small></span>`;
                }
            }
        } catch (e) { /* Silenzioso */ }
    }

    // Alert PIEMONTE
    const alertDivPiemonte = document.getElementById('crm-opp-alert-piemonte');
    if (alertDivPiemonte) {
        try {
            const res2 = await fetch(`${API_URL}/crm/opportunita/scadute?regione=PIEMONTE&key=${ADMIN_KEY}`);
            if (res2.ok) {
                const data2 = await res2.json();
                const totale2 = data2.reduce((sum, r) => sum + parseInt(r.totale), 0);
                if (totale2 > 0) {
                    const clienti2 = data2.flatMap(r => r.clienti || []).filter(n => n.trim()).join(', ');
                    alertDivPiemonte.innerHTML = `<span class="crm-opp-alert-badge">&#9888; Attenzione: ${totale2} opportunita di vendita scadute - PIEMONTE<br><small style="font-weight:normal;">Clienti: ${clienti2}</small></span>`;
                }
            }
        } catch (e) { /* Silenzioso */ }
    }

    // Alert LOMBARDIA
    const alertDivLombardia = document.getElementById('crm-opp-alert-lombardia');
    if (alertDivLombardia) {
        try {
            const res3 = await fetch(`${API_URL}/crm/opportunita/scadute?regione=LOMBARDIA&key=${ADMIN_KEY}`);
            if (res3.ok) {
                const data3 = await res3.json();
                const totale3 = data3.reduce((sum, r) => sum + parseInt(r.totale), 0);
                if (totale3 > 0) {
                    const clienti3 = data3.flatMap(r => r.clienti || []).filter(n => n.trim()).join(', ');
                    alertDivLombardia.innerHTML = `<span class="crm-opp-alert-badge">&#9888; Attenzione: ${totale3} opportunita di vendita scadute - LOMBARDIA<br><small style="font-weight:normal;">Clienti: ${clienti3}</small></span>`;
                }
            }
        } catch (e) { /* Silenzioso */ }
    }

    // Alert CAMPANIA
    const alertDivCampania = document.getElementById('crm-opp-alert-campania');
    if (alertDivCampania) {
        try {
            const res4 = await fetch(`${API_URL}/crm/opportunita/scadute?regione=CAMPANIA&key=${ADMIN_KEY}`);
            if (res4.ok) {
                const data4 = await res4.json();
                const totale4 = data4.reduce((sum, r) => sum + parseInt(r.totale), 0);
                if (totale4 > 0) {
                    const clienti4 = data4.flatMap(r => r.clienti || []).filter(n => n.trim()).join(', ');
                    alertDivCampania.innerHTML = `<span class="crm-opp-alert-badge">&#9888; Attenzione: ${totale4} opportunita di vendita scadute - CAMPANIA<br><small style="font-weight:normal;">Clienti: ${clienti4}</small></span>`;
                }
            }
        } catch (e) { /* Silenzioso */ }
    }

    // Alert LAZIO
    const alertDivLazio = document.getElementById('crm-opp-alert-lazio');
    if (alertDivLazio) {
        try {
            const res5 = await fetch(`${API_URL}/crm/opportunita/scadute?regione=LAZIO&key=${ADMIN_KEY}`);
            if (res5.ok) {
                const data5 = await res5.json();
                const totale5 = data5.reduce((sum, r) => sum + parseInt(r.totale), 0);
                if (totale5 > 0) {
                    const clienti5 = data5.flatMap(r => r.clienti || []).filter(n => n.trim()).join(', ');
                    alertDivLazio.innerHTML = `<span class="crm-opp-alert-badge">&#9888; Attenzione: ${totale5} opportunita di vendita scadute - LAZIO<br><small style="font-weight:normal;">Clienti: ${clienti5}</small></span>`;
                }
            }
        } catch (e) { /* Silenzioso */ }
    }

    // Alert EMILIA-ROMAGNA
    const alertDivEmiliaromagna = document.getElementById('crm-opp-alert-emiliaromagna');
    if (alertDivEmiliaromagna) {
        try {
            const res7 = await fetch(`${API_URL}/crm/opportunita/scadute?regione=EMILIA-ROMAGNA&key=${ADMIN_KEY}`);
            if (res7.ok) {
                const data7 = await res7.json();
                const totale7 = data7.reduce((sum, r) => sum + parseInt(r.totale), 0);
                if (totale7 > 0) {
                    const clienti7 = data7.flatMap(r => r.clienti || []).filter(n => n.trim()).join(', ');
                    alertDivEmiliaromagna.innerHTML = `<span class="crm-opp-alert-badge">&#9888; Attenzione: ${totale7} opportunita di vendita scadute - EMILIA-ROMAGNA<br><small style="font-weight:normal;">Clienti: ${clienti7}</small></span>`;
                }
            }
        } catch (e) { /* Silenzioso */ }
    }

    // Alert VALLE D'AOSTA
    const alertDivValledaosta = document.getElementById('crm-opp-alert-valledaosta');
    if (alertDivValledaosta) {
        try {
            const res6 = await fetch(`${API_URL}/crm/opportunita/scadute?regione=VALLE%20D%27AOSTA&key=${ADMIN_KEY}`);
            if (res6.ok) {
                const data6 = await res6.json();
                const totale6 = data6.reduce((sum, r) => sum + parseInt(r.totale), 0);
                if (totale6 > 0) {
                    const clienti6 = data6.flatMap(r => r.clienti || []).filter(n => n.trim()).join(', ');
                    alertDivValledaosta.innerHTML = `<span class="crm-opp-alert-badge">&#9888; Attenzione: ${totale6} opportunita di vendita scadute - VALLE D'AOSTA<br><small style="font-weight:normal;">Clienti: ${clienti6}</small></span>`;
                }
            }
        } catch (e) { /* Silenzioso */ }
    }
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
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Errore caricamento fatture:', err);
        container.innerHTML = '<div class="empty-state"><p>Errore di connessione. Riprova.</p></div>';
    }
}

async function caricaOpportunita() {
    const container = document.getElementById('opportunita-list');
    if (!container) return;

    container.innerHTML = '<p class="loading">Caricamento...</p>';

    try {
        // Capitalizza il nome dell'agente per l'API (kim -> Kim, massimo -> Massimo)
        const agenteCapitalized = AGENTE.charAt(0).toUpperCase() + AGENTE.slice(1);

        const response = await fetch(`${API_URL}/opportunita/agente/${agenteCapitalized}?key=${ADMIN_KEY}`);
        if (!response.ok) throw new Error('Errore caricamento');
        const opportunita = await response.json();

        if (opportunita.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Nessuna opportunità assegnata</p></div>';
            return;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        container.innerHTML = opportunita.map(opp => {
            const dataChiamata = new Date(opp.data_chiamata).toLocaleString('it-IT', {
                timeZone: 'Europe/Rome',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            return `
                <div class="task-card" style="border-left:4px solid #7dd3c0">
                    <div class="task-header">
                        <span class="task-title" style="font-size:1.05rem">${escapeHtml(opp.nome_cliente)}</span>
                    </div>
                    <div class="task-meta" style="margin-top:8px;flex-direction:column;align-items:flex-start;gap:6px">
                        <div style="display:flex;align-items:center;gap:8px">
                            <span style="font-weight:600">📧</span>
                            <span style="font-size:0.9rem">${escapeHtml(opp.email_cliente)}</span>
                        </div>
                        ${opp.telefono_cliente ? `
                        <div style="display:flex;align-items:center;gap:8px">
                            <span style="font-weight:600">📞</span>
                            <span style="font-size:0.9rem">${escapeHtml(opp.telefono_cliente)}</span>
                        </div>
                        ` : ''}
                        <div style="display:flex;align-items:center;gap:8px">
                            <span style="font-weight:600">📅</span>
                            <span style="font-size:0.9rem">${dataChiamata}</span>
                        </div>
                        ${opp.event_type ? `
                        <div style="display:flex;align-items:center;gap:8px">
                            <span style="font-weight:600">🎯</span>
                            <span style="font-size:0.9rem">${escapeHtml(opp.event_type)}</span>
                        </div>
                        ` : ''}
                        ${opp.note ? `
                        <div style="margin-top:6px;padding:8px;background:#f9fafb;border-radius:4px;font-size:0.85rem;color:#6b7280">
                            ${escapeHtml(opp.note).substring(0, 100)}${opp.note.length > 100 ? '...' : ''}
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Errore caricamento opportunità:', err);
        container.innerHTML = `<div class="empty-state"><p style="color:#dc2626;">Errore: ${err.message}</p></div>`;
    }
}
