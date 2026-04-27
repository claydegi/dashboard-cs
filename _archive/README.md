# Dashboard CS — `_archive/`

Cartella di archivio per script diagnostici **one-shot** prodotti tra
marzo e aprile 2026 durante lavorazioni specifiche (debug suture, debug
webinar Arcara/Galizia/Malavasi).

## Caratteristiche dei file qui contenuti

- **NON sono runtime** — il server (`server.js`) non li importa né li esegue.
- **Sono diagnostiche operative concluse** — non hanno valore al di fuori
  del contesto storico in cui sono stati creati.
- **Sono mantenuti solo per memoria** — possono servire come riferimento
  per debug futuri analoghi o come traccia di metodologie applicate.

## Struttura

```
_archive/
├── diagnostica_suture/    # 8 script (marzo-aprile 2026)
│                          # Diagnostica copertura ordini, PO bozza,
│                          # PO VITREX, ordine S00343, ecc.
└── diagnostica_webinar/   # 8 script (marzo-aprile 2026)
                           # Debug bug Arcara watchtime, Galizia video,
                           # Malavasi fix, cleanup test ambiente.
```

## Coerenza con la documentazione

I file qui dentro corrispondono a quelli citati come "candidati a
rimozione/archiviazione previa autorizzazione esplicita" in
`README.md` Appendice A. L'archiviazione è stata autorizzata
nel Filone 4 (2026-04-27).

## Cosa NON fare

- Non importare questi script da `server.js`.
- Non rilanciarli automaticamente: erano pensati per esecuzione manuale
  contro la Dashboard CS in produzione, durante il debug specifico.
- Non considerarli aggiornati: usano fallback e pattern coerenti con
  lo stato del codice all'epoca della loro creazione.

## Cosa SÌ fare

- Consultare come riferimento se serve replicare un'analisi simile.
- Estrarre pattern/query SQL utili copiandoli in nuovi script ad-hoc.
- Cancellare in futuro se si decide che non c'è più valore storico.
