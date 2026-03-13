// Configurazione
const API_URL = window.location.origin + '/api';
const ADMIN_KEY = new URLSearchParams(window.location.search).get('key') || '';

// Stato
let allTasks = [];
let currentSection = 'cs';

// Elementi DOM
const taskForm = document.getElementById('taskForm');
const taskListCS = document.getElementById('taskListCS');
const taskListPrivati = document.getElementById('taskListPrivati');
const editModal = document.getElementById('editModal');
const editForm = document.getElementById('editForm');
const deleteBtn = document.getElementById('deleteBtn');
const filterStato = document.getElementById('filterStato');
const filterPriorita = document.getElementById('filterPriorita');
const tipoSelect = document.getElementById('tipo');
const assegnatoGroup = document.getElementById('assegnatoGroup');

// Inizializzazione
document.addEventListener('DOMContentLoaded', () => {
    // Verifica chiave admin
    if (!ADMIN_KEY) {
        document.body.innerHTML = '<div class="container"><h1>Accesso negato</h1><p>Chiave admin mancante. Usa: /admin?key=TUA_CHIAVE</p></div>';
        return;
    }

    // Aggiorna link storico con chiave
    const storicoLink = document.querySelector('.nav-storico');
    if (storicoLink) {
        storicoLink.href = `storico.html?key=${ADMIN_KEY}`;
    }

    // Aggiorna link report con chiave
    const reportLink = document.querySelector('.nav-report');
    if (reportLink) {
        reportLink.href = `report.html?key=${ADMIN_KEY}`;
    }

    const mktgLink = document.querySelector('.nav-mktg');
    if (mktgLink) {
        mktgLink.href = `pianificazione-mktg.html?key=${ADMIN_KEY}`;
    }

    loadTasks();
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    // Form nuovo task
    taskForm.addEventListener('submit', handleCreateTask);

    // Mostra/nascondi campo assegnato in base al tipo
    tipoSelect.addEventListener('change', () => {
        assegnatoGroup.style.display = tipoSelect.value === 'cs' ? 'block' : 'none';
    });

    // Dropdown toggle
    document.querySelectorAll('.nav-dropdown-toggle').forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            e.preventDefault();
            const dropdown = toggle.closest('.nav-dropdown');
            // Close other dropdowns
            document.querySelectorAll('.nav-dropdown').forEach(d => {
                if (d !== dropdown) d.classList.remove('open');
            });
            dropdown.classList.toggle('open');
        });
    });

    // Close dropdowns on click outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.nav-dropdown')) {
            document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
        }
    });

    // Navigazione sezioni (dropdown items + direct nav links)
    document.querySelectorAll('.nav-dropdown-item[data-section], .nav-link[data-section]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            // Close dropdown after selection
            const dropdown = link.closest('.nav-dropdown');
            if (dropdown) dropdown.classList.remove('open');
            switchSection(link.dataset.section);
        });
    });

    // Filtri
    filterStato.addEventListener('change', renderTasks);
    filterPriorita.addEventListener('change', renderTasks);

    // Modal modifica
    document.querySelector('.close').addEventListener('click', closeModal);
    editForm.addEventListener('submit', handleUpdateTask);
    deleteBtn.addEventListener('click', handleDeleteTask);

    // Chiudi modal cliccando fuori
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) closeModal();
    });
}

// Carica tutti i task
async function loadTasks() {
    try {
        const response = await fetch(`${API_URL}/tasks?key=${ADMIN_KEY}`);
        if (!response.ok) throw new Error('Errore caricamento');
        allTasks = await response.json();
        renderTasks();
    } catch (error) {
        console.error('Errore:', error);
        showToast('Errore nel caricamento dei task', 'error');
    }
}

// Cambia sezione
function switchSection(section) {
    currentSection = section;

    // Aggiorna nav - direct links
    document.querySelectorAll('nav > .nav-link[data-section]').forEach(link => {
        link.classList.toggle('active', link.dataset.section === section);
    });

    // Aggiorna nav - dropdown items and toggles
    document.querySelectorAll('.nav-dropdown').forEach(dropdown => {
        const items = dropdown.querySelectorAll('.nav-dropdown-item[data-section]');
        const toggle = dropdown.querySelector('.nav-dropdown-toggle');
        let hasActive = false;
        items.forEach(item => {
            const isActive = item.dataset.section === section;
            item.classList.toggle('active', isActive);
            if (isActive) hasActive = true;
        });
        toggle.classList.toggle('active', hasActive);
    });

    // Mostra/nascondi sezioni
    document.getElementById('section-cs').style.display = section === 'cs' ? 'block' : 'none';
    document.getElementById('section-privati').style.display = section === 'privati' ? 'block' : 'none';
    document.getElementById('section-report-kim').style.display = section === 'report-kim' ? 'block' : 'none';
    document.getElementById('section-report-massimo').style.display = section === 'report-massimo' ? 'block' : 'none';
    document.getElementById('section-suture').style.display = section === 'suture' ? 'block' : 'none';
    document.getElementById('section-crm').style.display = section === 'crm' ? 'block' : 'none';

    // Nascondi form e filtri per le sezioni report
    const formSection = document.querySelector('.form-section');
    const filtersSection = document.querySelector('.filters-section');
    if (section === 'report-kim' || section === 'report-massimo' || section === 'suture' || section === 'crm') {
        if (formSection) formSection.style.display = 'none';
        if (filtersSection) filtersSection.style.display = 'none';
    } else {
        if (formSection) formSection.style.display = 'block';
        if (filtersSection) filtersSection.style.display = 'block';
    }

    // Carica report e fatture se necessario
    if (section === 'report-kim') {
        loadReportsKim();
        loadFatture('kim');
    } else if (section === 'report-massimo') {
        loadReportsMassimo();
        loadFatture('massimo');
    } else if (section === 'suture') {
        loadSuture();
    }

    // Aggiorna tipo nel form (solo per sezioni task)
    if (section === 'cs' || section === 'privati') {
        tipoSelect.value = section === 'cs' ? 'cs' : 'privato';
        assegnatoGroup.style.display = section === 'cs' ? 'block' : 'none';
        renderTasks();
    }
}

// Carica report Kim
async function loadReportsKim() {
    const container = document.getElementById('reports-kim-container');
    container.innerHTML = '<p class="loading">Caricamento...</p>';

    try {
        const response = await fetch(`${API_URL}/reports-antonia/kim/info?key=${ADMIN_KEY}`);
        if (!response.ok) throw new Error('Errore caricamento');
        const info = await response.json();

        let html = '';

        if (info.crediti) {
            html += `
                <div class="report-card report-card-crediti_kim" onclick="window.location.href='${API_URL}/reports-antonia/kim/crediti?key=${ADMIN_KEY}'">
                    <div class="report-card-tipo">Crediti</div>
                    <div class="report-card-titolo">Report Crediti Kim</div>
                    <div class="report-card-data">Aggiornato: ${info.crediti.aggiornato}</div>
                </div>
            `;
        }

        if (info.attenzionare) {
            html += `
                <div class="report-card report-card-attenzionare" onclick="window.location.href='${API_URL}/reports-antonia/kim/attenzionare?key=${ADMIN_KEY}'">
                    <div class="report-card-tipo">Crediti da Attenzionare</div>
                    <div class="report-card-titolo">Posizioni critiche Kim</div>
                    <div class="report-card-data">Aggiornato: ${info.attenzionare.aggiornato}</div>
                </div>
            `;
        }

        if (info.vendite) {
            html += `
                <div class="report-card report-card-vendite_kim" onclick="window.location.href='${API_URL}/reports-antonia/kim/vendite?key=${ADMIN_KEY}'">
                    <div class="report-card-tipo">Vendite Progressivo</div>
                    <div class="report-card-titolo">Report Vendite Progressivo 2026</div>
                    <div class="report-card-data">Aggiornato: ${info.vendite.aggiornato}</div>
                </div>
            `;
        }

        if (!html) {
            html = '<div class="empty-state"><p>Nessun report disponibile</p></div>';
        }

        container.innerHTML = html;
    } catch (error) {
        console.error('Errore caricamento report Kim:', error);
        container.innerHTML = '<div class="empty-state"><p>Errore di connessione</p></div>';
    }
}

// Carica report Massimo
async function loadReportsMassimo() {
    const container = document.getElementById('reports-massimo-container');
    container.innerHTML = '<p class="loading">Caricamento...</p>';

    try {
        const response = await fetch(`${API_URL}/reports-antonia/massimo/info?key=${ADMIN_KEY}`);
        if (!response.ok) throw new Error('Errore caricamento');
        const info = await response.json();

        let html = '';

        if (info.crediti) {
            html += `
                <div class="report-card report-card-crediti_massimo" onclick="window.location.href='${API_URL}/reports-antonia/massimo/crediti?key=${ADMIN_KEY}'">
                    <div class="report-card-tipo">Crediti</div>
                    <div class="report-card-titolo">Report Crediti Massimo</div>
                    <div class="report-card-data">Aggiornato: ${info.crediti.aggiornato}</div>
                </div>
            `;
        }

        if (info.attenzionare) {
            html += `
                <div class="report-card report-card-attenzionare" onclick="window.location.href='${API_URL}/reports-antonia/massimo/attenzionare?key=${ADMIN_KEY}'">
                    <div class="report-card-tipo">Crediti da Attenzionare</div>
                    <div class="report-card-titolo">Posizioni critiche Massimo</div>
                    <div class="report-card-data">Aggiornato: ${info.attenzionare.aggiornato}</div>
                </div>
            `;
        }

        if (info.vendite) {
            html += `
                <div class="report-card report-card-vendite_massimo" onclick="window.location.href='${API_URL}/reports-antonia/massimo/vendite?key=${ADMIN_KEY}'">
                    <div class="report-card-tipo">Vendite Progressivo</div>
                    <div class="report-card-titolo">Report Vendite Progressivo 2026</div>
                    <div class="report-card-data">Aggiornato: ${info.vendite.aggiornato}</div>
                </div>
            `;
        }

        if (!html) {
            html = '<div class="empty-state"><p>Nessun report disponibile</p></div>';
        }

        container.innerHTML = html;
    } catch (error) {
        console.error('Errore caricamento report Massimo:', error);
        container.innerHTML = '<div class="empty-state"><p>Errore di connessione</p></div>';
    }
}

// Renderizza task
function renderTasks() {
    const statoFilter = filterStato.value;
    const prioritaFilter = filterPriorita.value;

    // Filtra task CS
    let tasksCS = allTasks.filter(t => t.tipo === 'cs');
    if (statoFilter) tasksCS = tasksCS.filter(t => t.stato === statoFilter);
    if (prioritaFilter) tasksCS = tasksCS.filter(t => t.priorita === prioritaFilter);

    // Filtra task Privati
    let tasksPrivati = allTasks.filter(t => t.tipo === 'privato');
    if (statoFilter) tasksPrivati = tasksPrivati.filter(t => t.stato === statoFilter);
    if (prioritaFilter) tasksPrivati = tasksPrivati.filter(t => t.priorita === prioritaFilter);

    // Render CS
    if (tasksCS.length === 0) {
        taskListCS.innerHTML = '<div class="empty-state"><p>Nessun task CS</p></div>';
    } else {
        taskListCS.innerHTML = tasksCS.map(task => createTaskCard(task)).join('');
    }

    // Render Privati
    if (tasksPrivati.length === 0) {
        taskListPrivati.innerHTML = '<div class="empty-state"><p>Nessun task privato</p></div>';
    } else {
        taskListPrivati.innerHTML = tasksPrivati.map(task => createTaskCard(task)).join('');
    }

    // Aggiungi event listeners ai bottoni
    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.id)));
    });
}

// Crea card task
function createTaskCard(task) {
    const scadenzaFormatted = task.scadenza
        ? new Date(task.scadenza).toLocaleDateString('it-IT')
        : 'Non impostata';

    const statoLabel = {
        'da_fare': 'Da fare',
        'in_corso': 'In corso',
        'completato': 'Completato'
    };

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
                    <span class="badge badge-stato ${task.stato}">${statoLabel[task.stato]}</span>
                    <span class="badge badge-priorita ${task.priorita}">${prioritaLabel[task.priorita]}</span>
                </div>
            </div>
            ${task.descrizione ? `<p class="task-description">${escapeHtml(task.descrizione)}</p>` : ''}
            <div class="task-meta">
                <span>📅 Scadenza: ${scadenzaFormatted}</span>
                ${task.assegnato_a ? `<span>👤 ${escapeHtml(task.assegnato_a)}</span>` : ''}
                ${task.commenti && task.commenti.length > 0 ? `<span>💬 ${task.commenti.length} commenti</span>` : ''}
            </div>
            ${task.stato === 'completato' ? `
                <div class="task-completion-info">
                    <strong>Completato</strong> da ${escapeHtml(task.completato_da || 'N/A')}
                    il ${task.completato_il ? new Date(task.completato_il).toLocaleString('it-IT') : 'N/A'}
                </div>
            ` : ''}
            <div class="task-actions">
                <button class="btn btn-secondary btn-small btn-edit" data-id="${task.id}">Modifica</button>
            </div>
        </div>
    `;
}

// Crea nuovo task
async function handleCreateTask(e) {
    e.preventDefault();

    const formData = new FormData(taskForm);
    const data = {
        titolo: formData.get('titolo'),
        descrizione: formData.get('descrizione'),
        priorita: formData.get('priorita'),
        scadenza: formData.get('scadenza') || null,
        assegnato_a: formData.get('assegnato_a') || null,
        tipo: formData.get('tipo')
    };

    try {
        const response = await fetch(`${API_URL}/tasks?key=${ADMIN_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) throw new Error('Errore creazione');

        taskForm.reset();
        tipoSelect.value = currentSection === 'cs' ? 'cs' : 'privato';
        await loadTasks();
        showToast('Task creato con successo', 'success');
    } catch (error) {
        console.error('Errore:', error);
        showToast('Errore nella creazione del task', 'error');
    }
}

// Apri modal modifica
function openEditModal(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    document.getElementById('editId').value = task.id;
    document.getElementById('editTitolo').value = task.titolo;
    document.getElementById('editDescrizione').value = task.descrizione || '';
    document.getElementById('editStato').value = task.stato;
    document.getElementById('editPriorita').value = task.priorita;
    document.getElementById('editScadenza').value = task.scadenza || '';
    document.getElementById('editAssegnato').value = task.assegnato_a || '';

    editModal.classList.add('show');
}

// Chiudi modal
function closeModal() {
    editModal.classList.remove('show');
}

// Aggiorna task
async function handleUpdateTask(e) {
    e.preventDefault();

    const id = document.getElementById('editId').value;
    const data = {
        titolo: document.getElementById('editTitolo').value,
        descrizione: document.getElementById('editDescrizione').value,
        stato: document.getElementById('editStato').value,
        priorita: document.getElementById('editPriorita').value,
        scadenza: document.getElementById('editScadenza').value || null,
        assegnato_a: document.getElementById('editAssegnato').value || null
    };

    try {
        const response = await fetch(`${API_URL}/tasks/${id}?key=${ADMIN_KEY}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) throw new Error('Errore aggiornamento');

        closeModal();
        await loadTasks();
        showToast('Task aggiornato', 'success');
    } catch (error) {
        console.error('Errore:', error);
        showToast('Errore nell\'aggiornamento', 'error');
    }
}

// Elimina task
async function handleDeleteTask() {
    const id = document.getElementById('editId').value;

    if (!confirm('Sei sicuro di voler eliminare questo task?')) return;

    try {
        const response = await fetch(`${API_URL}/tasks/${id}?key=${ADMIN_KEY}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Errore eliminazione');

        closeModal();
        await loadTasks();
        showToast('Task eliminato', 'success');
    } catch (error) {
        console.error('Errore:', error);
        showToast('Errore nell\'eliminazione', 'error');
    }
}

// Utility: escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== FATTURE ====================

// Upload fattura PDF
async function uploadFattura(agente) {
    const fileInput = document.getElementById(`fattura-file-${agente}`);
    const nomeInput = document.getElementById(`fattura-nome-${agente}`);

    if (!fileInput.files.length) {
        showToast('Seleziona un file PDF', 'error');
        return;
    }

    const file = fileInput.files[0];
    if (file.type !== 'application/pdf') {
        showToast('Il file deve essere un PDF', 'error');
        return;
    }

    const nomeFattura = nomeInput.value.trim() || file.name;
    const oggi = new Date().toISOString().split('T')[0];

    const reader = new FileReader();
    reader.onload = async function() {
        try {
            const response = await fetch(`${API_URL}/fatture?key=${ADMIN_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agente: agente,
                    nome_file: nomeFattura,
                    data_fattura: oggi,
                    pdf_base64: reader.result
                })
            });

            if (!response.ok) throw new Error('Errore upload');

            fileInput.value = '';
            nomeInput.value = '';
            showToast('Fattura caricata con successo', 'success');
            loadFatture(agente);
        } catch (error) {
            console.error('Errore upload fattura:', error);
            showToast('Errore nel caricamento della fattura', 'error');
        }
    };
    reader.readAsDataURL(file);
}

// Carica lista fatture
async function loadFatture(agente) {
    const container = document.getElementById(`fatture-${agente}-list`);
    container.innerHTML = '<p class="loading">Caricamento fatture...</p>';

    try {
        const response = await fetch(`${API_URL}/fatture/${agente}?key=${ADMIN_KEY}`);
        if (!response.ok) throw new Error('Errore caricamento');
        const fatture = await response.json();

        if (fatture.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Nessuna fattura caricata</p></div>';
            return;
        }

        container.innerHTML = fatture.map(f => `
            <div class="fattura-item">
                <div class="fattura-info">
                    <span class="fattura-nome">${escapeHtml(f.nome_file)}</span>
                    <span class="fattura-data">${new Date(f.data_fattura).toLocaleDateString('it-IT')}</span>
                    <span class="fattura-size">${f.dimensione_kb} KB</span>
                </div>
                <div class="fattura-actions">
                    <button class="btn btn-secondary btn-small" onclick="window.open('${API_URL}/fatture/${agente}/download/${f.id}?key=${ADMIN_KEY}', '_blank')">Visualizza</button>
                    <button class="btn btn-danger btn-small" onclick="deleteFattura(${f.id}, '${agente}')">Elimina</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Errore caricamento fatture:', error);
        container.innerHTML = '<div class="empty-state"><p>Errore di connessione</p></div>';
    }
}

// Elimina fattura
async function deleteFattura(id, agente) {
    if (!confirm('Sei sicuro di voler eliminare questa fattura?')) return;

    try {
        const response = await fetch(`${API_URL}/fatture/${id}?key=${ADMIN_KEY}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Errore eliminazione');

        showToast('Fattura eliminata', 'success');
        loadFatture(agente);
    } catch (error) {
        console.error('Errore eliminazione fattura:', error);
        showToast('Errore nell\'eliminazione', 'error');
    }
}

// ==================== SUTURE - SIMULATORE ORDINE ====================

let sutureOrdine = [];
let sutureInArrivo = [];
let sutureInBozza = [];
let sutureCatalogo = [];

async function loadSuture() {
    const container = document.getElementById('suture-table-container');
    const syncLabel = document.getElementById('suture-last-sync');
    container.innerHTML = '<p class="loading">Caricamento...</p>';

    try {
        const response = await fetch(`${API_URL}/suture/ordine?key=${ADMIN_KEY}`);
        if (!response.ok) throw new Error('Errore caricamento');
        const data = await response.json();

        if (data.last_sync) {
            const syncDate = new Date(data.last_sync);
            syncLabel.textContent = `Ultimo sync: ${syncDate.toLocaleString('it-IT')}`;
            if (data.sync_status === 'syncing') syncLabel.textContent += ' (sync in corso...)';
            else if (data.sync_status === 'error') { syncLabel.textContent += ' ⚠ Errore'; syncLabel.title = data.sync_error || ''; }
        } else {
            syncLabel.textContent = 'Mai sincronizzato';
        }

        sutureInArrivo = (data.in_arrivo || []).map(i => ({...i, prezzo: i.costo_acquisto}));
        sutureInBozza = (data.in_bozza || []).map(i => ({...i, prezzo: i.costo_acquisto}));
        sutureOrdine = (data.da_ordinare || []).map(i => ({
            product_id: i.product_id, codice: i.codice, descrizione: i.descrizione,
            quantita: i.quantita, prezzo: i.costo_acquisto, best_of: i.best_of, auto: true
        }));

        renderSutureTable();
        await loadSutureCatalogo();
    } catch (error) {
        console.error('Errore caricamento suture:', error);
        container.innerHTML = '<div class="empty-state"><p>Errore di connessione</p></div>';
    }
}

function renderReadOnlyTable(items, tableId, rowClass, badgeClass, badgeText, color) {
    let html = `<div class="suture-table-wrapper" style="margin-bottom:24px;"><table id="${tableId}">
        <thead><tr>
            <th>Tipo</th><th>Codice</th><th>Descrizione</th>
            <th style="text-align:right">Qtà</th>
            <th style="text-align:right">Costo Unit.</th>
            <th style="text-align:right">Valore</th>
        </tr></thead><tbody>`;
    let tot = 0;
    for (const item of items) {
        const valore = Math.round(item.quantita * item.prezzo * 100) / 100;
        tot += valore;
        const tipoBadge = item.best_of ? '<span class="badge-bestof">BEST OF</span>' : '<span class="badge-other">ALTRO</span>';
        html += `<tr class="${rowClass}">
            <td>${tipoBadge}</td>
            <td><strong>${escapeHtml(item.codice)}</strong></td>
            <td>${escapeHtml(item.descrizione)}</td>
            <td style="text-align:right; font-weight:600; color:${color};">${item.quantita} <span class="${badgeClass}">${badgeText}</span></td>
            <td style="text-align:right">${item.prezzo.toFixed(2)} &euro;</td>
            <td style="text-align:right">${valore.toFixed(2)} &euro;</td>
        </tr>`;
    }
    html += `</tbody><tfoot><tr class="suture-row-total">
        <td colspan="5" style="text-align:right; font-weight:700;">TOTALE</td>
        <td style="text-align:right; font-weight:700;">${tot.toFixed(2)} &euro;</td>
    </tr></tfoot></table></div>`;
    return html;
}

function renderSutureTable() {
    const container = document.getElementById('suture-table-container');
    const confermaContainer = document.getElementById('suture-conferma-container');

    const hasArrivo = sutureInArrivo.length > 0;
    const hasBozza = sutureInBozza.length > 0;
    const hasOrdine = sutureOrdine.length > 0;

    if (!hasArrivo && !hasBozza && !hasOrdine) {
        container.innerHTML = '<div class="empty-state"><p>Nessuna sutura da ordinare. Giacenze sufficienti.</p></div>';
        confermaContainer.style.display = 'none';
        return;
    }

    let html = '';

    // Sezione 1: In arrivo (PO confermati — merce in transito)
    if (hasArrivo) {
        html += `<h3 style="margin:0 0 8px 0; color:#059669; font-size:0.95rem;">&#x1f69a; In arrivo (PO confermati)</h3>`;
        html += renderReadOnlyTable(sutureInArrivo, 'suture-table-arrivo', 'suture-row-arrivo', 'badge-arrivo', 'IN ARRIVO', '#059669');
    }

    // Sezione 2: In bozza (PO draft — editabile)
    if (hasBozza) {
        html += `<h3 style="margin:0 0 8px 0; color:#f59e0b; font-size:0.95rem;">&#x1f4cb; In bozza (RDP da confermare)</h3>`;
        html += `<div class="suture-table-wrapper" style="margin-bottom:24px;"><table id="suture-table-bozza">
            <thead><tr>
                <th>Tipo</th><th>Codice</th><th>Descrizione</th>
                <th style="text-align:right">Qtà</th>
                <th style="text-align:right">Costo Unit.</th>
                <th style="text-align:right">Valore</th>
                <th style="text-align:center;width:50px"></th>
            </tr></thead><tbody>`;
        let totBozza = 0;
        for (let i = 0; i < sutureInBozza.length; i++) {
            const item = sutureInBozza[i];
            const valore = Math.round(item.quantita * item.prezzo * 100) / 100;
            totBozza += valore;
            const tipoBadge = item.best_of ? '<span class="badge-bestof">BEST OF</span>' : '<span class="badge-other">ALTRO</span>';
            html += `<tr class="suture-row-bozza">
                <td>${tipoBadge}</td>
                <td><strong>${escapeHtml(item.codice)}</strong></td>
                <td>${escapeHtml(item.descrizione)}</td>
                <td style="text-align:right"><input type="number" class="suture-bozza-qty" data-idx="${i}" value="${item.quantita}" min="1" max="999"></td>
                <td style="text-align:right">${item.prezzo.toFixed(2)} &euro;</td>
                <td style="text-align:right">${valore.toFixed(2)} &euro;</td>
                <td style="text-align:center"><button class="btn-remove-bozza" data-idx="${i}" title="Rimuovi">&times;</button></td>
            </tr>`;
        }
        html += `</tbody><tfoot><tr class="suture-row-total">
            <td colspan="5" style="text-align:right; font-weight:700;">TOTALE BOZZA (${sutureInBozza.length} righe)</td>
            <td style="text-align:right; font-weight:700;">${totBozza.toFixed(2)} &euro;</td>
            <td></td>
        </tr></tfoot></table></div>`;
        html += `<div style="text-align:right; margin-bottom:20px;"><button class="btn-aggiorna-bozza" id="btnAggiornaBozza">Aggiorna Bozza &rarr; Odoo</button></div>`;
    }

    // Sezione 3: Da ordinare (editabile)
    if (hasOrdine) {
        html += `<h3 style="margin:0 0 8px 0; color:#ef4444; font-size:0.95rem;">&#x26a0; Da ordinare</h3>`;
        html += `<div class="suture-table-wrapper"><table id="suture-table">
            <thead><tr>
                <th>Tipo</th><th>Codice</th><th>Descrizione</th>
                <th style="text-align:right">Qtà</th>
                <th style="text-align:right">Costo Unit.</th>
                <th style="text-align:right">Valore</th>
                <th style="text-align:center;width:50px"></th>
            </tr></thead><tbody>`;
        let totale = 0;
        for (let i = 0; i < sutureOrdine.length; i++) {
            const item = sutureOrdine[i];
            const valore = Math.round(item.quantita * item.prezzo * 100) / 100;
            totale += valore;
            const rowClass = item.best_of ? 'suture-row-bestof' : '';
            const tipoBadge = item.best_of ? '<span class="badge-bestof">BEST OF</span>' : '<span class="badge-other">ALTRO</span>';
            const autoTag = item.auto ? ' <span class="badge-auto">AUTO</span>' : ' <span class="badge-manual">MANUALE</span>';
            html += `<tr class="${rowClass}">
                <td>${tipoBadge}${autoTag}</td>
                <td><strong>${escapeHtml(item.codice)}</strong></td>
                <td>${escapeHtml(item.descrizione)}</td>
                <td style="text-align:right"><input type="number" class="suture-qty-input" data-idx="${i}" value="${item.quantita}" min="1" max="999"></td>
                <td style="text-align:right">${item.prezzo.toFixed(2)} &euro;</td>
                <td style="text-align:right">${valore.toFixed(2)} &euro;</td>
                <td style="text-align:center"><button class="btn-remove-sutura" data-idx="${i}" title="Rimuovi">&times;</button></td>
            </tr>`;
        }
        html += `</tbody><tfoot><tr class="suture-row-total">
            <td colspan="5" style="text-align:right; font-weight:700;">TOTALE DA ORDINARE (${sutureOrdine.length} righe)</td>
            <td style="text-align:right; font-weight:700; font-size:1.05rem;">${totale.toFixed(2)} &euro;</td>
            <td></td>
        </tr></tfoot></table></div>`;
    }

    container.innerHTML = html;
    confermaContainer.style.display = hasOrdine ? 'block' : 'none';

    // Event handlers: Rimuovi riga da ordine
    container.querySelectorAll('.btn-remove-sutura').forEach(btn => {
        btn.addEventListener('click', () => {
            sutureOrdine.splice(parseInt(btn.dataset.idx), 1);
            renderSutureTable();
            refreshSutureDropdown();
        });
    });

    // Event handlers: Modifica qty ordine
    container.querySelectorAll('.suture-qty-input').forEach(input => {
        input.addEventListener('change', () => {
            const idx = parseInt(input.dataset.idx);
            const newQty = Math.max(1, parseInt(input.value) || 1);
            input.value = newQty;
            sutureOrdine[idx].quantita = newQty;
            const row = input.closest('tr');
            const valore = Math.round(newQty * sutureOrdine[idx].prezzo * 100) / 100;
            row.querySelectorAll('td')[5].textContent = valore.toFixed(2) + ' €';
            const tot = sutureOrdine.reduce((s, i) => s + Math.round(i.quantita * i.prezzo * 100) / 100, 0);
            const ft = container.querySelector('#suture-table tfoot');
            if (ft) { ft.querySelector('td:first-child').textContent = `TOTALE DA ORDINARE (${sutureOrdine.length} righe)`; ft.querySelector('td:nth-child(2)').textContent = tot.toFixed(2) + ' €'; }
        });
    });

    // Event handlers: Rimuovi riga da bozza
    container.querySelectorAll('.btn-remove-bozza').forEach(btn => {
        btn.addEventListener('click', () => {
            sutureInBozza.splice(parseInt(btn.dataset.idx), 1);
            renderSutureTable();
            refreshSutureDropdown();
        });
    });

    // Event handlers: Modifica qty bozza
    container.querySelectorAll('.suture-bozza-qty').forEach(input => {
        input.addEventListener('change', () => {
            const idx = parseInt(input.dataset.idx);
            const newQty = Math.max(1, parseInt(input.value) || 1);
            input.value = newQty;
            sutureInBozza[idx].quantita = newQty;
            const row = input.closest('tr');
            const valore = Math.round(newQty * sutureInBozza[idx].prezzo * 100) / 100;
            row.querySelectorAll('td')[5].textContent = valore.toFixed(2) + ' €';
            const tot = sutureInBozza.reduce((s, i) => s + Math.round(i.quantita * i.prezzo * 100) / 100, 0);
            const ft = container.querySelector('#suture-table-bozza tfoot');
            if (ft) { ft.querySelector('td:first-child').textContent = `TOTALE BOZZA (${sutureInBozza.length} righe)`; ft.querySelector('td:nth-child(2)').textContent = tot.toFixed(2) + ' €'; }
        });
    });

    // Event handler: Aggiorna Bozza → Odoo
    const btnAggiornaBozza = container.querySelector('#btnAggiornaBozza');
    if (btnAggiornaBozza) {
        btnAggiornaBozza.addEventListener('click', async () => {
            const totale = sutureInBozza.reduce((s, i) => s + i.quantita * i.prezzo, 0).toFixed(2);
            const msg = sutureInBozza.length === 0
                ? 'Vuoi rimuovere TUTTE le righe dalla bozza in Odoo?'
                : `Aggiornare la bozza in Odoo?\n\n${sutureInBozza.length} righe — Totale: €${totale}\n\nLe righe rimosse qui verranno eliminate anche dal PO in Odoo.`;
            if (!confirm(msg)) return;

            btnAggiornaBozza.disabled = true;
            btnAggiornaBozza.textContent = 'Aggiornamento in corso...';
            try {
                const payload = { items: sutureInBozza.map(i => ({
                    product_id: i.product_id,
                    codice: i.codice,
                    descrizione: i.descrizione,
                    quantita: i.quantita,
                    prezzo_unitario: i.prezzo
                }))};
                const resp = await fetch(`${API_URL}/suture/aggiorna-bozza?key=${ADMIN_KEY}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await resp.json();
                if (!resp.ok) throw new Error(result.error || 'Errore');
                let summary = `Bozza ${result.po_names} aggiornata!`;
                if (result.removed > 0) summary += ` ${result.removed} righe rimosse.`;
                if (result.updated > 0) summary += ` ${result.updated} righe aggiornate.`;
                if (result.added > 0) summary += ` ${result.added} righe aggiunte.`;
                showToast(summary, 'success');
                setTimeout(() => loadSuture(), 2000);
            } catch (error) {
                console.error('Errore aggiornamento bozza:', error);
                showToast(`Errore: ${error.message}`, 'error');
            }
            btnAggiornaBozza.disabled = false;
            btnAggiornaBozza.textContent = 'Aggiorna Bozza → Odoo';
        });
    }
}

async function loadSutureCatalogo() {
    try {
        const response = await fetch(`${API_URL}/suture/catalogo?key=${ADMIN_KEY}`);
        if (!response.ok) throw new Error('Errore');
        const data = await response.json();
        sutureCatalogo = data.items || [];
        refreshSutureDropdown();

        const qtySelect = document.getElementById('suture-add-qty');
        if (qtySelect && qtySelect.options.length <= 1) {
            qtySelect.innerHTML = '';
            for (let i = 1; i <= 50; i++) {
                qtySelect.innerHTML += `<option value="${i}">${i}</option>`;
            }
        }
    } catch (e) {
        console.error('Errore caricamento catalogo suture:', e);
    }
}

function refreshSutureDropdown() {
    const select = document.getElementById('suture-add-codice');
    if (!select) return;
    const codiciInOrdine = new Set(sutureOrdine.map(s => s.codice));

    const bestOf = sutureCatalogo.filter(s => s.best_of && !codiciInOrdine.has(s.codice));
    const altri = sutureCatalogo.filter(s => !s.best_of && !codiciInOrdine.has(s.codice));

    let html = '<option value="">-- Seleziona sutura --</option>';
    if (bestOf.length > 0) {
        html += '<optgroup label="BEST OF">';
        for (const s of bestOf) html += `<option value="${s.product_id}" data-codice="${escapeHtml(s.codice)}" data-desc="${escapeHtml(s.descrizione)}" data-prezzo="${s.costo_acquisto}" data-bestof="1">${s.codice} — ${s.descrizione} (€${s.costo_acquisto.toFixed(2)})</option>`;
        html += '</optgroup>';
    }
    if (altri.length > 0) {
        html += '<optgroup label="ALTRO">';
        for (const s of altri) html += `<option value="${s.product_id}" data-codice="${escapeHtml(s.codice)}" data-desc="${escapeHtml(s.descrizione)}" data-prezzo="${s.costo_acquisto}" data-bestof="0">${s.codice} — ${s.descrizione} (€${s.costo_acquisto.toFixed(2)})</option>`;
        html += '</optgroup>';
    }
    select.innerHTML = html;
}

// Event handlers suture
(function() {
    const btnAdd = document.getElementById('btnAddSutura');
    if (btnAdd) {
        btnAdd.addEventListener('click', () => {
            const sel = document.getElementById('suture-add-codice');
            const qty = document.getElementById('suture-add-qty');
            if (!sel.value) { showToast('Seleziona una sutura', 'error'); return; }
            const opt = sel.options[sel.selectedIndex];
            sutureOrdine.push({
                product_id: parseInt(sel.value),
                codice: opt.dataset.codice,
                descrizione: opt.dataset.desc,
                quantita: parseInt(qty.value),
                prezzo: parseFloat(opt.dataset.prezzo),
                best_of: opt.dataset.bestof === '1',
                auto: false
            });
            renderSutureTable();
            refreshSutureDropdown();
        });
    }

    const btnSync = document.getElementById('btnSyncSuture');
    if (btnSync) {
        btnSync.addEventListener('click', async () => {
            btnSync.disabled = true;
            btnSync.textContent = 'Sincronizzazione...';
            try {
                await fetch(`${API_URL}/suture/sync?key=${ADMIN_KEY}`, { method: 'POST' });
                showToast('Sincronizzazione avviata', 'success');
                setTimeout(() => {
                    loadSuture();
                    btnSync.disabled = false;
                    btnSync.textContent = 'Aggiorna da Odoo';
                }, 5000);
            } catch (error) {
                console.error('Errore sync suture:', error);
                showToast('Errore nella sincronizzazione', 'error');
                btnSync.disabled = false;
                btnSync.textContent = 'Aggiorna da Odoo';
            }
        });
    }

    const btnConferma = document.getElementById('btnConfermaOrdine');
    if (btnConferma) {
        btnConferma.addEventListener('click', async () => {
            if (sutureOrdine.length === 0) { showToast('Nessun articolo nell\'ordine', 'error'); return; }
            const totale = sutureOrdine.reduce((s, i) => s + i.quantita * i.prezzo, 0).toFixed(2);
            const hasBozza = sutureInBozza.length > 0;
            const msgConferma = hasBozza
                ? `Aggiungere ${sutureOrdine.length} righe alla bozza esistente in Odoo?\n\nTotale nuove righe: €${totale}`
                : `Creare nuova bozza ordine VITREX in Odoo?\n\n${sutureOrdine.length} righe — Totale: €${totale}`;
            if (!confirm(msgConferma)) return;

            btnConferma.disabled = true;
            btnConferma.textContent = hasBozza ? 'Aggiunta in corso...' : 'Creazione in corso...';
            try {
                const payload = { items: sutureOrdine.map(i => ({
                    product_id: i.product_id,
                    codice: i.codice,
                    descrizione: i.descrizione,
                    quantita: i.quantita,
                    prezzo_unitario: i.prezzo
                }))};
                const resp = await fetch(`${API_URL}/suture/conferma-ordine?key=${ADMIN_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await resp.json();
                if (!resp.ok) throw new Error(result.error || 'Errore');
                const msg = result.action === 'aggiornato'
                    ? `${result.righe} righe aggiunte a ${result.po_name}!`
                    : `Nuova bozza ${result.po_name} creata!`;
                showToast(msg, 'success');
                setTimeout(() => loadSuture(), 2000);
            } catch (error) {
                console.error('Errore conferma ordine:', error);
                showToast(`Errore: ${error.message}`, 'error');
            }
            btnConferma.disabled = false;
            btnConferma.textContent = 'Conferma Ordine → Odoo';
        });
    }
})();

// Toast notification
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}
