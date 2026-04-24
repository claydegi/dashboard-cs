/**
 * SUTURE · REPORTING — Modulo 5/5 agente SUTURE (lato vendita)
 *
 * Metriche aggregate per il tab "Proposte" admin della Dashboard CS
 * (fase 3, fuori scope Fase 1 MVP).
 *
 * Responsabilita' (brief sez. 17 "Fase 3"):
 *   - Tasso di conversione % (proposte confermate / proposte inviate)
 *   - Valore generato (somma totali proposte confermate)
 *   - Clienti inattivi (senza interazione da N giorni)
 *   - Suddivisione per sales rep / canale (online vs customer_service vs manuale)
 *   - Alert (proposte rimandate scadute, portali revocati, conferme manuali stuck)
 *
 * Funzioni esportate (previste):
 *   - getAdminMetrics(filters, pool)               → oggetto con KPI principali
 *   - getPropostePerRep(pool)
 *   - getPropostePerCanale(pool)
 *   - getClientiInattivi(soglia_giorni, pool)
 *
 * Riferimento: SUTURE/BRIEF_IMPLEMENTAZIONE.md sez. 17 · SUTURE/PIANO_FASE1.md Fasi successive
 *
 * FUORI SCOPE Fase 1 MVP — stub in attesa di Fase 3.
 */

'use strict';

async function getAdminMetrics(filters, pool) {
    throw new Error('TODO: implementare in Fase 3');
}

module.exports = {
    getAdminMetrics,
};
