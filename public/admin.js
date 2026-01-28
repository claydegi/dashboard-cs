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

    // Navigazione sezioni
    document.querySelectorAll('.nav-link[data-section]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
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

    // Aggiorna nav
    document.querySelectorAll('.nav-link[data-section]').forEach(link => {
        link.classList.toggle('active', link.dataset.section === section);
    });

    // Mostra/nascondi sezioni
    document.getElementById('section-cs').style.display = section === 'cs' ? 'block' : 'none';
    document.getElementById('section-privati').style.display = section === 'privati' ? 'block' : 'none';

    // Aggiorna tipo nel form
    tipoSelect.value = section === 'cs' ? 'cs' : 'privato';
    assegnatoGroup.style.display = section === 'cs' ? 'block' : 'none';

    renderTasks();
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
