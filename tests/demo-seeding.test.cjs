const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {SupabaseAPI}=require('../scripts/demo/api.cjs');
const {ensureAccount,pool,pdf}=require('../scripts/demo/seed.cjs');
const {scenarios}=require('../scripts/demo/scenarios.cjs');
const {generate}=require('../scripts/demo/identities.cjs');
const {catalogueFingerprint,REQUIRED}=require('../scripts/demo/audit.cjs');
const {privatePath}=require('../scripts/demo/files.cjs');
const load=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('admin pagination continues past server page caps and redacts key errors',async()=>{
 let pages=0;const api=new SupabaseAPI({url:'https://example.test',key:'private-test-key'},async(url)=>{
  const page=Number(new URL(url).searchParams.get('page'));pages++;
  return new Response(JSON.stringify({users:page<4?[{id:page}]:[]}),{status:200});
 });
 assert.equal((await api.users()).length,3);assert.equal(pages,4);
 const denied=new SupabaseAPI({url:'https://example.test',key:'private-test-key'},async()=>new Response(JSON.stringify({message:'Denied private-test-key',code:'42501'}),{status:403}));
 await assert.rejects(denied.rpc('test'),e=>e.message==='Denied [redacted]');
});
test('bounded worker pool completes in-flight work and stops starting records after failure',async()=>{
 let active=0,max=0,completed=0;
 await assert.rejects(pool(Array.from({length:100},(_,i)=>i),3,async i=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;completed++;if(i===1)throw Error('Permission denied');}),/Permission/);
 assert(max<=3);assert.equal(active,0);assert(completed<100);
});
test('new secret keys stay in apikey while user sessions use Bearer JWTs',async()=>{
 const calls=[];const api=new SupabaseAPI({url:'https://example.test',key:'sb_secret_local-test'},async(url,options)=>{calls.push(options);return new Response('{}',{status:200});});
 await api.rpc('demo_seed_status');await api.rpc('ordinary_user_workflow',{},'signed-user-jwt');
 assert.equal(calls[0].headers.apikey,'sb_secret_local-test');assert.equal(calls[0].headers.Authorization,undefined);
 assert.equal(calls[1].headers.Authorization,'Bearer signed-user-jwt');
});
test('supporting PDFs have valid cross-references and natural document labels',()=>{
 const bytes=pdf('Academic results summary - Lerato Mokoena - Student number: 260000001');
 assert.match(bytes.toString(),/^%PDF-1.4/);assert.match(bytes.toString(),/Academic results summary/);
 assert.match(bytes.toString(),/Lerato Mokoena/);assert.match(bytes.toString(),/Student number: 260000001/);
 assert.doesNotMatch(bytes.toString(),/demo|prototype|fictional|official academic record/i);
 const start=Number(bytes.toString().match(/startxref\n(\d+)/)[1]);assert.equal(bytes.subarray(start,start+4).toString(),'xref');
 const accented=pdf('Zoë Müller'),source=accented.toString();
 assert.match(source,/Zoe Muller/);assert.equal([...accented].every(b=>b<128),true);
 const stream=source.match(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/);
 assert.equal(Number(stream[1]),Buffer.byteLength(stream[2]));
});

test('Auth/profile provisioning, complete scenarios, resume and cleanup run against isolated PostgreSQL',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const batch='offline-'+crypto.randomBytes(5).toString('hex');
 const directory=privatePath(batch);fs.mkdirSync(directory,{recursive:true});
 t.after(()=>{assert(directory.startsWith(path.resolve(__dirname,'../.demo-seed')+path.sep+'offline-'));fs.rmSync(directory,{recursive:true,force:true});});
 await db.exec(load('tests/fixtures/deployed-contract.sql'));
 for(const name of ['20261019000000_academic_lifecycle.sql','20261019010000_demo_cohort_and_seeding.sql','20261019020000_academic_clients_and_analytics.sql'])await db.exec(load('database/'+name));
 await db.exec(`CREATE SCHEMA cron;CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;`);
 await db.exec(load('database/20261019040000_demo_workflows_and_schedule.sql'));
 await db.exec(`INSERT INTO faculties(id,name) OVERRIDING SYSTEM VALUE VALUES(1,'Demo Science');INSERT INTO programmes(id,faculty_id,name,qualification_level,max_study_year) OVERRIDING SYSTEM VALUE VALUES(1,1,'BSc','undergraduate',3);`);
 const audit={audit_version:1,captured_at:new Date().toISOString(),academic_date:'2026-10-19',faculties:[{id:'1',name:'Demo Science'}],programmes:[{id:'1',faculty_id:'1',name:'BSc'}],tables:REQUIRED.map(table_name=>({schema_name:'public',table_name})),triggers:[],routines:[],policies:[],grants:[],routine_grants:[],profile_counts:[],existing_student_numbers:[],existing_demo_emails:[],storage_buckets:[],auth_profile_summary:{}};
 const mapping={reviewed:true,catalogue_hash:catalogueFingerprint(audit),programmes:[{id:'1',faculty_id:'1',name:'BSc',qualification_level:'undergraduate',max_study_year:3}]};
 const plan=generate(audit,mapping,batch);const manifest={batch,accounts:Object.fromEntries(plan.accounts.map(a=>[a.seed_key,{email:a.email,password:'Local-test-password!',profile_done:false}])),operations:{},storage:[],errors:[]};
 const api={
  async users(){return(await db.query('SELECT id,email,raw_app_meta_data AS app_metadata FROM auth.users')).rows;},
  async createUser(body){const id=crypto.randomUUID();await db.query('INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data) VALUES($1,$2,now(),$3,$4)',[id,body.email,body.user_metadata,body.app_metadata]);return{id,email:body.email,app_metadata:body.app_metadata};},
  async rpc(name,args={},actor){await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[actor||'']);await db.exec(actor?'SET ROLE authenticated':'SET ROLE service_role');try{return(await db.query(`SELECT public.${name}(${Object.keys(args).map((k,i)=>`${k} := $${i+1}`).join(',')}) AS result`,Object.values(args))).rows[0].result;}finally{await db.exec('RESET ROLE');await db.exec(`SELECT set_config('request.jwt.claim.sub','',false)`);}},
  async signIn(email){return(await db.query('SELECT id FROM auth.users WHERE email=$1',[email])).rows[0].id;},
  async upload(name){if(!(await db.query('SELECT id FROM storage.objects WHERE name=$1',[name])).rows.length)await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('mentor-academic-records',$1)",[name]);},
  async table(name,filter){const entries=Object.entries(filter);return(await db.query(`SELECT * FROM ${name} WHERE ${entries.map(([k],i)=>`${k}=$${i+1}`).join(' AND ')}`,entries.map(([,v])=>v.slice(3)))).rows;}
 };
 await api.rpc('demo_start_batch',{p_batch:batch,p_plan_hash:plan.plan_hash});const users=[];
 for(const a of plan.accounts)await ensureAccount(api,plan,manifest,a,users);
 assert.equal((await api.users()).length,54);
 const selected=plan.accounts[0],uid=manifest.accounts[selected.seed_key].id;
 await db.query("UPDATE profiles SET full_name='Manual demo edit' WHERE id=$1",[uid]);
 await ensureAccount(api,plan,manifest,selected,users);
 assert.equal((await db.query('SELECT full_name FROM profiles WHERE id=$1',[uid])).rows[0].full_name,'Manual demo edit');
 await scenarios(api,plan,manifest,plan.accounts,()=>{});
 const before=(await db.query('SELECT count(*)::integer AS n FROM calendar_events')).rows[0].n;
 await scenarios(api,plan,manifest,plan.accounts,()=>{});
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM calendar_events')).rows[0].n,before);
 const report=await api.rpc('demo_batch_report',{p_batch:batch});
 assert.equal(report.profiles.filter(p=>p.role==='student').length,50);assert.equal(report.profiles.filter(p=>p.mentor_active).length,2);
 assert.equal(report.notification_leaks,0);assert.equal(report.cross_batch_assignments,0);assert.equal(report.capacity_violations,0);
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM active_mentor_assignments')).rows[0].n,24);
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM event_attendance')).rows[0].n,8);
 const sup=plan.accounts.find(a=>a.role==='supervisor'),admin=plan.accounts.find(a=>a.role==='admin');
 const stats=await api.rpc('get_admin_analytics',{p_period_days:90},manifest.accounts[admin.seed_key].id);
 for(const [metric,key]of Object.entries({students:'active_students',mentors:'active_mentors',eligible:'eligible_mentees',unassigned:'unassigned_mentees',awaiting:'awaiting_results',assignments:'active_assignments'}))assert.equal((await api.rpc('get_admin_analytics_details',{p_metric:metric,p_period_days:90},manifest.accounts[admin.seed_key].id)).length,stats[key]);
 assert.equal(stats.active_students,50);assert.equal(stats.eligible_mentees,30);assert.equal(stats.unassigned_mentees,6);
 const preview=await api.rpc('demo_cleanup_batch',{p_batch:batch,p_execute:false});assert.equal(preview.auth_ids.length,54);
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM profiles')).rows[0].n,54);
 await api.rpc('demo_cleanup_batch',{p_batch:batch,p_execute:true});
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM profiles')).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM event_attendance')).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM auth.users')).rows[0].n,54,'Auth deletion is a separate Admin API step.');
});
