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
    document.getElementById('section-freelancer').style.display = section === 'freelancer' ? 'block' : 'none';
    document.getElementById('section-opportunita').style.display = section === 'opportunita' ? 'block' : 'none';

    // Nascondi form e filtri per le sezioni report
    const formSection = document.querySelector('.form-section');
    const filtersSection = document.querySelector('.filters-section');
    if (section === 'report-kim' || section === 'report-massimo' || section === 'suture' || section === 'crm' || section === 'freelancer' || section === 'opportunita') {
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
        loadOpportunitaAgente('Kim');
    } else if (section === 'report-massimo') {
        loadReportsMassimo();
        loadFatture('massimo');
        loadOpportunitaAgente('Massimo');
    } else if (section === 'suture') {
        loadSuture();
    } else if (section === 'crm') {
        loadCrmRiepilogo();
    } else if (section === 'freelancer') {
        loadFreelancerJobs();
        loadFreelancerApprovals();
    } else if (section === 'opportunita') {
        loadOpportunita();
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
let sutureOrdiniClienti = [];
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
        sutureOrdiniClienti = data.ordini_clienti || [];
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
    const hasOrdiniClienti = sutureOrdiniClienti.length > 0;

    if (!hasArrivo && !hasBozza && !hasOrdine) {
        confermaContainer.style.display = 'none';
    }

    let html = '';

    // Sezione 0: Ordini clienti in sospeso (backorders) — sempre visibile
    if (hasOrdiniClienti) {
        const totPezzi = sutureOrdiniClienti.reduce((s, i) => s + (parseFloat(i.qty_to_deliver) || 0), 0);
        html += `<h3 style="margin:0 0 8px 0; color:#7c3aed; font-size:0.95rem;">&#x1f4e6; Ordini clienti in sospeso (${sutureOrdiniClienti.length} righe &mdash; ${totPezzi} pz totali)</h3>`;
        html += `<div class="suture-table-wrapper" style="margin-bottom:24px;"><table id="suture-table-ordini-clienti">
            <thead><tr>
                <th>Ordine</th><th>Cliente</th><th>Codice Sutura</th>
                <th>Data Ordine</th>
                <th style="text-align:right">Qt&agrave; da Consegnare</th>
            </tr></thead><tbody>`;
        for (const item of sutureOrdiniClienti) {
            const dataOrdine = item.date_order
                ? new Date(item.date_order).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
                : '—';
            let daysBadge = '';
            if (item.date_order) {
                const days = Math.floor((Date.now() - new Date(item.date_order).getTime()) / 86400000);
                if (days > 30) daysBadge = ` <span class="badge-overdue">${days}gg</span>`;
                else if (days > 14) daysBadge = ` <span class="badge-warning-days">${days}gg</span>`;
            }
            html += `<tr class="suture-row-ordine-cliente">
                <td><strong>${escapeHtml(item.sale_order_name)}</strong></td>
                <td>${escapeHtml(item.partner_name)}</td>
                <td>${escapeHtml(item.codice)}</td>
                <td>${dataOrdine}${daysBadge}</td>
                <td style="text-align:right; font-weight:600; color:#7c3aed;">${parseFloat(item.qty_to_deliver) || 0}</td>
            </tr>`;
        }
        html += `</tbody><tfoot><tr class="suture-row-total">
            <td colspan="4" style="text-align:right; font-weight:700;">TOTALE PEZZI IN SOSPESO</td>
            <td style="text-align:right; font-weight:700; color:#7c3aed;">${totPezzi}</td>
        </tr></tfoot></table></div>`;
    } else {
        html += `<div style="background:#f5f3ff; border:1px solid #c4b5fd; border-radius:8px; padding:16px 20px; margin-bottom:24px; text-align:center; color:#5b21b6;">
            <strong>Nessun ordine cliente in attesa di approvvigionamento</strong>
        </div>`;
    }

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

            const riepilogo = sutureOrdine.map(i => `${i.codice} x${i.quantita}`).join(', ');
            if (!confirm(`Aggiungere alla bozza locale:\n\n${riepilogo}\n\nPoi clicca "Aggiorna Bozza → Odoo" per sincronizzare.`)) return;

            btnConferma.disabled = true;
            btnConferma.textContent = 'Spostamento in corso...';
            try {
                const payload = { items: sutureOrdine.map(i => ({
                    product_id: i.product_id,
                    quantita: i.quantita
                }))};
                const resp = await fetch(`${API_URL}/suture/sposta-in-bozza?key=${ADMIN_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await resp.json();
                if (!resp.ok) throw new Error(result.error || 'Errore');
                showToast(`${result.spostati} righe aggiunte alla bozza. Clicca "Aggiorna Bozza → Odoo" per sincronizzare.`, 'success');
                setTimeout(() => loadSuture(), 1000);
            } catch (error) {
                console.error('Errore conferma ordine:', error);
                showToast(`Errore: ${error.message}`, 'error');
            }
            btnConferma.disabled = false;
            btnConferma.textContent = 'Conferma Ordine → Bozza';
        });
    }
})();

// Riepilogo CRM (riordino + hot opportunity)
async function loadCrmRiepilogo() {
    const container = document.getElementById('crm-riepilogo');
    if (!container) return;
    container.innerHTML = '<p class="loading" style="margin-top:20px;">Caricamento riepilogo...</p>';

    try {
        const response = await fetch(`${API_URL}/crm/riepilogo?key=${ADMIN_KEY}`);
        if (!response.ok) throw new Error('Errore caricamento riepilogo');
        const data = await response.json();

        // --- Riordino ---
        let riordinoHtml = '<div style="flex:1;min-width:260px">';
        riordinoHtml += '<h4 style="margin:0 0 12px 0;font-size:1rem;color:#374151">Da Riordino</h4>';
        const prodottiRiordino = ['BLEXO', 'CEP', 'SUTURE'];
        for (const prod of prodottiRiordino) {
            const n = (data.riordino && data.riordino[prod]) || 0;
            const color = n > 0 ? '#dc2626' : '#16a34a';
            riordinoHtml += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f3f4f6">
                <span style="font-weight:600;color:#374151">${prod}</span>
                <span style="font-weight:700;font-size:1.1rem;color:${color}">${n} <span style="font-weight:400;font-size:0.85rem;color:#6b7280">account</span></span>
            </div>`;
        }
        riordinoHtml += '</div>';

        // --- Hot Opportunity ---
        let hotHtml = '<div style="flex:1;min-width:280px">';
        hotHtml += '<h4 style="margin:0 0 14px 0;font-size:1rem;color:#374151">Opportunity Hot <span style="font-weight:400;font-size:0.85rem;color:#6b7280">(&ge;400pt)</span></h4>';
        const hotLinee = data.hot ? Object.keys(data.hot).sort() : [];
        if (hotLinee.length === 0) {
            hotHtml += '<div style="color:#9ca3af;font-style:italic;padding:6px 0">Nessun contatto hot</div>';
        } else {
            for (const linea of hotLinee) {
                const acc = data.hot[linea].account || 0;
                const lead = data.hot[linea].lead || 0;
                const totale = acc + lead;
                hotHtml += `<div style="padding:10px 12px;margin-bottom:8px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;border-left:4px solid #7c3aed">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                        <span style="font-weight:700;font-size:1.05rem;color:#374151">${linea}</span>
                        <span style="font-weight:800;font-size:1.25rem;color:#7c3aed">${totale} <span style="font-weight:400;font-size:0.85rem;color:#6b7280">totali</span></span>
                    </div>
                    <div style="font-size:0.88rem;color:#6b7280">
                        di cui <span style="font-weight:600;color:#7c3aed">${acc}</span> account, <span style="font-weight:600;color:#2563eb">${lead}</span> lead
                    </div>
                </div>`;
            }
        }
        hotHtml += '</div>';

        container.innerHTML = `
            <div style="margin-top:24px;padding:20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px">
                <h3 style="margin:0 0 16px 0;font-size:1.35rem;font-weight:800;color:#111827;border-bottom:2px solid #e5e7eb;padding-bottom:10px;letter-spacing:-0.01em">Opportunit&agrave; di Vendita</h3>
                <div style="display:flex;gap:32px;flex-wrap:wrap">
                    ${riordinoHtml}
                    ${hotHtml}
                </div>
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<p style="color:#dc2626;margin-top:20px;">Errore caricamento riepilogo: ${err.message}</p>`;
    }
}

// ==================== FREELANCER ====================

let freelancerPendingFiles = [];

// Sub-tab switching
document.querySelectorAll('.freelancer-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.freelancer-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.freelancer-tab-content').forEach(c => c.style.display = 'none');
        tab.classList.add('active');
        document.getElementById(`freelancer-tab-${tab.dataset.freelancerTab}`).style.display = 'block';
    });
});

// Toggle form nuovo progetto
document.getElementById('btnNuovoJob').addEventListener('click', () => {
    const form = document.getElementById('freelancer-job-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
});
document.getElementById('btnAnnullaJob').addEventListener('click', () => {
    document.getElementById('freelancer-job-form').style.display = 'none';
    resetFreelancerForm();
});

// Drag & drop zone
const dropzone = document.getElementById('freelancer-dropzone');
const fileInput = document.getElementById('freelancer-files');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    handleFreelancerFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => handleFreelancerFiles(fileInput.files));

function handleFreelancerFiles(files) {
    Array.from(files).forEach(file => {
        if (file.size > 8 * 1024 * 1024) {
            showToast(`${file.name} troppo grande (max 8MB)`, 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            freelancerPendingFiles.push({ nome_file: file.name, tipo_file: file.type, file_base64: reader.result });
            renderFreelancerFileList();
        };
        reader.readAsDataURL(file);
    });
}

function renderFreelancerFileList() {
    const list = document.getElementById('freelancer-file-list');
    list.innerHTML = freelancerPendingFiles.map((f, i) => `
        <div class="freelancer-file-item">
            <span>${f.nome_file}</span>
            <button class="btn-small btn-danger" onclick="removeFreelancerFile(${i})">&times;</button>
        </div>
    `).join('');
}

function removeFreelancerFile(index) {
    freelancerPendingFiles.splice(index, 1);
    renderFreelancerFileList();
}

function resetFreelancerForm() {
    document.getElementById('freelancer-titolo').value = '';
    document.getElementById('freelancer-descrizione').value = '';
    document.getElementById('freelancer-budget').value = '';
    freelancerPendingFiles = [];
    renderFreelancerFileList();
}

// Salva progetto
document.getElementById('btnSalvaJob').addEventListener('click', async () => {
    const titolo = document.getElementById('freelancer-titolo').value.trim();
    const descrizione_testo = document.getElementById('freelancer-descrizione').value.trim();
    const budget_max = document.getElementById('freelancer-budget').value || null;

    if (!titolo) { showToast('Titolo obbligatorio', 'error'); return; }

    try {
        const res = await fetch(`${API_URL}/freelancer/jobs?key=${ADMIN_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ titolo, descrizione_testo, budget_max, allegati: freelancerPendingFiles })
        });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast('Progetto creato');
        document.getElementById('freelancer-job-form').style.display = 'none';
        resetFreelancerForm();
        loadFreelancerJobs();
    } catch (err) {
        showToast('Errore: ' + err.message, 'error');
    }
});

// Ottimizza con AI (Job Composer) - chiamata da vista dettaglio
async function optimizeWithAI(jobId) {
    if (!confirm('Ottimizzare questo progetto con AI? Claude analizzerà il brief e suggerirà titolo, descrizione e skill ottimizzati per Freelancer.com.')) return;

    try {
        showToast('⏳ AI in corso, attendere 15-20 secondi...');

        const res = await fetch(`${API_URL}/freelancer/ai/compose?key=${ADMIN_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: jobId })
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.details || error.error);
        }

        showToast('✅ Job Composer completato! Vai nel tab Approvazioni per vedere il risultato.');

        loadFreelancerJobs();
        loadFreelancerApprovals();

        // Switcha al tab approvazioni
        setTimeout(() => {
            document.querySelector('[data-freelancer-tab="approvazioni"]').click();
        }, 1000);

    } catch (err) {
        showToast('❌ Errore AI: ' + err.message, 'error');
    }
}

// Analizza proposte con AI (Talent Scout)
async function analyzeBidsWithAI(jobId) {
    if (!confirm('Analizzare le proposte ricevute con AI? Claude valuterà tutti i freelancer e ti suggerirà i migliori 3 candidati.')) return;

    try {
        showToast('⏳ Talent Scout in corso, attendere 20-30 secondi...');

        const res = await fetch(`${API_URL}/freelancer/ai/scout?key=${ADMIN_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: jobId })
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.details || error.error);
        }

        showToast('✅ Talent Scout completato! Vai nel tab Approvazioni per vedere i top 3 candidati.');

        loadFreelancerJobs();
        loadFreelancerApprovals();

        // Switcha al tab approvazioni
        setTimeout(() => {
            document.querySelector('[data-freelancer-tab="approvazioni"]').click();
        }, 1000);

    } catch (err) {
        showToast('❌ Errore Talent Scout: ' + err.message, 'error');
    }
}

// Carica lista progetti
async function loadFreelancerJobs() {
    const container = document.getElementById('freelancer-jobs-list');
    try {
        const res = await fetch(`${API_URL}/freelancer/jobs?key=${ADMIN_KEY}`);
        if (!res.ok) throw new Error('Errore caricamento');
        const jobs = await res.json();

        if (jobs.length === 0) {
            container.innerHTML = '<p style="color:#6b7280;text-align:center;padding:40px;">Nessun progetto. Clicca "+ Nuovo Progetto" per iniziare.</p>';
            return;
        }

        container.innerHTML = jobs.map(j => {
            const statoColors = { bozza: '#6b7280', pubblicato: '#3b82f6', in_corso: '#f59e0b', completato: '#22c55e', annullato: '#ef4444' };
            const color = statoColors[j.stato] || '#6b7280';
            const pending = j.num_pending > 0 ? `<span class="nav-badge">${j.num_pending}</span>` : '';
            return `
                <div class="freelancer-job-card" onclick="openFreelancerJob(${j.id})">
                    <div class="freelancer-job-header">
                        <h3>${j.titolo}</h3>
                        <span class="freelancer-stato" style="background:${color}">${j.stato}</span>
                    </div>
                    <p class="freelancer-job-desc">${(j.descrizione_testo || '').substring(0, 150)}${(j.descrizione_testo || '').length > 150 ? '...' : ''}</p>
                    <div class="freelancer-job-footer">
                        <span>${j.budget_max ? '€' + Number(j.budget_max).toLocaleString('it') : 'Budget non definito'}</span>
                        <span>${j.num_allegati} allegati</span>
                        <span>${pending} ${new Date(j.created_at).toLocaleDateString('it')}</span>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        container.innerHTML = `<p style="color:#dc2626;">Errore: ${err.message}</p>`;
    }
}

// Apri dettaglio progetto
async function openFreelancerJob(id) {
    const container = document.getElementById('freelancer-jobs-list');
    try {
        const res = await fetch(`${API_URL}/freelancer/jobs/${id}?key=${ADMIN_KEY}`);
        if (!res.ok) throw new Error('Errore caricamento');
        const job = await res.json();

        const allegatiHtml = job.allegati.map(a => `
            <div class="freelancer-file-item">
                <span>${a.nome_file} (${a.dimensione_kb} KB)</span>
                <button class="btn-small btn-danger" onclick="deleteFreelancerAttachment(${id}, ${a.id})">&times;</button>
            </div>
        `).join('') || '<p style="color:#6b7280;">Nessun allegato</p>';

        const approvazioniHtml = job.approvazioni.map(a => {
            const statoClass = a.stato === 'pending' ? 'warning' : a.stato === 'approved' ? 'success' : 'danger';
            return `
                <div class="freelancer-approval-item ${statoClass}">
                    <strong>[${a.modulo}]</strong> ${a.azione}
                    <span class="freelancer-approval-stato">${a.stato}</span>
                </div>
            `;
        }).join('') || '<p style="color:#6b7280;">Nessuna approvazione richiesta</p>';

        // Bottone pubblica o link al progetto live
        let publishHtml = '';
        if (job.freelancer_project_id) {
            publishHtml = `
                <div class="freelancer-live-bar">
                    <span class="freelancer-stato" style="background:#22c55e">LIVE su Freelancer.com</span>
                    <a href="${job.freelancer_url}" target="_blank" class="btn btn-primary">Vedi su Freelancer.com &rarr;</a>
                    <button class="btn" onclick="loadFreelancerBids(${id})">Vedi Proposte</button>
                    <button class="btn btn-secondary" onclick="analyzeBidsWithAI(${id})" style="background:#7c3aed;color:#fff;border:none">🔍 Analizza Proposte con AI</button>
                </div>
                <div id="freelancer-bids-${id}"></div>
            `;
        } else if (job.stato === 'bozza') {
            publishHtml = `
                <div class="freelancer-publish-box">
                    <button class="btn btn-secondary" onclick="optimizeWithAI(${id})" style="margin-bottom:16px;width:100%">✨ Ottimizza con AI</button>
                    <h3>Pubblica su Freelancer.com</h3>
                    <div class="form-group">
                        <label>Budget minimo (EUR)</label>
                        <input type="number" id="freelancer-pub-min-${id}" value="100" min="10" step="10">
                    </div>
                    <button class="btn btn-primary" onclick="publishToFreelancer(${id})">Pubblica su Freelancer.com</button>
                </div>
            `;
        }

        const statoColors = { bozza: '#6b7280', pubblicato: '#3b82f6', in_corso: '#f59e0b', completato: '#22c55e', annullato: '#ef4444' };

        container.innerHTML = `
            <div class="freelancer-detail">
                <button class="btn" onclick="loadFreelancerJobs()">&larr; Torna alla lista</button>
                <h2>${job.titolo}</h2>
                <div class="freelancer-detail-meta">
                    <span class="freelancer-stato" style="background:${statoColors[job.stato] || '#6b7280'}">${job.stato}</span>
                    <span>${job.budget_max ? '\u20ac' + Number(job.budget_max).toLocaleString('it') : 'Budget non definito'}</span>
                    <span>Creato: ${new Date(job.created_at).toLocaleDateString('it')}</span>
                </div>
                ${publishHtml}
                <div class="freelancer-detail-desc">
                    <h3>Descrizione</h3>
                    <p>${(job.descrizione_testo || 'Nessuna descrizione').replace(/\n/g, '<br>')}</p>
                </div>
                <div class="freelancer-detail-attachments">
                    <h3>Allegati</h3>
                    ${allegatiHtml}
                </div>
                <div class="freelancer-detail-approvals">
                    <h3>Approvazioni</h3>
                    ${approvazioniHtml}
                </div>
                <div class="form-actions" style="margin-top:20px;">
                    <button class="btn btn-danger" onclick="deleteFreelancerJob(${id})">Elimina Progetto</button>
                </div>
            </div>
        `;
    } catch (err) {
        showToast('Errore: ' + err.message, 'error');
    }
}

// Pubblica progetto su Freelancer.com
async function publishToFreelancer(jobId) {
    if (!confirm('Pubblicare questo progetto su Freelancer.com?')) return;
    const budget_min = document.getElementById(`freelancer-pub-min-${jobId}`)?.value || 100;
    try {
        const res = await fetch(`${API_URL}/freelancer/jobs/${jobId}/publish?key=${ADMIN_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ budget_min: Number(budget_min) })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast('Pubblicato su Freelancer.com!');
        openFreelancerJob(jobId);
    } catch (err) {
        showToast('Errore: ' + err.message, 'error');
    }
}

// Carica proposte (bids) per un progetto
async function loadFreelancerBids(jobId) {
    const container = document.getElementById(`freelancer-bids-${jobId}`);
    if (!container) return;
    container.innerHTML = '<p class="loading">Caricamento proposte...</p>';
    try {
        const res = await fetch(`${API_URL}/freelancer/jobs/${jobId}/bids?key=${ADMIN_KEY}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (data.bids.length === 0) {
            container.innerHTML = '<p style="color:#6b7280;padding:16px;">Nessuna proposta ricevuta ancora.</p>';
            return;
        }

        container.innerHTML = `
            <div class="freelancer-bids-section">
                <h3>Proposte ricevute (${data.total})</h3>
                ${data.bids.map(b => `
                    <div class="freelancer-bid-card">
                        <div class="freelancer-bid-header">
                            <strong>${b.freelancer_name}</strong>
                            <span class="freelancer-modulo-tag">${b.freelancer_username}</span>
                            <span style="color:#f59e0b;font-weight:700;">\u2605 ${b.reputation.toFixed(1)}</span>
                            <span style="color:#6b7280;">(${b.reviews_count} recensioni)</span>
                        </div>
                        <p class="freelancer-bid-amount">\u20ac${Number(b.amount).toLocaleString('it')} &mdash; ${b.period} giorni</p>
                        <p class="freelancer-bid-desc">${(b.description || '').substring(0, 300)}${(b.description || '').length > 300 ? '...' : ''}</p>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<p style="color:#dc2626;">Errore: ${err.message}</p>`;
    }
}

async function deleteFreelancerJob(id) {
    if (!confirm('Eliminare questo progetto e tutti i suoi allegati?')) return;
    try {
        const res = await fetch(`${API_URL}/freelancer/jobs/${id}?key=${ADMIN_KEY}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Errore eliminazione');
        showToast('Progetto eliminato');
        loadFreelancerJobs();
    } catch (err) {
        showToast('Errore: ' + err.message, 'error');
    }
}

async function deleteFreelancerAttachment(jobId, attachmentId) {
    if (!confirm('Rimuovere questo allegato?')) return;
    try {
        const res = await fetch(`${API_URL}/freelancer/jobs/${jobId}/attachments/${attachmentId}?key=${ADMIN_KEY}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Errore eliminazione');
        showToast('Allegato rimosso');
        openFreelancerJob(jobId);
    } catch (err) {
        showToast('Errore: ' + err.message, 'error');
    }
}

// Formatta dettagli Job Composer in modo leggibile
function formatJobComposerDetails(dettagli) {
    if (!dettagli) return '';

    const skillNames = {
        676: 'Video Production',
        390: 'Video Editing',
        12: 'Graphic Design',
        51: 'Logo Design',
        132: 'Voice Talent',
        389: 'Audio Production',
        13: 'Photoshop',
        14: 'Illustrator',
        145: 'Animation',
        146: '3D Modelling',
        66: 'Copywriting',
        17: 'Translation',
        3: 'PHP',
        7: 'Python',
        9: 'Javascript',
        82: 'Mobile App Development'
    };

    const skillBadges = (dettagli.skill_ids || []).map(id => {
        const name = skillNames[id] || `ID ${id}`;
        return `<span style="display:inline-block;background:#7c3aed;color:#fff;padding:4px 10px;border-radius:12px;margin:2px 4px;font-size:0.85rem;font-weight:600">${name}</span>`;
    }).join('');

    return `
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-top:12px;">
            <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #e5e7eb;">
                <div style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">📝 Titolo Ottimizzato</div>
                <div style="font-size:1.05rem;font-weight:600;color:#111827;">${escapeHtml(dettagli.titolo_ottimizzato || '')}</div>
            </div>

            <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #e5e7eb;">
                <div style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">📄 Descrizione Ottimizzata</div>
                <div style="font-size:0.9rem;color:#374151;line-height:1.6;white-space:pre-wrap;">${escapeHtml(dettagli.descrizione_ottimizzata || '')}</div>
            </div>

            <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #e5e7eb;">
                <div style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">🎯 Skill Richieste</div>
                <div>${skillBadges || '<span style="color:#9ca3af;">Nessuna skill specificata</span>'}</div>
            </div>

            <div style="display:flex;gap:20px;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #e5e7eb;flex-wrap:wrap;">
                <div style="flex:1;min-width:150px;">
                    <div style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">💰 Budget Suggerito</div>
                    <div style="font-size:1.15rem;font-weight:700;color:#059669;">€${dettagli.budget_minimo_suggerito || 0} - €${dettagli.budget_massimo_suggerito || 0}</div>
                </div>
                <div style="flex:1;min-width:150px;">
                    <div style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">⏱️ Durata Suggerita</div>
                    <div style="font-size:1.15rem;font-weight:700;color:#f59e0b;">${dettagli.durata_giorni_suggerita || 0} giorni</div>
                </div>
            </div>

            <div style="background:#fff;padding:12px;border-radius:6px;border-left:4px solid #7c3aed;">
                <div style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">💡 Motivazione</div>
                <div style="font-size:0.9rem;color:#374151;line-height:1.6;font-style:italic;">${escapeHtml(dettagli.motivazione || '')}</div>
            </div>
        </div>
    `;
}

// Formatta dettagli Talent Scout in modo leggibile
function formatTalentScoutDetails(dettagli) {
    if (!dettagli || !dettagli.top_3) return '';

    const candidatesHtml = dettagli.top_3.map((c, idx) => {
        const medalColors = ['#ffd700', '#c0c0c0', '#cd7f32']; // Oro, Argento, Bronzo
        const medalEmoji = ['🥇', '🥈', '🥉'];

        const proList = (c.pro || []).map(p => `<li style="color:#059669;margin:4px 0;">✓ ${escapeHtml(p)}</li>`).join('');
        const controList = (c.contro || []).map(p => `<li style="color:#dc2626;margin:4px 0;">⚠ ${escapeHtml(p)}</li>`).join('');

        const raccomandazioneColors = {
            'Fortemente raccomandato': '#059669',
            'Raccomandato': '#f59e0b',
            'Raccomandato con riserva': '#dc2626'
        };
        const raccomandazioneColor = raccomandazioneColors[c.raccomandazione] || '#6b7280';

        return `
            <div style="background:#fff;border:2px solid ${medalColors[idx]};border-radius:12px;padding:20px;margin-bottom:16px;position:relative;">
                <div style="position:absolute;top:12px;right:12px;font-size:2rem;">${medalEmoji[idx]}</div>

                <div style="margin-bottom:12px;padding-bottom:12px;border-bottom:2px solid #e5e7eb;">
                    <div style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Candidato #${c.ranking}</div>
                    <div style="font-size:1.2rem;font-weight:700;color:#111827;margin-bottom:4px;">@${escapeHtml(c.username || 'N/A')}</div>
                    <div style="display:flex;align-items:center;gap:12px;margin-top:8px;">
                        <span style="background:${medalColors[idx]};color:#000;padding:6px 14px;border-radius:20px;font-weight:700;font-size:0.95rem;">Score: ${c.punteggio_totale}/100</span>
                        <span style="background:${raccomandazioneColor};color:#fff;padding:6px 14px;border-radius:20px;font-weight:600;font-size:0.85rem;">${escapeHtml(c.raccomandazione || 'N/A')}</span>
                    </div>
                </div>

                <div style="margin-bottom:16px;">
                    <div style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">💡 Motivazione</div>
                    <div style="font-size:0.95rem;color:#374151;line-height:1.6;font-style:italic;">${escapeHtml(c.motivazione || 'N/A')}</div>
                </div>

                <div style="display:flex;gap:16px;margin-bottom:12px;flex-wrap:wrap;">
                    <div style="flex:1;min-width:200px;">
                        <div style="font-size:0.75rem;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">✓ Punti di forza</div>
                        <ul style="margin:0;padding-left:20px;list-style:none;">${proList || '<li style="color:#9ca3af;">Nessuno</li>'}</ul>
                    </div>
                    <div style="flex:1;min-width:200px;">
                        <div style="font-size:0.75rem;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">⚠ Punti di attenzione</div>
                        <ul style="margin:0;padding-left:20px;list-style:none;">${controList || '<li style="color:#9ca3af;">Nessuno</li>'}</ul>
                    </div>
                </div>

                <div style="text-align:center;margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;">
                    <span style="font-size:0.8rem;color:#6b7280;">Freelancer ID: ${c.bidder_id}</span>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-top:12px;">
            <div style="background:#7c3aed;color:#fff;padding:12px 16px;border-radius:8px;margin-bottom:16px;text-align:center;">
                <div style="font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">🔍 Talent Scout</div>
                <div style="font-size:1.1rem;font-weight:600;">Top 3 Candidati Selezionati</div>
            </div>

            ${candidatesHtml}

            ${dettagli.riepilogo_generale ? `
                <div style="background:#fff;padding:16px;border-radius:8px;border-left:4px solid #7c3aed;margin-top:16px;">
                    <div style="font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">📊 Riepilogo Generale</div>
                    <div style="font-size:0.95rem;color:#374151;line-height:1.6;">${escapeHtml(dettagli.riepilogo_generale)}</div>
                </div>
            ` : ''}
        </div>
    `;
}

// Approvazioni
async function loadFreelancerApprovals() {
    const container = document.getElementById('freelancer-approvals-list');
    try {
        const res = await fetch(`${API_URL}/freelancer/approvals?key=${ADMIN_KEY}`);
        if (!res.ok) throw new Error('Errore caricamento');
        const approvals = await res.json();

        // Badge
        const badge = document.getElementById('freelancer-badge');
        const countBadge = document.getElementById('freelancer-approvals-count');
        if (approvals.length > 0) {
            badge.textContent = approvals.length;
            badge.style.display = 'inline';
            countBadge.textContent = approvals.length;
            countBadge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
            countBadge.style.display = 'none';
        }

        if (approvals.length === 0) {
            container.innerHTML = '<p style="color:#6b7280;text-align:center;padding:40px;">Nessuna approvazione in attesa.</p>';
            return;
        }

        container.innerHTML = approvals.map(a => `
            <div class="freelancer-approval-card">
                <div class="freelancer-approval-header">
                    <span class="freelancer-modulo-tag">${a.modulo.replace('_', ' ')}</span>
                    <span style="color:#6b7280;font-size:0.85rem;">${a.job_titolo}</span>
                </div>
                <p class="freelancer-approval-action">${a.azione}</p>
                ${a.dettagli && Object.keys(a.dettagli).length > 0 ? (
                    a.modulo === 'job_composer' ? formatJobComposerDetails(a.dettagli) :
                    a.modulo === 'talent_scout' ? formatTalentScoutDetails(a.dettagli) :
                    `<pre class="freelancer-approval-details">${JSON.stringify(a.dettagli, null, 2)}</pre>`
                ) : ''}
                <div class="form-group" style="margin-top:8px;">
                    <input type="text" id="freelancer-nota-${a.id}" placeholder="Nota (opzionale)">
                </div>
                <div class="form-actions">
                    <button class="btn btn-primary" onclick="decideFreelancerApproval(${a.id}, 'approved')">Approva</button>
                    <button class="btn btn-danger" onclick="decideFreelancerApproval(${a.id}, 'rejected')">Rifiuta</button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = `<p style="color:#dc2626;">Errore: ${err.message}</p>`;
    }
}

async function decideFreelancerApproval(id, stato) {
    const nota = document.getElementById(`freelancer-nota-${id}`)?.value || '';
    try {
        const res = await fetch(`${API_URL}/freelancer/approvals/${id}/decide?key=${ADMIN_KEY}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stato, risposta_imprenditore: nota })
        });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast(stato === 'approved' ? 'Approvato' : 'Rifiutato');
        loadFreelancerApprovals();
    } catch (err) {
        showToast('Errore: ' + err.message, 'error');
    }
}

// Carica conteggio approvazioni al load
(async function initFreelancerBadge() {
    try {
        const res = await fetch(`${API_URL}/freelancer/approvals?key=${ADMIN_KEY}`);
        if (res.ok) {
            const approvals = await res.json();
            const badge = document.getElementById('freelancer-badge');
            if (approvals.length > 0) {
                badge.textContent = approvals.length;
                badge.style.display = 'inline';
            }
        }
    } catch (_) {}
})();

// ==================== OPPORTUNITÀ (CALENDLY) ====================

async function loadOpportunita() {
    const container = document.getElementById('opportunita-list');
    const badge = document.getElementById('opportunita-badge');
    const showArchive = document.getElementById('opportunita-show-archive')?.checked || false;

    container.innerHTML = '<p class="loading">Caricamento...</p>';

    try {
        const res = await fetch(`${API_URL}/opportunita?key=${ADMIN_KEY}`);
        if (!res.ok) throw new Error('Errore caricamento');
        const allOpportunita = await res.json();

        // Filter based on archive toggle
        const opportunita = showArchive
            ? allOpportunita.filter(o => o.status === 'completed')
            : allOpportunita.filter(o => o.status === 'pending');

        // Update badge count for pending opportunities (only non-assigned)
        const pending = allOpportunita.filter(o => o.status === 'pending' && !o.assegnato_a);
        if (pending.length > 0) {
            badge.textContent = pending.length;
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
        }

        if (opportunita.length === 0) {
            const msg = showArchive ? 'Nessuna opportunità completata.' : 'Nessuna opportunità pending.';
            container.innerHTML = `<p style="color:#6b7280;text-align:center;padding:40px;">${msg}</p>`;
            return;
        }

        // Render opportunity cards with assignment UI
        container.innerHTML = opportunita.map(opp => {
            const dataChiamata = new Date(opp.data_chiamata).toLocaleString('it-IT', {
                timeZone: 'Europe/Rome',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            // Badge assegnazione / completamento
            let statusBadge;
            if (opp.status === 'completed') {
                const completedAt = opp.completed_at
                    ? new Date(opp.completed_at).toLocaleDateString('it-IT')
                    : 'N/A';
                statusBadge = `<span class="badge badge-stato completato" style="background:#22c55e;color:#fff">✓ COMPLETATO ${completedAt}</span>`;
            } else if (opp.assegnato_a) {
                statusBadge = `<span class="badge badge-stato completato" style="background:#7dd3c0;color:#0a1f2e">Assegnato a: ${opp.assegnato_a}</span>`;
            } else {
                statusBadge = '<span class="badge badge-stato da_fare" style="background:#6b7280;color:#fff">Admin</span>';
            }

            const borderColor = opp.status === 'completed' ? '#22c55e' : '#7dd3c0';

            return `
                <div class="task-card" style="border-left:4px solid ${borderColor}">
                    <div class="task-header" style="align-items:flex-start">
                        <div>
                            <span class="task-title" style="font-size:1.1rem">${escapeHtml(opp.nome_cliente)}</span>
                            <div style="margin-top:4px">${statusBadge}</div>
                        </div>
                    </div>
                    <div class="task-meta" style="margin-top:12px;flex-direction:column;align-items:flex-start;gap:8px">
                        <div style="display:flex;align-items:center;gap:8px">
                            <span style="font-weight:600">📧</span>
                            <span>${escapeHtml(opp.email_cliente)}</span>
                        </div>
                        ${opp.telefono_cliente ? `
                        <div style="display:flex;align-items:center;gap:8px">
                            <span style="font-weight:600">📞</span>
                            <span>${escapeHtml(opp.telefono_cliente)}</span>
                        </div>
                        ` : ''}
                        <div style="display:flex;align-items:center;gap:8px">
                            <span style="font-weight:600">📅</span>
                            <span>${dataChiamata}</span>
                        </div>
                        ${opp.event_type ? `
                        <div style="display:flex;align-items:center;gap:8px">
                            <span style="font-weight:600">🎯</span>
                            <span>${escapeHtml(opp.event_type)}</span>
                        </div>
                        ` : ''}
                        ${opp.note ? `
                        <div style="margin-top:8px;padding:10px;background:#f9fafb;border-radius:6px;border-left:3px solid #7dd3c0">
                            <strong style="font-size:0.9rem;color:#6b7280">📝 Note:</strong>
                            <p style="margin:4px 0 0 0;font-size:0.9rem;color:#374151;white-space:pre-wrap">${escapeHtml(opp.note)}</p>
                        </div>
                        ` : ''}
                    </div>
                    ${opp.status === 'pending' ? `
                    <div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb">
                        <div style="display:flex;gap:12px;align-items:flex-end">
                            <div style="flex:1">
                                <label style="display:block;margin-bottom:6px;font-size:0.9rem;font-weight:600;color:#374151">Assegna a:</label>
                                <select class="opportunita-assign" data-id="${opp.id}" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:0.95rem">
                                    <option value="" ${!opp.assegnato_a ? 'selected' : ''}>Admin</option>
                                    <option value="Kim" ${opp.assegnato_a === 'Kim' ? 'selected' : ''}>Kim</option>
                                    <option value="Massimo" ${opp.assegnato_a === 'Massimo' ? 'selected' : ''}>Massimo</option>
                                </select>
                            </div>
                            <button class="btn btn-primary btn-small opportunita-complete" data-id="${opp.id}">✓ Fatto</button>
                        </div>
                    </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        // Add event listeners for assignment changes
        container.querySelectorAll('.opportunita-assign').forEach(select => {
            select.addEventListener('change', async (e) => {
                const id = e.target.dataset.id;
                const assegnato_a = e.target.value || null;
                await assignOpportunita(id, assegnato_a);
            });
        });

        // Add event listeners for complete buttons
        container.querySelectorAll('.opportunita-complete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.dataset.id;
                if (confirm('Marcare questa opportunità come completata?')) {
                    await completeOpportunita(id);
                }
            });
        });

    } catch (err) {
        container.innerHTML = `<p style="color:#dc2626;padding:20px;">Errore: ${err.message}</p>`;
    }
}

async function assignOpportunita(id, assegnato_a) {
    try {
        const res = await fetch(`${API_URL}/opportunita/${id}/assign?key=${ADMIN_KEY}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assegnato_a })
        });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast(`Opportunità assegnata a ${assegnato_a || 'Admin'}`);
        loadOpportunita(); // Reload to update UI
    } catch (err) {
        showToast('Errore: ' + err.message, 'error');
    }
}

async function completeOpportunita(id) {
    try {
        const res = await fetch(`${API_URL}/opportunita/${id}/complete?key=${ADMIN_KEY}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast('Opportunità completata!');
        loadOpportunita(); // Reload to update UI
    } catch (err) {
        showToast('Errore: ' + err.message, 'error');
    }
}

// Carica opportunità assegnate a un agente specifico (Kim o Massimo)
async function loadOpportunitaAgente(agente) {
    const container = document.getElementById(`opportunita-${agente.toLowerCase()}-list`);
    if (!container) return;

    container.innerHTML = '<p class="loading">Caricamento...</p>';

    try {
        const res = await fetch(`${API_URL}/opportunita/agente/${agente}?key=${ADMIN_KEY}`);
        if (!res.ok) throw new Error('Errore caricamento');
        const opportunita = await res.json();

        if (opportunita.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Nessuna opportunità assegnata</p></div>';
            return;
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
        container.innerHTML = `<div class="empty-state"><p style="color:#dc2626;">Errore: ${err.message}</p></div>`;
    }
}

// Refresh button event listener
document.getElementById('btnRefreshOpportunita')?.addEventListener('click', loadOpportunita);

// Archive toggle event listener
document.getElementById('opportunita-show-archive')?.addEventListener('change', loadOpportunita);

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
