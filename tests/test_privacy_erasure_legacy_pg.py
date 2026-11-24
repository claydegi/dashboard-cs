"""Actual SQL from the private Dashboard patch; dedicated loopback PG only."""
from pathlib import Path
import os,re
import pytest
SOURCE=Path(__file__).resolve().parents[1]/'server.js'

@pytest.fixture
def isolated_legacy_pg():
    dsn=os.environ.get('PRIVACY_ERASURE_TEST_DSN')
    if not dsn:pytest.skip('Dedicated PG absent; no runtime pass claimed')
    import psycopg2
    from psycopg2.extensions import parse_dsn
    cfg=parse_dsn(dsn)
    assert cfg.get('host') in {'127.0.0.1','localhost','::1'}
    assert cfg.get('dbname','').startswith('privacy_erasure_test_')
    conn=psycopg2.connect(dsn)
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")
        assert not cur.fetchall(),'Dedicated database must start empty'
        cur.execute('CREATE TABLE crm_contatti(id int PRIMARY KEY,email text,nome text,cognome text)')
        cur.execute('CREATE TABLE crm_score_manuali(id serial,contatto_id int,linea_prodotto text,tipo_attivita text,punti int,sincronizzata bool,data_evento date)')
        cur.execute('CREATE TABLE crm_score_prodotti(contatto_id int,linea_prodotto text,score int)')
        cur.execute('CREATE TABLE crm_modifiche_log(contatto_id int,tipo_modifica text,dettagli jsonb)')
        cur.execute('CREATE TABLE crm_video_tracking(contatto_id int,email text,campagna text,evento text,secondi_visti int,durata_totale int,percentuale int)')
        cur.execute('CREATE TABLE crm_webinar_registrazioni(id int,contatto_id int,email text,webinar_tag text)')
        cur.execute('CREATE TABLE crm_webinar_partecipanti(contatto_id int,durata_minuti int,webinar_tag text,score_assegnato bool)')
    conn.commit()
    try:yield conn
    finally:
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute('DROP SCHEMA public CASCADE;CREATE SCHEMA public')
        conn.commit();conn.close()

def execute_js_sql(cur,text,values):
    bound=[]
    def placeholder(m):bound.append(values[int(m[1])-1]);return '%s'
    query=re.sub(r'\$([1-9][0-9]*)',placeholder,text)
    cur.execute(query,bound)

def segment(source,start,end):return source[source.index(start):source.index(end,source.index(start))]

def test_pg_actual_startup_do_keeps_target_and_normal_control_correction(isolated_legacy_pg):
    conn=isolated_legacy_pg;s=SOURCE.read_text(encoding='utf8')
    query=re.search(r'DO \$\$\s+DECLARE\s+rec RECORD;[\s\S]*?END \$\$;',s)[0]
    with conn.cursor() as cur:
        for kid in [17,900]:
            cur.execute("INSERT INTO crm_score_manuali(contatto_id,linea_prodotto,tipo_attivita,punti,sincronizzata) VALUES(%s,'PT1','video_watch',400,true)",(kid,))
            cur.execute("INSERT INTO crm_score_prodotti VALUES(%s,'PT1',500)",(kid,))
            cur.execute("INSERT INTO crm_modifiche_log VALUES(%s,'add_score','{\"tipo_attivita\":\"video_watch\"}')",(kid,))
            cur.execute("INSERT INTO crm_video_tracking VALUES(%s,%s,'synthetic','progress',600,1200,50)",(kid,'target@example.test' if kid==17 else 'control@example.invalid'))
        cur.execute("SELECT set_config('app.privacy_blocked_crm_ids',%s,true)",('{17}',))
        cur.execute(query)
        cur.execute('SELECT contatto_id,score FROM crm_score_prodotti ORDER BY contatto_id');assert cur.fetchall()==[(17,500),(900,300)]
        cur.execute('SELECT contatto_id FROM crm_score_manuali');assert cur.fetchall()==[(17,)]
        cur.execute('SELECT contatto_id FROM crm_modifiche_log');assert cur.fetchall()==[(17,)]
        markers=re.search(r'const markerCandidates = await client.query\(`([\s\S]*?)`,',s)[1]
        execute_js_sql(cur,markers,[[17]])
        rows=cur.fetchall();assert len(rows)==1 and rows[0][0]==900
    conn.rollback()

def test_pg_actual_maintenance_statements_preserve_target_and_update_controls(isolated_legacy_pg):
    conn=isolated_legacy_pg;s=SOURCE.read_text(encoding='utf8')
    fix=segment(s,"app.put('/api/webinar/registrations/fix-contatto-id'",'// PUT /api/webinar/registrations/fix-action')
    update=re.search(r'`(\s*UPDATE crm_webinar_registrazioni r[\s\S]*?)`',fix)[1]
    reset=segment(s,"app.post('/api/webinar/reset-zoom-scores'",'// Landing page webinar')
    select_reset=re.search(r"'(SELECT contatto_id, durata_minuti[^']+)'",reset)[1]
    reset_update=re.search(r"'(UPDATE crm_webinar_partecipanti[^']+)'",reset)[1]
    camp=segment(s,"app.post('/api/video-tracking/fix-campagna'",'// GET video tracking data')
    delete_sm=re.search(r'`(DELETE FROM crm_score_manuali[^`]+)`',camp)[1]
    delete_vt=re.search(r'`(DELETE FROM crm_video_tracking[^`]+)`',camp)[1]
    select_camp=re.search(r'const maxPerContatto = await pool.query\(`([\s\S]*?)`',camp)[1]
    with conn.cursor() as cur:
        cur.execute("INSERT INTO crm_contatti VALUES(17,'target@example.test','Synthetic','Target'),(900,'control@example.invalid','Synthetic','Control')")
        cur.execute("INSERT INTO crm_webinar_registrazioni VALUES(1,NULL,'target@example.test','synthetic'),(2,NULL,'control@example.invalid','synthetic')")
        execute_js_sql(cur,update,['synthetic',[17]])
        cur.execute('SELECT id,contatto_id FROM crm_webinar_registrazioni ORDER BY id');assert cur.fetchall()==[(1,None),(2,900)]
        cur.execute("INSERT INTO crm_webinar_partecipanti VALUES(17,20,'synthetic',true),(900,20,'synthetic',true)")
        execute_js_sql(cur,select_reset,['synthetic',[17]]);assert cur.fetchall()==[(900,20)]
        execute_js_sql(cur,reset_update,['synthetic',[17]])
        cur.execute('SELECT contatto_id,score_assegnato FROM crm_webinar_partecipanti ORDER BY contatto_id NULLS LAST');assert cur.fetchall()==[(17,True),(None,False)]
        for kid in [17,900]:
            cur.execute("INSERT INTO crm_score_manuali(contatto_id,tipo_attivita,data_evento) VALUES(%s,'video_watch','2026-11-01')",(kid,))
            cur.execute("INSERT INTO crm_video_tracking VALUES(%s,'synthetic@example.invalid','synthetic','score_10min',600,1200,50),(%s,'synthetic@example.invalid','synthetic','progress',600,1200,50)",(kid,kid))
        execute_js_sql(cur,delete_sm,[[17]])
        execute_js_sql(cur,delete_vt,['synthetic',[17]])
        cur.execute('SELECT contatto_id FROM crm_score_manuali');assert cur.fetchall()==[(17,)]
        cur.execute("SELECT contatto_id FROM crm_video_tracking WHERE evento='score_10min'");assert cur.fetchall()==[(17,)]
        execute_js_sql(cur,select_camp,['synthetic',[17]]);assert [r[0] for r in cur.fetchall()]==[900]
    conn.rollback()
