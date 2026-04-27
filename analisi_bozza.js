const https = require('https');

const API_URL = 'https://dashboard-cs-production.up.railway.app/api/suture/ordine';
const ADMIN_KEY = process.env.ADMIN_KEY || '<ADMIN_KEY_STORICA_RIMOSSA>';

https.get(`${API_URL}?key=${ADMIN_KEY}`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);

            console.log('========================================');
            console.log('ANALISI PO DRAFT IN BOZZA');
            console.log('========================================\n');

            const inBozza = json.in_bozza || [];

            if (inBozza.length === 0) {
                console.log('Nessun PO draft in bozza');
                return;
            }

            console.log(`Totale righe in bozza: ${inBozza.length}\n`);
            console.log('Legenda:');
            console.log('- BEST OF: prodotti che devono sempre avere 5 pz disponibili');
            console.log('- Disponibile = Giacenza - Impegnato + In Arrivo');
            console.log('- Per Best Of: se Disponibile < 5, la bozza serve per ripristinare');
            console.log('- Per altri: se Disponibile < 0, la bozza serve per coprire ordini\n');

            // Ora devo ottenere i dati stock per ogni prodotto in bozza
            // L'API /ordine non mi dà questi dati, devo usare l'endpoint verifica-copertura

            console.log('PRODOTTI IN BOZZA:\n');
            inBozza.forEach(item => {
                console.log(`${item.codice}${item.best_of ? ' [BEST OF]' : ''}`);
                console.log(`  Quantità in bozza: ${item.quantita} pz`);
                console.log(`  Valore: €${item.valore}`);
                console.log('');
            });

            console.log('\n⚠️  Per l\'analisi completa serve interrogare lo stock...');
            console.log('Chiamo endpoint /verifica-copertura...\n');

            // Seconda chiamata per ottenere i dati stock
            https.get(`https://dashboard-cs-production.up.railway.app/api/suture/verifica-copertura?key=${ADMIN_KEY}`, (res2) => {
                let data2 = '';
                res2.on('data', chunk => data2 += chunk);
                res2.on('end', () => {
                    try {
                        const stockJson = JSON.parse(data2);

                        // Mappa i codici in bozza con i loro dati stock
                        const codiciInBozza = inBozza.map(b => b.codice);

                        // Devo interrogare il catalogo per avere tutti i dati
                        https.get(`https://dashboard-cs-production.up.railway.app/api/suture/catalogo?key=${ADMIN_KEY}`, (res3) => {
                            let data3 = '';
                            res3.on('data', chunk => data3 += chunk);
                            res3.on('end', () => {
                                try {
                                    const catalogoJson = JSON.parse(data3);
                                    const catalogoMap = {};
                                    catalogoJson.items.forEach(item => {
                                        catalogoMap[item.codice] = {
                                            best_of: item.best_of,
                                            descrizione: item.descrizione
                                        };
                                    });

                                    console.log('========================================');
                                    console.log('ANALISI DETTAGLIATA BOZZA');
                                    console.log('========================================\n');

                                    let perBestOf = 0;
                                    let perOrdini = 0;
                                    let nonNecessario = 0;

                                    inBozza.forEach(item => {
                                        const cat = catalogoMap[item.codice];
                                        if (!cat) return;

                                        console.log(`\n${item.codice} - ${cat.descrizione}`);
                                        console.log(`  Best Of: ${cat.best_of ? 'SÌ' : 'NO'}`);
                                        console.log(`  In bozza: ${item.quantita} pz`);

                                        // Cerco nei dati stock (coperti o scoperti)
                                        let stockInfo = null;
                                        if (stockJson.scoperti) {
                                            stockInfo = stockJson.scoperti.find(s => s.codice === item.codice);
                                        }
                                        if (!stockInfo && stockJson.coperti) {
                                            stockInfo = stockJson.coperti.find(s => s.codice === item.codice);
                                        }

                                        if (stockInfo) {
                                            const disponibile = stockInfo.giacenza - stockInfo.impegnato + stockInfo.in_arrivo;
                                            console.log(`  Giacenza: ${stockInfo.giacenza}`);
                                            console.log(`  Impegnato: ${stockInfo.impegnato}`);
                                            console.log(`  In arrivo: ${stockInfo.in_arrivo}`);
                                            console.log(`  Disponibile (senza bozza): ${disponibile}`);

                                            if (cat.best_of) {
                                                const mancante = Math.max(0, 5 - disponibile);
                                                console.log(`  Target Best Of: 5 pz`);
                                                console.log(`  Mancante per Best Of: ${mancante} pz`);

                                                if (mancante > 0) {
                                                    console.log(`  → La bozza serve per RIPRISTINARE BEST OF (serve ${mancante} pz)`);
                                                    if (item.quantita > mancante) {
                                                        console.log(`    ⚠️  In bozza ci sono ${item.quantita - mancante} pz in eccesso`);
                                                    }
                                                    perBestOf++;
                                                } else {
                                                    console.log(`  → La bozza NON è necessaria (già sopra soglia Best Of)`);
                                                    nonNecessario++;
                                                }
                                            } else {
                                                if (disponibile < 0) {
                                                    console.log(`  → La bozza serve per COPRIRE ORDINI (manca ${Math.abs(disponibile)} pz)`);
                                                    perOrdini++;
                                                } else {
                                                    console.log(`  → La bozza NON è necessaria (ordini già coperti)`);
                                                    nonNecessario++;
                                                }
                                            }
                                        } else {
                                            console.log('  ⚠️  Dati stock non trovati (prodotto senza ordini pendenti)');
                                            if (cat.best_of) {
                                                console.log('  → Probabilmente per RIPRISTINARE BEST OF');
                                                perBestOf++;
                                            }
                                        }
                                    });

                                    console.log('\n========================================');
                                    console.log('RIEPILOGO BOZZA');
                                    console.log('========================================\n');
                                    console.log(`Righe per ripristinare Best Of: ${perBestOf}`);
                                    console.log(`Righe per coprire ordini: ${perOrdini}`);
                                    console.log(`Righe non necessarie: ${nonNecessario}`);
                                    console.log(`Totale righe: ${inBozza.length}`);

                                    if (perOrdini > 0) {
                                        console.log('\n⚠️  ATTENZIONE: Ci sono righe in bozza per coprire ordini!');
                                    } else {
                                        console.log('\n✓ La bozza serve solo per ripristinare il Best Of');
                                    }

                                } catch (e) {
                                    console.error('Errore parsing catalogo:', e.message);
                                }
                            });
                        }).on('error', (e) => console.error('Errore HTTP catalogo:', e.message));

                    } catch (e) {
                        console.error('Errore parsing verifica:', e.message);
                    }
                });
            }).on('error', (e) => console.error('Errore HTTP verifica:', e.message));

        } catch (e) {
            console.error('Errore parsing JSON:', e.message);
        }
    });
}).on('error', (e) => console.error('Errore HTTP:', e.message));
