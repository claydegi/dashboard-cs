// Configurazione
const API_URL = window.location.origin + '/api';

// Stato
let tasks = [];
let operatorName = localStorage.getItem('operatorName') || '';

// Elementi DOM
const taskList = document.getElementById('taskList');
const operatorInput = document.getElementById('operatorName');
const filterStato = document.getElementById('filterStato');
const filterPriorita = document.getElementById('filterPriorita');
const commentModal = document.getElementById('commentModal');
const commentForm = document.getElementById('commentForm');
const completeModal = document.getElementById('completeModal');

// Inizializzazione
document.addEventListener('DOMContentLoaded', () => {
    operatorInput.value = operatorName;
    loadTasks();
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    // Salva nome operatore
    operatorInput.addEventListener('change', () => {
        operatorName = operatorInput.value;
        localStorage.setItem('operatorName', operatorName);
    });

    // Filtri
    filterStato.addEventListener('change', renderTasks);
    filterPriorita.addEventListener('change', renderTasks);

    // Modal commento
    document.querySelectorAll('.close').forEach(btn => {
        btn.addEventListener('click', closeModals);
    });
    commentForm.addEventListener('submit', handleAddComment);

    // Modal completamento
    document.getElementById('cancelComplete').addEventListener('click', closeModals);
    document.getElementById('confirmComplete').addEventListener('click', handleConfirmComplete);

    // Chiudi modal cliccando fuori
    [commentModal, completeModal].forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModals();
        });
    });

    // Auto-refresh ogni 30 secondi
    setInterval(loadTasks, 30000);
}

// Carica task
async function loadTasks() {
    try {
        const response = await fetch(`${API_URL}/tasks/cs`);
        if (!response.ok) throw new Error('Errore caricamento');
        tasks = await response.json();
        renderTasks();
        updateStats();
    } catch (error) {
        console.error('Errore:', error);
        taskList.innerHTML = '<div class="empty-state"><p>Errore nel caricamento dei task</p></div>';
    }
}

// Aggiorna statistiche
function updateStats() {
    const daFare = tasks.filter(t => t.stato === 'da_fare').length;
    const inCorso = tasks.filter(t => t.stato === 'in_corso').length;

    document.getElementById('statDaFare').textContent = daFare;
    document.getElementById('statInCorso').textContent = inCorso;

    // Per i completati oggi, dovremmo avere un endpoint separato
    // Per ora mostriamo 0
    document.getElementById('statCompletati').textContent = '0';
}

// Renderizza task
function renderTasks() {
    const statoFilter = filterStato.value;
    const prioritaFilter = filterPriorita.value;

    let filteredTasks = [...tasks];

    if (statoFilter) {
        filteredTasks = filteredTasks.filter(t => t.stato === statoFilter);
    }
    if (prioritaFilter) {
        filteredTasks = filteredTasks.filter(t => t.priorita === prioritaFilter);
    }

    if (filteredTasks.length === 0) {
        taskList.innerHTML = '<div class="empty-state"><p>Nessun task da visualizzare</p></div>';
        return;
    }

    taskList.innerHTML = filteredTasks.map(task => createTaskCard(task)).join('');

    // Aggiungi event listeners
    document.querySelectorAll('.btn-status').forEach(btn => {
        btn.addEventListener('click', () => handleStatusChange(parseInt(btn.dataset.id), btn.dataset.status));
    });

    document.querySelectorAll('.btn-complete').forEach(btn => {
        btn.addEventListener('click', () => openCompleteModal(parseInt(btn.dataset.id)));
    });

    document.querySelectorAll('.btn-comment').forEach(btn => {
        btn.addEventListener('click', () => openCommentModal(parseInt(btn.dataset.id)));
    });
}

// Crea card task
function createTaskCard(task) {
    const scadenzaFormatted = task.scadenza
        ? new Date(task.scadenza).toLocaleDateString('it-IT')
        : 'Non impostata';

    const isScaduto = task.scadenza && new Date(task.scadenza) < new Date();

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
                <span ${isScaduto ? 'style="color: var(--danger);"' : ''}>📅 Scadenza: ${scadenzaFormatted} ${isScaduto ? '(SCADUTO)' : ''}</span>
                ${task.assegnato_a ? `<span>👤 Assegnato a: ${escapeHtml(task.assegnato_a)}</span>` : ''}
                ${task.commenti && task.commenti.length > 0 ? `<span>💬 ${task.commenti.length} commenti</span>` : ''}
            </div>
            <div class="task-actions">
                ${task.stato === 'da_fare' ? `
                    <button class="btn btn-secondary btn-small btn-status" data-id="${task.id}" data-status="in_corso">
                        Inizia
                    </button>
                ` : ''}
                ${task.stato === 'in_corso' ? `
                    <button class="btn btn-secondary btn-small btn-status" data-id="${task.id}" data-status="da_fare">
                        Rimetti in attesa
                    </button>
                ` : ''}
                <button class="btn btn-success btn-small btn-complete" data-id="${task.id}">
                    Completa
                </button>
                <button class="btn btn-secondary btn-small btn-comment" data-id="${task.id}">
                    💬 Commenta
                </button>
            </div>
        </div>
    `;
}

// Cambia stato task
async function handleStatusChange(taskId, newStatus) {
    try {
        const response = await fetch(`${API_URL}/tasks/${taskId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stato: newStatus })
        });

        if (!response.ok) throw new Error('Errore aggiornamento');

        await loadTasks();
        showToast('Stato aggiornato', 'success');
    } catch (error) {
        console.error('Errore:', error);
        showToast('Errore nell\'aggiornamento', 'error');
    }
}

// Apri modal completamento
function openCompleteModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (!operatorName) {
        showToast('Inserisci il tuo nome prima di completare un task', 'error');
        operatorInput.focus();
        return;
    }

    document.getElementById('completeTaskId').value = taskId;
    document.getElementById('completeTaskTitle').textContent = task.titolo;
    completeModal.classList.add('show');
}

// Conferma completamento
async function handleConfirmComplete() {
    const taskId = document.getElementById('completeTaskId').value;

    try {
        const response = await fetch(`${API_URL}/tasks/${taskId}/complete`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completato_da: operatorName })
        });

        if (!response.ok) throw new Error('Errore completamento');

        closeModals();
        await loadTasks();
        showToast('Task completato! Notifica inviata agli admin.', 'success');
    } catch (error) {
        console.error('Errore:', error);
        showToast('Errore nel completamento', 'error');
    }
}

// Apri modal commento
function openCommentModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    document.getElementById('commentTaskId').value = taskId;
    document.getElementById('commentText').value = '';

    // Mostra commenti esistenti
    const commentsList = document.getElementById('commentsList');
    if (task.commenti && task.commenti.length > 0) {
        commentsList.innerHTML = `
            <h3>Commenti precedenti</h3>
            ${task.commenti.map(c => `
                <div class="comment">
                    <div class="comment-header">
                        <span class="comment-author">${escapeHtml(c.autore)}</span>
                        <span class="comment-date">${new Date(c.data).toLocaleString('it-IT')}</span>
                    </div>
                    <p class="comment-text">${escapeHtml(c.testo)}</p>
                </div>
            `).join('')}
        `;
    } else {
        commentsList.innerHTML = '';
    }

    commentModal.classList.add('show');
}

// Aggiungi commento
async function handleAddComment(e) {
    e.preventDefault();

    const taskId = document.getElementById('commentTaskId').value;
    const testo = document.getElementById('commentText').value;

    if (!operatorName) {
        showToast('Inserisci il tuo nome prima di commentare', 'error');
        operatorInput.focus();
        return;
    }

    try {
        const response = await fetch(`${API_URL}/tasks/${taskId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                testo,
                autore: operatorName
            })
        });

        if (!response.ok) throw new Error('Errore aggiunta commento');

        closeModals();
        await loadTasks();
        showToast('Commento aggiunto', 'success');
    } catch (error) {
        console.error('Errore:', error);
        showToast('Errore nell\'aggiunta del commento', 'error');
    }
}

// Chiudi modals
function closeModals() {
    commentModal.classList.remove('show');
    completeModal.classList.remove('show');
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
