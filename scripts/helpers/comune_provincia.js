/**
 * Lookup comune italiano -> sigla provincia (es. "Stradella" -> "PV").
 *
 * Usato dal Blocco 1 univocita' MyOSSEOTOUCH per riempire la provincia dei
 * partner Odoo che hanno la citta' ma non hanno `state_id` valorizzato in Odoo
 * (~87 partner su 275 al 2026-05-05).
 *
 * Fonte dati: matteocontrini/comuni-json (GitHub, 7904 comuni italiani con
 * sigla provincia, codice ISTAT, regione, CAP). Aggiornata 2026-05-05.
 *
 * Match: case-insensitive, senza diacritici, apostrofi unificati.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const COMUNI_PATH = path.join(__dirname, '..', '..', 'data', 'comuni_italiani.json');

let _index = null;

/**
 * Normalizza una stringa di citta' per il lookup:
 * lowercase, NFD strip diacritics, apostrofi unificati, whitespace collapse, trim.
 */
function normalize(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[‘’ʼ]/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Costruisce l'indice citta'_normalizzata -> { sigla, provincia, regione } UNA volta.
 * Quando ci sono omonimi (es. "Castelnuovo" in piu' province), tiene il primo.
 */
function buildIndex() {
    if (_index) return _index;
    const raw = fs.readFileSync(COMUNI_PATH, 'utf8');
    const data = JSON.parse(raw);
    _index = new Map();
    for (const c of data) {
        const key = normalize(c.nome);
        if (key && !_index.has(key)) {
            _index.set(key, {
                sigla: c.sigla || null,
                provincia_nome: (c.provincia && c.provincia.nome) || null,
                regione_nome: (c.regione && c.regione.nome) || null,
            });
        }
    }
    return _index;
}

/**
 * Lookup citta' -> sigla provincia (es. "Stradella" -> "PV", "stradella  " -> "PV").
 * Ritorna null se non trovato.
 */
function lookupSigla(citta) {
    if (!citta) return null;
    const idx = buildIndex();
    const hit = idx.get(normalize(citta));
    return hit ? hit.sigla : null;
}

/**
 * Lookup citta' -> stringa "Provincia (SIGLA)" (es. "Stradella" -> "Pavia (PV)").
 * Coerente col formato Odoo state_id name (es. "Varese (IT)" — Odoo usa "(IT)" ma
 * il nostro formato umano e' la sigla provincia).
 */
function lookupProvinciaLabel(citta) {
    if (!citta) return null;
    const idx = buildIndex();
    const hit = idx.get(normalize(citta));
    if (!hit) return null;
    if (hit.provincia_nome && hit.sigla) return `${hit.provincia_nome} (${hit.sigla})`;
    return hit.provincia_nome || hit.sigla || null;
}

/**
 * Diagnostica: dimensione indice + campione.
 */
function getStats() {
    const idx = buildIndex();
    return { totale_comuni: idx.size };
}

module.exports = {
    normalize,
    lookupSigla,
    lookupProvinciaLabel,
    getStats,
};
