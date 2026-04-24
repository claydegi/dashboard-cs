/**
 * SUTURE · SCHEDULER — Modulo 4/5 agente SUTURE (lato vendita)
 *
 * Cron giornaliero (fase 2, fuori scope Fase 1 MVP) per la rigenerazione
 * automatica delle proposte basata su cadenza_gg e rimandata_al.
 *
 * Responsabilita' (brief sez. 10 "Scheduler" + sez. 17 "Fase 2"):
 *   - Giornaliero 20:00: per ogni proposta con rimandata_al = today oppure scaduta per cadenza,
 *     genera una proposta pre-compilata IDENTICA all'originale (stessi prodotti/qty/prezzi/sconti/omaggi)
 *   - La nuova proposta parte in stato "pending pre-compilata" nel tab del rep di riferimento
 *   - **Non invia mai automaticamente**: il rep la rivede, eventualmente modifica, poi conferma → trigger invio
 *   - Badge "OGGI inviare reminder" se modalita = manuale
 *   - Per account con flag suture=true: generazione proattiva basata su storico Odoo
 *
 * Funzioni esportate (previste):
 *   - runDailyScheduler(pool)                      → entry point cron
 *   - findScadutePerCadenza(pool)
 *   - findProposteRimandateOggi(pool)
 *   - rigeneraPropostaPreCompilata(sourceProposta, pool)
 *
 * Riferimento: SUTURE/BRIEF_IMPLEMENTAZIONE.md sez. 10+17 · SUTURE/PIANO_FASE1.md Fasi successive
 *
 * FUORI SCOPE Fase 1 MVP — stub in attesa di Fase 2.
 */

'use strict';

async function runDailyScheduler(pool) {
    throw new Error('TODO: implementare in Fase 2');
}

module.exports = {
    runDailyScheduler,
};
