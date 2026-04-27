-- Cleanup registrazioni test webinar Arcara (tag _REC)
-- Eseguire su Railway database via psql o dashboard

BEGIN;

-- 1. Trova i contatti dalle registrazioni test
SELECT id, email, nome, cognome
FROM crm_contatti
WHERE id IN (
    SELECT contatto_id
    FROM crm_webinar_registrazioni
    WHERE webinar_tag = 'WEBINAR_ARCARA_ELEVATE_REC'
);

-- 2. Cancella score associati ai contatti test
DELETE FROM crm_score_manuali
WHERE contatto_id IN (
    SELECT contatto_id
    FROM crm_webinar_registrazioni
    WHERE webinar_tag = 'WEBINAR_ARCARA_ELEVATE_REC'
);

-- 3. Cancella prodotti associati ai contatti test
DELETE FROM crm_prodotti
WHERE contatto_id IN (
    SELECT contatto_id
    FROM crm_webinar_registrazioni
    WHERE webinar_tag = 'WEBINAR_ARCARA_ELEVATE_REC'
);

-- 4. Cancella le registrazioni test
DELETE FROM crm_webinar_registrazioni
WHERE webinar_tag = 'WEBINAR_ARCARA_ELEVATE_REC';

-- 5. Cancella i contatti test (solo se hanno ID negativi = creati dalla dashboard)
DELETE FROM crm_contatti
WHERE id IN (
    SELECT DISTINCT c.id
    FROM crm_contatti c
    LEFT JOIN crm_webinar_registrazioni wr ON c.id = wr.contatto_id
    WHERE c.id < 0
    AND wr.id IS NULL  -- Non hanno altre registrazioni
    AND c.email IN ('test.debug@example.com', 'test@example.com')
);

COMMIT;

-- Verifica finale
SELECT COUNT(*) as registrazioni_rimanenti
FROM crm_webinar_registrazioni
WHERE webinar_tag = 'WEBINAR_ARCARA_ELEVATE_REC';
