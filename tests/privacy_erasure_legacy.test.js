'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const p=require('../scripts/privacy_erasure_legacy');const fixture=require('./privacy_erasure_legacy_vectors.json');
function env(){return {PRIVACY_ERASURE_GUARD_ENABLED:'1',PRIVACY_ERASURE_HMAC_KEY:fixture.key,PRIVACY_ERASURE_LEDGER_JSON:JSON.stringify(fixture.envelope),PRIVACY_ERASURE_MIN_GENERATION:'1'};}
function guard(pool){return p.createGuard(env(),{getPool:()=>pool});}
async function request(g,uri,body={},query={}){const events=[];let response;const req={path:uri,body,query};const res={status(code){this.code=code;return this;},json(data){response={code:this.code,data};return this;}};await g.middleware(req,res,()=>events.push('handler'));return {req,response,events};}
test('exact Python Unicode normalization and HMAC vectors',()=>{for(const v of fixture.vectors){assert.equal(v.kind==='email'?p.normalizeEmail(v.input):p.normalizePhone(v.input),v.normalized);assert.equal(p.identifierHmac(v.kind,v.input,fixture.key),v.hmac);}assert.equal(p.canonical({z:'é𝄞',a:{x:'\x7f\n'},'𐀀':'test','\uffff':true}),fixture.canonical);});
test('Python canonical signed minimum verifies and generic IDs do not match',()=>{const g=guard();assert.deepEqual(g.status(),{enabled:true,ready:true});assert(g.matchesRecord({crm_contact_id:17}));assert(g.matchesRecord({contatto_id:'0017'}));assert(g.matchesRecord({kessel_id:1001}));assert(!g.matchesRecord({id:17,invoice_id:17,product_id:1001}));assert(g.matchesRecord({email:' TARGET@EXAMPLE.TEST '}));assert(g.matchesRecord({cellulare:'+39 (02)12345678'}));assert(g.matchesRecord({email:'STRAẞE@example.test'}));assert(!g.matchesRecord({email:'prefix-target@example.test'}));});
test('mixed bulk removes only target root plus old/new typed children; preserves input snapshot and unknown fields',async()=>{const g=guard();const body={regione:'SYNTHETIC',contatti:[{id:-501,email:'target@example.test',score_prodotti:{MM:2}},{id:900,email:'control@example.invalid',score_prodotti:{MM:1}}],prodotti:[{id:17,contatto_id:900,prodotto:'CONTROL'},{contatto_id:-501,prodotto:'TARGET'},{contatto_id:17,prodotto:'OLD'}],acquisti:[{contatto_id:-501},{contatto_id:900,id:17}],emails:[{contatto_id:-501,email:'alias@example.invalid'},{contatto_id:900,email:'control@example.invalid'}],telefoni:[{contatto_id:17,telefono:'synthetic'},{contatto_id:900,telefono:'123'}],cellulari:[{contatto_id:-501,cellulare:'123'},{contatto_id:900,cellulare:'456'}],nomi:[{contatto_id:17,nome:'synthetic'},{contatto_id:900,nome:'control'}],unrelated:{product_id:17,keep:[1,2,3]}};const before=JSON.stringify(body);const out=await request(g,'/api/crm/sync',body);assert.deepEqual(out.events,['handler']);assert.equal(JSON.stringify(body),before);assert.deepEqual(out.req.body.contatti,[body.contatti[1]]);for(const name of ['prodotti','acquisti','emails','telefoni','cellulari','nomi'])assert.deepEqual(out.req.body[name],body[name].filter(r=>r.contatto_id===900));assert.deepEqual(out.req.body.unrelated,body.unrelated);});
test('batch with two identities claiming same root ID fails before handler',async()=>{const out=await request(guard(),'/api/crm/sync',{regione:'x',contatti:[{id:900,email:'target@example.test'},{id:900,email:'control@example.invalid'}]});assert.equal(out.response.code,503);assert.deepEqual(out.events,[]);});
test('single target stops before handler logs/writes/outbound and returns no PII',async()=>{for(const uri of ['/api/webinar/register','/api/webinar-tardani/register','/api/community/whatsapp-magneto-dinamica/register','/api/video-tracking','/api/calendly/webhook']){const out=await request(guard(),uri,{payload:{email:'target@example.test'}});assert.deepEqual(out.events,[]);assert.deepEqual(out.response,{code:202,data:{status:'privacy-suppressed'}});assert(!JSON.stringify(out.response).includes('target@'));}assert.throws(()=>guard().assertRecipient('Synthetic <target@example.test>, control@example.invalid'),/privacy-suppressed/);});
test('CRM old root path and query recipient are qualified while invoice ID is untouched',async()=>{const pool={query:async()=>({rows:[]})};assert.equal((await request(guard(pool),'/api/crm/contatti/17/score',{punti:1})).response.code,202);assert.equal((await request(guard(pool),'/consent',{}, {email:'target@example.test'})).response.code,202);assert.deepEqual((await request(guard(pool),'/api/fatture/17',{id:17})).events,['handler']);});
test('reassignment filters only typed pairs and preserves all controls',async()=>{const pool={query:async()=>({rows:[{id:-123,email:'target@example.test'},{id:900,email:'control@example.invalid'}]})};const body={mapping:{17:100,"-123":101,900:901,800:17},other:'unchanged'};const before=JSON.stringify(body);const out=await request(guard(pool),'/api/crm/contatti/reassign-ids',body);assert.deepEqual(out.req.body,{mapping:{900:901},other:'unchanged'});assert.equal(JSON.stringify(body),before);assert.deepEqual(out.events,['handler']);const remap=await request(guard(pool),'/api/crm/contatti/remap-id',{old_id:-123,new_id:333});assert.equal(remap.response.code,202);});
test('child IDs are resolved only through exact CRM table and filtered without dropping batch controls',async()=>{const queries=[];const pool={query:async(sql,params)=>{queries.push(sql);return {rows:[{id:100,contatto_id:17},{id:17,contatto_id:900}]};}};const out=await request(guard(pool),'/api/crm/modifiche/sincronizzate',{ids:[100,17],other:'control'});assert.deepEqual(out.req.body,{ids:[17],other:'control'});assert(queries[0].includes('FROM crm_modifiche_log'));assert.equal((await request(guard(pool),'/api/crm/note/100',{testo:'x'})).response.code,202);assert.deepEqual((await request(guard(pool),'/api/crm/note/17',{testo:'x'})).events,['handler']);});
test('recover and email-list requests filter target entries before all handlers',async()=>{const g=guard();const body={registrants:[{email:'target@example.test'},{email:'control@example.invalid'}],tag:'synthetic'};const out=await request(g,'/api/webinar/registrants/recover',body);assert.deepEqual(out.req.body.registrants,[body.registrants[1]]);const emails=await request(g,'/api/webinar/force-zoom-link',{emails:['target@example.test','control@example.invalid'],zoom_link:'x'});assert.deepEqual(emails.req.body.emails,['control@example.invalid']);});
test('signature/config/floor/duplicate keys fail closed only when enabled, without logging original body',async()=>{for(const mutate of [e=>e.PRIVACY_ERASURE_HMAC_KEY='bad',e=>e.PRIVACY_ERASURE_LEDGER_JSON='{}',e=>e.PRIVACY_ERASURE_MIN_GENERATION='2',e=>{const b=JSON.parse(e.PRIVACY_ERASURE_LEDGER_JSON);b.payload.crm_contact_ids=[999];e.PRIVACY_ERASURE_LEDGER_JSON=JSON.stringify(b);},e=>e.PRIVACY_ERASURE_GUARD_ENABLED='garbage',e=>e.PRIVACY_ERASURE_LEDGER_JSON=e.PRIVACY_ERASURE_LEDGER_JSON.replace('"payload":','"payload":null,"payload":')]){const e=env();mutate(e);const out=await request(p.createGuard(e),'/api/crm/contatti',{email:'control@example.invalid'});assert.equal(out.response.code,503);assert.deepEqual(out.events,[]);assert.deepEqual(out.response.data,{error:'privacy-guard-unavailable'});}const out=await request(p.createGuard({PRIVACY_ERASURE_GUARD_ENABLED:'0'}),'/api/crm/contatti',{email:'target@example.test'});assert.deepEqual(out.events,['handler']);});
test('actual source wiring precedes route handlers and per-row side effects',()=>{const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');assert(source.indexOf('app.use(legacyPrivacy.middleware)')<source.indexOf("app.post('/api/crm/contatti'"));assert(source.indexOf('app.use(legacyPrivacy.middleware)')>source.indexOf('app.use(express.json('));assert(source.indexOf('legacyPrivacy.assertRecipient(to)')>source.indexOf('async function sendMailgunEmail('));assert(source.indexOf('if (legacyPrivacy.matchesRecord(p)) continue;',source.indexOf('for (const p of allParticipants)'))<source.indexOf('const email = (p.user_email'));assert(source.includes('for (const row of result.rows) {\n            if (legacyPrivacy.matchesRecord(row)) continue;\n            try {\n                await sendWebinarEmail'));});

test('URL-encoded real CRM root IDs cannot bypass the qualified path check',async()=>{const out=await request(guard(),'/api/crm/contatti/%31%37',{nome:'blocked'});assert.equal(out.response.code,202);assert.deepEqual(out.events,[]);});

test('startup executes real migration wiring under one transaction and HMAC-skips target markers',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const body=/async function initDB\(\) \{([\s\S]*?)\n\}/.exec(source)[1];
 const calls=[],markers=[];const client={release(){calls.push(['release']);},async query(sql,params){calls.push([sql,params]);if(sql.includes('SELECT 1 FROM crm_score_manuali'))return {rows:[{x:1}]};if(sql.includes('SELECT vt.contatto_id, MIN(vt.email)'))return {rows:[{contatto_id:999,email:'target@example.test',campagna:'synthetic',max_sec:2400,max_dur:4000},{contatto_id:900,email:'control@example.invalid',campagna:'synthetic',max_sec:1500,max_dur:4000}]};if(sql.includes('INSERT INTO crm_video_tracking\n'))markers.push(params);return {rows:[],rowCount:0};}};
 const init=new Function('connectWithRetry','legacyPrivacy','console','return async function(){'+body+'}')(async()=>client,guard(),{log(){},error(){}});
 await init();assert.equal(markers.length,2);assert(markers.every(p=>p[0]===900&&p[1]==='control@example.invalid'));
 const begin=calls.findIndex(c=>c[0]==='BEGIN'),commit=calls.findIndex(c=>c[0]==='COMMIT');assert(begin>=0&&commit>begin);
 const guc=calls.findIndex(c=>String(c[0]).includes("set_config('app.privacy_blocked_crm_ids'"));assert(guc>begin&&guc<commit);assert.deepEqual(calls[guc][1],['{17}']);
 const migration=calls.find(c=>String(c[0]).includes('DO $$')&&String(c[0]).includes('blocked_crm_ids'))[0];assert.equal((migration.match(/COALESCE\(contatto_id,0\)=ANY\(blocked_crm_ids\)/g)||[]).length,3);
 assert(!migration.includes('MIN(vt.email)'));assert(calls.filter(c=>String(c[0]).trimStart().startsWith('CREATE TABLE')).length>0);
});

test('invalid enabled config prevents every initDB write; failed marker write rolls migration back',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),body=/async function initDB\(\) \{([\s\S]*?)\n\}/.exec(source)[1];
 let connections=0;const bad=p.createGuard({...env(),PRIVACY_ERASURE_LEDGER_JSON:'{}'});
 const init=new Function('connectWithRetry','legacyPrivacy','console','return async function(){'+body+'}')(async()=>{connections++;},bad,{log(){},error(){}});
 await assert.rejects(init,/privacy_guard_unavailable/);assert.equal(connections,0);
 const calls=[];const client={release(){},async query(sql){calls.push(sql);if(sql.includes('SELECT 1 FROM crm_score_manuali'))return {rows:[{}]};if(sql.includes('SELECT vt.contatto_id, MIN(vt.email)'))return {rows:[{contatto_id:900,email:'control@example.invalid',campagna:'synthetic',max_sec:600,max_dur:700}]};if(sql.includes('INSERT INTO crm_video_tracking\n'))throw Error('synthetic db failure');return {rows:[]};}};
 const failing=new Function('connectWithRetry','legacyPrivacy','console','return async function(){'+body+'}')(async()=>client,guard(),{log(){},error(){}});await assert.rejects(failing,/synthetic db failure/);assert(calls.includes('ROLLBACK'));assert(!calls.includes('COMMIT'));
});

test('maintenance SQL uses only ledger IDs as parameters; ordinary controls and DDL have no blanket bypass',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert.deepEqual(guard().blockedCrmIds(),[17]);assert.deepEqual(p.createGuard({}).blockedCrmIds(),[]);
 const fix=s.slice(s.indexOf("app.put('/api/webinar/registrations/fix-contatto-id'"),s.indexOf('// PUT /api/webinar/registrations/fix-action'));
 assert.equal((fix.match(/id=ANY\(\$2::int\[\]\)/g)||[]).length,2);assert(fix.includes('[webinar_tag,legacyPrivacy.blockedCrmIds()]'));
 const reset=s.slice(s.indexOf("app.post('/api/webinar/reset-zoom-scores'"),s.indexOf('// Landing page webinar'));
 assert(reset.includes('AND NOT (contatto_id=ANY($2::int[]))'));assert(reset.includes('COALESCE(contatto_id,0)=ANY($2::int[])'));
 const camp=s.slice(s.indexOf("app.post('/api/video-tracking/fix-campagna'"),s.indexOf('// GET video tracking data'));
 assert(camp.includes('COALESCE(contatto_id,0)=ANY($1::int[])'));assert(camp.includes('COALESCE(contatto_id,0)=ANY($2::int[])'));assert(camp.includes('if (legacyPrivacy.matchesRecord(row)) continue;'));
 const clean=s.slice(s.indexOf("app.delete('/api/webinar-arcara/cleanup-test'"),s.indexOf("app.post('/api/leads/whatsapp-group'"));assert(clean.includes('allowedContacts'));assert(clean.includes('COALESCE(contatto_id,0)=ANY($1::int[])'));
});

// Run the actual frozen handler body after the real middleware. Stubs only
// replace database/log/download sinks; no network or provider is available.
async function realPipeline(route,method,{uri,body={},query={},params={}}){
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const start=source.indexOf(`app.${method.toLowerCase()}('${route}'`);assert(start>=0);
 const callback=source.indexOf('async (req, res) => {',start)+'async (req, res) => {'.length;
 const handlerBody=source.slice(callback,source.indexOf('\n});',callback));
 const events=[],queries=[];
 const pool={async query(sql,args){events.push('query');queries.push({sql,args});if(sql.startsWith('SELECT id,email,email_secondaria'))return {rows:[{id:900,email:'control@example.invalid'}]};if(sql.includes('UPDATE crm_contatti SET'))return {rows:[{id:900,[body.campo]:args[0]}]};return {rows:[],rowCount:0};},async connect(){events.push('connect');return {release(){},async query(sql,args){events.push('query');queries.push({sql,args});if(sql.includes('INSERT INTO opportunita'))return {rows:[{id:777}]};if(sql.includes('SELECT id, cognome, nome, tipo FROM crm_contatti'))return {rows:[{id:900,tipo:'lead'}]};return {rows:[],rowCount:0};}};}};
 const logs={log(){events.push('log');},warn(){events.push('log');},error(){events.push('log');}};
 const handler=new Function('pool','console','Buffer','PDF_DOWNLOADS','path','__dirname','return async function(req,res){'+handlerBody+'}')(pool,logs,Buffer,{'synthetic':{file:'synthetic.pdf',campagna:'synthetic'}},path,__dirname);
 const g=guard(pool),req={method,path:uri,body,query,params};let reply,invoked;
 const res={headersSent:false,status(code){this.code=code;return this;},json(data){reply={code:this.code||200,data};return this;},send(data){reply={code:this.code||200,data};return this;},download(){events.push('download');}};
 const before=JSON.stringify({body,query});
 await g.middleware(req,res,()=>{events.push('handler');invoked=handler(req,res);});
 if(invoked)await invoked;
 await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(JSON.stringify({body,query}),before);
 return {events,queries,reply,req};
}

test('F1 actual PDF pipeline lenient Base64 variants block before async tracking/log/download',async()=>{
 const base=Buffer.from('target@example.test').toString('base64');
 const variants=[base,base.replace(/=+$/,''),base.slice(0,8)+' \n! '+base.slice(8),Buffer.from('\ufeff TARGET@EXAMPLE.TEST \ufeff').toString('base64'),Buffer.from('straße@example.test').toString('base64url'),[base]];
 for(const e of variants){const out=await realPipeline('/api/download/:slug','GET',{uri:'/api/download/synthetic',query:{e},params:{slug:'synthetic'}});assert.deepEqual(out.events,[]);assert.deepEqual(out.reply,{code:202,data:{status:'privacy-suppressed'}});}
 const control=await realPipeline('/api/download/:slug','GET',{uri:'/api/download/synthetic',query:{e:Buffer.from('control@example.invalid').toString('base64')},params:{slug:'synthetic'}});
 assert(control.events.includes('download'));assert(control.events.includes('log'));assert(control.queries.some(q=>q.sql.includes('INSERT INTO crm_video_tracking')));
});

test('F2 actual Calendly pipeline types selected question answer before initial console body',async()=>{
 for(const question of ['Il tuo telefono','phone number','cellulare di contatto']){
  const body={event:'invitee.created',payload:{email:'control@example.invalid',name:'Synthetic Control',questions_and_answers:[{question:'Nome libero',answer:'unrelated'},{question,answer:'+39 (02)12345678'}],scheduled_event:{start_time:'2026-11-24T12:00:00Z'},event_type_name:'Synthetic',uri:'synthetic'}};
  const out=await realPipeline('/api/calendly/webhook','POST',{uri:'/api/calendly/webhook',body});assert.deepEqual(out.events,[]);assert.equal(out.reply.code,202);
 }
 const controlBody={event:'invitee.created',payload:{email:'control@example.invalid',name:'Synthetic Control',questions_and_answers:[{question:'telefono',answer:'+49 3012345678'},{question:'Preferenze',answer:'unchanged'}],scheduled_event:{start_time:'2026-11-24T12:00:00Z'},event_type_name:'Synthetic',uri:'synthetic'}};
 const control=await realPipeline('/api/calendly/webhook','POST',{uri:'/api/calendly/webhook',body:controlBody});assert.equal(control.reply.code,200);assert(control.events.includes('log'));assert(control.queries.some(q=>q.sql.includes('INSERT INTO opportunita')&&q.args[3]==='+49 3012345678'));
});

test('F3 actual editor pipeline target typed value on control root stops before lookup/update/log',async()=>{
 for(const [campo,valore] of [['email',' TARGET@example.TEST '],['telefono','0039 0212345678'],['cellulare','+39 (02)12345678']]){
  const out=await realPipeline('/api/crm/contatti/:id','PUT',{uri:'/api/crm/contatti/900',params:{id:'900'},body:{campo,valore,additional:{keep:true}}});assert.deepEqual(out.events,[]);assert.equal(out.reply.code,202);
 }
 for(const [campo,valore] of [['email','control@example.invalid'],['telefono','+49 3012345678'],['cellulare','+49 3012345678'],['nome','target@example.test']]){
  const out=await realPipeline('/api/crm/contatti/:id','PUT',{uri:'/api/crm/contatti/900',params:{id:'900'},body:{campo,valore,additional:{keep:true}}});assert.equal(out.reply.code,200);assert(out.events.includes('log'));assert(out.queries.some(q=>q.sql.includes(`UPDATE crm_contatti SET ${campo}`)&&q.args[0]===valore));assert(out.queries.some(q=>q.sql.includes('INSERT INTO crm_modifiche_log')));
 }
});

test('F3 projection follows the actual dynamic editor route without shadowing remap',async()=>{const out=await realPipeline('/api/crm/contatti/:id','PUT',{uri:'/api/crm/contatti/900legacy',params:{id:'900legacy'},body:{campo:'email',valore:'target@example.test'}});assert.deepEqual(out.events,[]);assert.equal(out.reply.code,202);});

async function dispatchedPipeline(route,method,{uri,body={},query={},pdfSlug='CaseTokenX'}){
 const http=require('node:http');const {PassThrough}=require('node:stream');const os=require('node:os');
 const locations=[__dirname,process.cwd(),process.env.PRIVACY_LEGACY_EXPRESS_MODULE_ROOT,path.join(os.homedir(),'OneDrive','Desktop','DASHBOARD CS')].filter(Boolean);
 const expressPath=require.resolve('express',{paths:locations});const express=require(expressPath);
 assert.match(require(path.join(path.dirname(expressPath),'package.json')).version,/^4\./);
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const start=source.indexOf(`app.${method.toLowerCase()}('${route}'`);assert(start>=0);
 const callback=source.indexOf('async (req, res) => {',start)+'async (req, res) => {'.length;
 const handlerBody=source.slice(callback,source.indexOf('\n});',callback));
 const events=[],queries=[],seen={};
 const pool={async query(sql,args){events.push('query');queries.push({sql,args});if(sql.startsWith('SELECT id,email,email_secondaria'))return {rows:[{id:900,email:'control@example.invalid'}]};if(sql.includes('UPDATE crm_contatti SET'))return {rows:[{id:900,[body.campo]:args[0]}]};return {rows:[],rowCount:0};},async connect(){events.push('connect');return {release(){},async query(sql,args){events.push('query');queries.push({sql,args});if(sql.includes('INSERT INTO opportunita'))return {rows:[{id:777}]};if(sql.includes('SELECT id, cognome, nome, tipo FROM crm_contatti'))return {rows:[{id:900,tipo:'lead'}]};return {rows:[],rowCount:0};}};}};
 const logs={log(){events.push('log');},warn(){events.push('log');},error(){events.push('log');}};
 const handler=new Function('pool','console','Buffer','PDF_DOWNLOADS','path','__dirname','return async function(req,res){'+handlerBody+'}')(pool,logs,Buffer,{[pdfSlug]:{file:'synthetic.pdf',campagna:'synthetic'}},path,__dirname);
 const app=express();assert.equal(app.enabled('case sensitive routing'),false);assert.equal(app.enabled('strict routing'),false);
 app.use(express.json());
 app.use((req,res,next)=>{res.download=()=>{events.push('download');res.end('synthetic');};next();});
 app.use(guard(pool).middleware);
 app[method.toLowerCase()](route,(req,res)=>{events.push('handler');seen.params={...req.params};seen.query=structuredClone(req.query);seen.body=structuredClone(req.body);Promise.resolve(handler(req,res)).catch(err=>{res.status(500).end('synthetic failure');});});
 const request=new http.IncomingMessage(new PassThrough());request.method=method;
 request.url=uri+(Object.keys(query).length?'?'+new URLSearchParams(query).toString():'');
 const payload=JSON.stringify(body);request.headers=method==='GET'?{}:{'content-type':'application/json','content-length':String(Buffer.byteLength(payload))};
 const response=new http.ServerResponse(request);let result;
 const completed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('synthetic dispatcher timeout')),2500);response.end=function(chunk){result={code:this.statusCode,body:chunk?String(chunk):''};clearTimeout(timer);resolve();return this;};app.handle(request,response,err=>{clearTimeout(timer);if(err)reject(err);else {result={code:404};resolve();}});});
 if(method!=='GET')request.push(Buffer.from(payload));request.push(null);
 await completed;await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 return {events,queries,result,seen};
}

test('R1 actual Express4 dispatcher guards PDF case/slash aliases and preserves opaque slug/query',async()=>{
 for(const uri of ['/api/download/CaseTokenX','/api/download/CaseTokenX/','/API/DOWNLOAD/CaseTokenX/','/Api/Download/CaseTokenX']){
  const blocked=await dispatchedPipeline('/api/download/:slug','GET',{uri,query:{e:Buffer.from('target@example.test').toString('base64'),token:'KeepThisTOKEN'}});
  assert.equal(blocked.result.code,202);assert.deepEqual(blocked.events,[]);
  const control=await dispatchedPipeline('/api/download/:slug','GET',{uri,query:{e:Buffer.from('control@example.invalid').toString('base64'),token:'KeepThisTOKEN'}});
  assert.equal(control.result.code,200);assert(control.events.includes('download'));assert(control.events.includes('log'));assert.equal(control.seen.params.slug,'CaseTokenX');assert.equal(control.seen.query.token,'KeepThisTOKEN');assert(control.queries.some(q=>q.sql.includes('INSERT INTO crm_video_tracking')));
 }
});

test('R1 actual Express4 dispatcher guards Calendly case/slash aliases before initial body log',async()=>{
 const make=phone=>({event:'invitee.created',payload:{email:'control@example.invalid',name:'Synthetic Control',questions_and_answers:[{question:'telefono',answer:phone}],scheduled_event:{start_time:'2026-11-24T12:00:00Z'},event_type_name:'Synthetic',uri:'OpaqueEventTOKEN'}});
 for(const uri of ['/api/calendly/webhook','/api/calendly/webhook/','/API/CALENDLY/WEBHOOK/','/Api/CaLeNdLy/Webhook']){
  const blocked=await dispatchedPipeline('/api/calendly/webhook','POST',{uri,body:make('+39 (02)12345678')});assert.equal(blocked.result.code,202);assert.deepEqual(blocked.events,[]);
  const input=make('+49 3012345678');const control=await dispatchedPipeline('/api/calendly/webhook','POST',{uri,body:input});assert.equal(control.result.code,200);assert.deepEqual(control.seen.body,input);assert(control.events.includes('log'));assert(control.queries.some(q=>q.sql.includes('INSERT INTO opportunita')));
 }
});

test('R1 actual Express4 dispatcher guards typed editor case/slash and encoded numeric IDs',async()=>{
 for(const uri of ['/api/crm/contatti/900','/api/crm/contatti/900/','/API/CRM/CONTATTI/900/','/Api/Crm/Contatti/%39%30%30/']){
  const blocked=await dispatchedPipeline('/api/crm/contatti/:id','PUT',{uri,body:{campo:'email',valore:'target@example.test',additional:'KeepCaseTOKEN'}});assert.equal(blocked.result.code,202);assert.deepEqual(blocked.events,[]);
  const input={campo:'email',valore:'ControlCase@example.invalid',additional:'KeepCaseTOKEN'};const control=await dispatchedPipeline('/api/crm/contatti/:id','PUT',{uri,body:input});assert.equal(control.result.code,200);assert.equal(control.seen.params.id,'900');assert.deepEqual(control.seen.body,input);assert(control.queries.some(q=>q.sql.includes('UPDATE crm_contatti SET email')&&q.args[0]===input.valore));
 }
});
