-- Roadmap #94: archiviazione verificabile prima della rimozione dei soli campi
-- QuickBooks legacy. Non cancella ordini e non modifica il loro stato/flow.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS shop_quote_legacy_archive (
    source_order_id   INTEGER PRIMARY KEY REFERENCES shop_orders(id) ON DELETE RESTRICT,
    legacy_payload    JSONB NOT NULL,
    payload_sha256    TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    archived_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $migration$
DECLARE
    has_invoice_id BOOLEAN;
    has_invoice_url BOOLEAN;
    invoice_id_expr TEXT;
    invoice_url_expr TEXT;
    legacy_predicate TEXT;
    source_count BIGINT;
    archived_count BIGINT;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema=current_schema()
           AND table_name='shop_orders' AND column_name='quickbooks_invoice_id'
    ) INTO has_invoice_id;
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema=current_schema()
           AND table_name='shop_orders' AND column_name='quickbooks_invoice_url'
    ) INTO has_invoice_url;

    IF NOT has_invoice_id AND NOT has_invoice_url THEN
        RETURN;
    END IF;

    invoice_id_expr := CASE WHEN has_invoice_id
        THEN 'quickbooks_invoice_id' ELSE 'NULL::text' END;
    invoice_url_expr := CASE WHEN has_invoice_url
        THEN 'quickbooks_invoice_url' ELSE 'NULL::text' END;
    legacy_predicate := format(
        '(flow = %L OR status IN (%L,%L) OR %s IS NOT NULL OR %s IS NOT NULL)',
        'customer_service', 'quote_pending', 'quote_invoiced',
        invoice_id_expr, invoice_url_expr
    );

    EXECUTE format('SELECT count(*) FROM shop_orders WHERE %s', legacy_predicate)
       INTO source_count;

    EXECUTE format($sql$
        WITH legacy AS (
            SELECT id,
                   jsonb_build_object(
                       'order_number', order_number,
                       'status', status,
                       'flow', flow,
                       'quickbooks_invoice_id', %s,
                       'quickbooks_invoice_url', %s,
                       'created_at', created_at
                   ) AS payload
              FROM shop_orders
             WHERE %s
        )
        INSERT INTO shop_quote_legacy_archive (
            source_order_id, legacy_payload, payload_sha256
        )
        SELECT id, payload,
               encode(digest(convert_to(payload::text, 'UTF8'), 'sha256'), 'hex')
          FROM legacy
        ON CONFLICT (source_order_id) DO UPDATE SET
            legacy_payload=EXCLUDED.legacy_payload,
            payload_sha256=EXCLUDED.payload_sha256,
            archived_at=NOW()
    $sql$, invoice_id_expr, invoice_url_expr, legacy_predicate);

    EXECUTE format(
        'SELECT count(*) FROM shop_quote_legacy_archive a '
        'JOIN shop_orders o ON o.id=a.source_order_id WHERE %s',
        legacy_predicate
    ) INTO archived_count;
    IF archived_count <> source_count THEN
        RAISE EXCEPTION 'F9 legacy archive incomplete: source %, archive %',
            source_count, archived_count;
    END IF;

    ALTER TABLE shop_orders DROP COLUMN IF EXISTS quickbooks_invoice_id;
    ALTER TABLE shop_orders DROP COLUMN IF EXISTS quickbooks_invoice_url;
END
$migration$;

COMMENT ON TABLE shop_quote_legacy_archive IS
    'Roadmap #94: payload QuickBooks/quote legacy archiviati con SHA-256 prima del drop delle colonne sorgente.';

COMMIT;
