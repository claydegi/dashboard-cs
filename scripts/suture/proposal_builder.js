/**
 * SUTURE · PROPOSAL BUILDER — Modulo 2/5 agente SUTURE (lato vendita)
 *
 * Costruisce, valida e persiste le proposte di vendita suture sulle tabelle
 *   proposte · proposta_righe · proposta_eventi · portali_cliente
 * create nel sub-task 1.1.
 *
 * Responsabilita':
 *   - Validazione regole di business (brief sez. 9):
 *     · sconto massimo 20% (oltre serve approvazione admin)
 *     · omaggio 3+1: valido SOLO se qty totale >= 3 (decade sotto soglia)
 *     · prodotti aggiunti dal cliente = prezzo di listino (no sconto ereditato)
 *     · mittente 1:1 per rep (Kim=kagnello, Detto=mdetto, Admin=pool)
 *   - Creazione record proposta + righe in transazione
 *   - Creazione / riuso token portale_cliente (UUID permanente, un solo portale per cliente)
 *   - Calcolo totale live
 *   - Gestione stati (pending → confermata_cliente / confermata_manualmente / rifiutata / rimandata)
 *   - Log eventi su proposta_eventi (tracking audit)
 *
 * Funzioni esportate:
 *   - createProposta(data, pool)                    → crea proposta + righe + garantisce portale
 *   - updateProposta(id, patch, pool)
 *   - deleteProposta(id, pool)
 *   - rimandaProposta(id, pool)                     → rimandata_al = today + 30gg
 *   - riattivaProposta(id, pool)                    → cancella rimandata_al
 *   - confermaManualeProposta(id, payload, pool)    → canale_conferma + note + evento
 *   - validateProposta(data)                        → throws su violazioni regole business
 *   - getOrCreatePortale(cliente_id, pool)          → UUID token permanente per cliente
 *
 * Riferimento: SUTURE/BRIEF_IMPLEMENTAZIONE.md sez. 8-9 · SUTURE/PIANO_FASE1.md Blocco 2
 */

'use strict';

// TODO (Blocco 2): implementare validazione regole business
function validateProposta(data) {
    throw new Error('TODO: implementare in Blocco 2');
}

// TODO (Blocco 2): upsert portale cliente (UUID permanente, uno per cliente_id)
async function getOrCreatePortale(cliente_id, pool) {
    throw new Error('TODO: implementare in Blocco 2');
}

// TODO (Blocco 2): creazione proposta + righe + portale (transazionale)
async function createProposta(data, pool) {
    throw new Error('TODO: implementare in Blocco 2');
}

// TODO (Blocco 2)
async function updateProposta(id, patch, pool) {
    throw new Error('TODO: implementare in Blocco 2');
}

// TODO (Blocco 2)
async function deleteProposta(id, pool) {
    throw new Error('TODO: implementare in Blocco 2');
}

// TODO (Blocco 2)
async function rimandaProposta(id, pool) {
    throw new Error('TODO: implementare in Blocco 2');
}

// TODO (Blocco 2)
async function riattivaProposta(id, pool) {
    throw new Error('TODO: implementare in Blocco 2');
}

// TODO (Blocco 2)
async function confermaManualeProposta(id, payload, pool) {
    throw new Error('TODO: implementare in Blocco 2');
}

module.exports = {
    validateProposta,
    getOrCreatePortale,
    createProposta,
    updateProposta,
    deleteProposta,
    rimandaProposta,
    riattivaProposta,
    confermaManualeProposta,
};
