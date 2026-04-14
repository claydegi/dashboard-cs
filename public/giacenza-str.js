// giacenza-str.js - Giacenze Strumenti MM Dashboard

const API_BASE = window.location.origin;

async function loadGiacenze() {
    try {
        const params = new URLSearchParams(window.location.search);
        const key = params.get('key');

        const response = await fetch(`${API_BASE}/api/giacenze-strumenti?key=${key}`);

        if (!response.ok) {
            throw new Error('Errore nel caricamento dei dati');
        }

        const data = await response.json();

        // Update timestamp
        const timestamp = new Date(data.timestamp);
        document.getElementById('lastUpdate').textContent =
            `Ultimo aggiornamento: ${timestamp.toLocaleString('it-IT')}`;

        // Render alerts
        renderAlerts(data.kits);

        // Render kits
        renderKits(data.kits);

    } catch (error) {
        console.error('Errore:', error);
        document.getElementById('kitsGrid').innerHTML =
            '<p class="error">Errore nel caricamento dei dati. Riprova.</p>';
    }
}

function renderAlerts(kits) {
    const container = document.getElementById('alertContainer');
    const critical = [];
    const warnings = [];

    // Check each kit for critical availability
    Object.entries(kits).forEach(([id, kit]) => {
        if (id === 'fpdfirst') {
            if (kit.disponibilita < 10) {
                critical.push(`${kit.nome}: solo ${kit.disponibilita} pz disponibili`);
            }
        } else if (kit.configurazioni) {
            // Check all configurations
            Object.entries(kit.configurazioni).forEach(([config, qty]) => {
                if (qty <= 1) {
                    critical.push(`${kit.nome} (${config}): solo ${qty} kit`);
                } else if (qty < 10) {
                    warnings.push(`${kit.nome} (${config}): ${qty} kit`);
                }
            });
        } else {
            if (kit.disponibilita <= 1) {
                critical.push(`${kit.nome}: solo ${kit.disponibilita} kit`);
            } else if (kit.disponibilita < 10) {
                warnings.push(`${kit.nome}: ${kit.disponibilita} kit`);
            }
        }

        // Check for negative stock in components
        if (kit.componenti) {
            Object.entries(kit.componenti).forEach(([code, stock]) => {
                if (stock.meta < 0 || stock.osnrgy < 0) {
                    warnings.push(`${code}: giacenza negativa (META: ${stock.meta}, OSNRGY: ${stock.osnrgy})`);
                }
            });
        } else if (kit.stock && (kit.stock.meta < 0 || kit.stock.osnrgy < 0)) {
            warnings.push(`${kit.nome}: giacenza negativa (META: ${kit.stock.meta}, OSNRGY: ${kit.stock.osnrgy})`);
        }
    });

    let html = '';

    if (critical.length > 0) {
        html += '<div class="alert-critical">';
        html += '<strong>⚠️ ATTENZIONE: Disponibilità critiche</strong><ul style="margin: 8px 0 0 20px;">';
        critical.forEach(msg => {
            html += `<li>${msg}</li>`;
        });
        html += '</ul></div>';
    }

    if (warnings.length > 0) {
        html += '<div class="alert-warning">';
        html += '<strong>⚡ Avvisi</strong><ul style="margin: 8px 0 0 20px;">';
        warnings.forEach(msg => {
            html += `<li>${msg}</li>`;
        });
        html += '</ul></div>';
    }

    container.innerHTML = html;
}

function renderKits(kits) {
    const grid = document.getElementById('kitsGrid');
    let html = '';

    // Order: show critical first
    const kitOrder = [
        'pt1',           // 1 kit completo
        'guided',        // 1 kit
        'levacorone',    // 7 kit
        'black_ruby',    // 50 kit
        'easyin',        // 57 kit
        'elevate',       // 65 kit
        'espansori',     // 101 kit base
        'osteotomi',     // 111 kit
        'estrattori',    // 119 kit
        'easypin',       // 22 kit completo
        'fpdfirst'       // 66 pz
    ];

    kitOrder.forEach(kitId => {
        if (!kits[kitId]) return;

        const kit = kits[kitId];
        html += renderKitCard(kitId, kit);
    });

    grid.innerHTML = html;

    // Add toggle listeners
    document.querySelectorAll('.componenti-toggle').forEach(btn => {
        btn.addEventListener('click', function() {
            const details = this.nextElementSibling;
            details.classList.toggle('show');
            this.textContent = details.classList.contains('show')
                ? '▼ Nascondi componenti'
                : '▶ Mostra componenti';
        });
    });
}

function renderKitCard(kitId, kit) {
    let cardClass = 'kit-card';
    let disponibilita = 0;

    // Determine card class and main availability
    if (kitId === 'fpdfirst') {
        disponibilita = kit.disponibilita;
    } else if (kit.configurazioni) {
        // Use the minimum configuration
        disponibilita = Math.min(...Object.values(kit.configurazioni));
    } else {
        disponibilita = kit.disponibilita;
    }

    if (disponibilita <= 1) {
        cardClass += ' critical';
    } else if (disponibilita < 10) {
        cardClass += ' warning';
    }

    let html = `<div class="${cardClass}">`;
    html += `<div class="kit-name">${kit.nome}</div>`;

    // Main availability or configurations
    if (kit.configurazioni) {
        html += '<div class="kit-configurazioni">';
        Object.entries(kit.configurazioni).forEach(([config, qty]) => {
            html += `<div class="config-row">`;
            html += `<span class="config-name">${config}</span>`;
            html += `<span class="config-qty">${qty} kit</span>`;
            html += `</div>`;
        });
        html += '</div>';
    } else {
        html += `<div class="kit-disponibilita">${disponibilita}</div>`;
        html += `<div class="kit-label">${kitId === 'fpdfirst' ? 'pezzi disponibili' : 'kit disponibili'}</div>`;
    }

    // Bottleneck info
    if (kit.bottleneck && !kit.configurazioni) {
        html += `<div class="kit-bottleneck">🔒 Bottleneck: ${kit.bottleneck}</div>`;
    } else if (kit.bottleneck && typeof kit.bottleneck === 'object') {
        html += `<div class="kit-bottleneck">`;
        Object.entries(kit.bottleneck).forEach(([config, comp]) => {
            html += `🔒 ${config}: ${comp}<br>`;
        });
        html += `</div>`;
    }

    // Special info for pins (easypin)
    if (kit.pins_disponibili) {
        html += '<div class="kit-configurazioni" style="margin-top: 12px; border-top: 1px solid #e5e7eb; padding-top: 12px;">';
        html += '<div style="font-size: 0.9rem; font-weight: 600; margin-bottom: 8px; color: #6b7280;">Pin disponibili (separati)</div>';
        Object.entries(kit.pins_disponibili).forEach(([pin, qty]) => {
            html += `<div class="config-row">`;
            html += `<span class="config-name">${pin}</span>`;
            html += `<span class="config-qty">${qty} pz</span>`;
            html += `</div>`;
        });
        html += '</div>';
    }

    // Note
    if (kit.note) {
        html += `<div class="kit-note">${kit.note}</div>`;
    }

    // Components toggle
    if (kit.componenti) {
        html += `<button class="componenti-toggle">▶ Mostra componenti</button>`;
        html += `<div class="componenti-details">`;
        html += renderComponentsTable(kit.componenti);
        html += `</div>`;
    }

    html += '</div>';

    return html;
}

function renderComponentsTable(componenti) {
    let html = '<table>';
    html += '<thead><tr><th>Codice</th><th>Giacenza</th></tr></thead>';
    html += '<tbody>';

    Object.entries(componenti).forEach(([code, stock]) => {
        html += '<tr>';
        html += `<td>${code}</td>`;
        html += `<td><strong>${stock.totale}</strong></td>`;
        html += '</tr>';
    });

    html += '</tbody></table>';
    return html;
}

// Refresh button
document.getElementById('btnRefresh').addEventListener('click', async () => {
    const btn = document.getElementById('btnRefresh');
    btn.textContent = 'Aggiornamento...';
    btn.disabled = true;

    // Trigger sync on server
    try {
        const params = new URLSearchParams(window.location.search);
        const key = params.get('key');

        await fetch(`${API_BASE}/api/giacenze-strumenti/sync?key=${key}`, {
            method: 'POST'
        });

        // Wait a bit then reload
        setTimeout(() => {
            loadGiacenze();
            btn.textContent = 'Aggiorna ora';
            btn.disabled = false;
        }, 2000);
    } catch (error) {
        console.error('Errore sync:', error);
        btn.textContent = 'Aggiorna ora';
        btn.disabled = false;
        alert('Errore durante l\'aggiornamento. Riprova.');
    }
});

// Load on page load
document.addEventListener('DOMContentLoaded', loadGiacenze);
