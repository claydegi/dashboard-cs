// Configurazione
const API_URL = window.location.origin + '/api';
const ADMIN_KEY = new URLSearchParams(window.location.search).get('key') || '';

// Stato
let completedTasks = [];

// Elementi DOM
const storicoList = document.getElementById('storicoList');
const filterDataDa = document.getElementById('filterDataDa');
const filterDataA = document.getElementById('filterDataA');
const filterOperatore = document.getElementById('filterOperatore');
const clearFiltersBtn = document.getElementById('clearFilters');

// Inizializzazione
document.addEventListener('DOMContentLoaded', () => {
    // Verifica chiave admin
    if (!ADMIN_KEY) {
        document.body.innerHTML = '<div class="container"><h1>Accesso negato</h1><p>Chiave admin mancante. Usa: /storico?key=TUA_CHIAVE</p></div>';
        return;
    }

    // Aggiorna link alla dashboard con chiave
    const backLink = document.querySelector('.nav-back');
    if (backLink) {
        backLink.href = `admin.html?key=${ADMIN_KEY}`;
    }

    loadCompletedTasks();
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    filterDataDa.addEventListener('change', renderTasks);
    filterDataA.addEventListener('change', renderTasks);
    filterOperatore.addEventListener('input', renderTasks);
    clearFiltersBtn.addEventListener('click', clearFilters);
}

// Carica task completati
async function loadCompletedTasks() {
    try {
        const response = await fetch(`${API_URL}/tasks/completed?key=${ADMIN_KEY}`);
        if (!response.ok) throw new Error('Errore caricamento');
        completedTasks = await response.json();
        renderTasks();
        updateStats();
    } catch (error) {
        console.error('Errore:', error);
        storicoList.innerHTML = '<div class="empty-state"><p>Errore nel caricamento dello storico</p></div>';
    }
}

// Aggiorna statistiche
function updateStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());

    const completatiOggi = completedTasks.filter(t => {
        const completedDate = new Date(t.completato_il);
        completedDate.setHours(0, 0, 0, 0);
        return completedDate.getTime() === today.getTime();
    }).length;

    const completatiSettimana = completedTasks.filter(t => {
        const completedDate = new Date(t.completato_il);
        return completedDate >= startOfWeek;
    }).length;

    document.getElementById('statTotale').textContent = completedTasks.length;
    document.getElementById('statOggi').textContent = completatiOggi;
    document.getElementById('statSettimana').textContent = completatiSettimana;
}

// Renderizza task
function renderTasks() {
    let filteredTasks = [...completedTasks];

    // Filtra per data
    if (filterDataDa.value) {
        const dataDa = new Date(filterDataDa.value);
        filteredTasks = filteredTasks.filter(t => new Date(t.completato_il) >= dataDa);
    }

    if (filterDataA.value) {
        const dataA = new Date(filterDataA.value);
        dataA.setHours(23, 59, 59);
        filteredTasks = filteredTasks.filter(t => new Date(t.completato_il) <= dataA);
    }

    // Filtra per operatore
    if (filterOperatore.value) {
        const searchTerm = filterOperatore.value.toLowerCase();
        filteredTasks = filteredTasks.filter(t =>
            t.completato_da && t.completato_da.toLowerCase().includes(searchTerm)
        );
    }

    if (filteredTasks.length === 0) {
        storicoList.innerHTML = '<div class="empty-state"><p>Nessun task completato trovato</p></div>';
        return;
    }

    storicoList.innerHTML = filteredTasks.map(task => createTaskCard(task)).join('');
}

// Crea card task
function createTaskCard(task) {
    const completatoIl = task.completato_il
        ? new Date(task.completato_il).toLocaleString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
        : 'N/A';

    const scadenzaFormatted = task.scadenza
        ? new Date(task.scadenza).toLocaleDateString('it-IT')
        : 'Non impostata';

    const prioritaLabel = {
        'alta': 'Alta',
        'media': 'Media',
        'bassa': 'Bassa'
    };

    return `
        <div class="task-card priority-${task.priorita}">
            <div class="task-header">
                <span class="task-title">${escapeHtml(task.titolo)}</span>
                <div class="task-badges">
                    <span class="badge badge-stato completato">Completato</span>
                    <span class="badge badge-priorita ${task.priorita}">${prioritaLabel[task.priorita]}</span>
                    ${task.tipo === 'privato' ? '<span class="badge" style="background: #9333ea; color: white;">Privato</span>' : ''}
                </div>
            </div>
            ${task.descrizione ? `<p class="task-description">${escapeHtml(task.descrizione)}</p>` : ''}
            <div class="task-meta">
                <span>📅 Scadenza originale: ${scadenzaFormatted}</span>
                ${task.assegnato_a ? `<span>👤 Era assegnato a: ${escapeHtml(task.assegnato_a)}</span>` : ''}
            </div>
            <div class="task-completion-info">
                <strong>✅ Completato</strong> da <strong>${escapeHtml(task.completato_da || 'N/A')}</strong>
                il <strong>${completatoIl}</strong>
            </div>
            ${task.commenti && task.commenti.length > 0 ? `
                <details style="margin-top: 12px;">
                    <summary style="cursor: pointer; color: var(--primary);">
                        💬 ${task.commenti.length} commenti
                    </summary>
                    <div style="margin-top: 8px;">
                        ${task.commenti.map(c => `
                            <div class="comment">
                                <div class="comment-header">
                                    <span class="comment-author">${escapeHtml(c.autore)}</span>
                                    <span class="comment-date">${new Date(c.data).toLocaleString('it-IT')}</span>
                                </div>
                                <p class="comment-text">${escapeHtml(c.testo)}</p>
                            </div>
                        `).join('')}
                    </div>
                </details>
            ` : ''}
        </div>
    `;
}

// Pulisci filtri
function clearFilters() {
    filterDataDa.value = '';
    filterDataA.value = '';
    filterOperatore.value = '';
    renderTasks();
}

// Utility: escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
