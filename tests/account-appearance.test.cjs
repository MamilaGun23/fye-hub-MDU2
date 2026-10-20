'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {effectivePlan,DISPLAY_FIELDS}=require('../scripts/demo/appearance.cjs');
const files=require('../scripts/demo/files.cjs');

function load(relative,mocks={}){
 const filename=path.join(__dirname,'..',relative),module={exports:{}},localRequire=createRequire(filename);
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:name=>Object.hasOwn(mocks,name)?mocks[name]:localRequire(name),console:{log(){}},Buffer},{filename});
 return module.exports;
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function fixture(complete=false){
 const batch='presentation-appearance';
 const student={seed_key:batch+'/student/1',id:'source-student-id',role:'student',email:'demo.student@example.test',student_number:'260000001',full_name:'Original Student',first_name:'Original',last_name:'Student',faculty_id:'1',faculty:'Agriculture and Natural Sciences',programme_id:'1',programme:'BSc',school:'Original school',study_year:1,first_entry_year:2026,entry_status:'first_time',academic_verified:true,is_active:true,presentation_login:true};
 const accounts=[student,{...student,seed_key:batch+'/mentor/1',id:'source-mentor-id',role:'mentor',email:'demo.mentor@example.test',student_number:'250000001',study_year:2,first_entry_year:2025,entry_status:'returning'},...['admin','supervisor'].map(role=>({seed_key:batch+'/staff/'+role,role,email:'demo.'+role+'@example.test',student_number:null,full_name:'Original '+role,first_name:'Original',last_name:role,faculty_id:null,faculty:'Demo staff',programme_id:null,programme:'Demo staff',school:null,study_year:null,first_entry_year:null,entry_status:null,academic_verified:false,is_active:true,presentation_login:true}))];
 if(complete)for(let i=2;i<=50;i++)accounts.push({...student,seed_key:batch+'/student/'+i,id:'source-student-'+i,email:'demo.student'+i+'@example.test',student_number:'26'+String(i).padStart(7,'0'),presentation_login:false});
 const plan={version:1,batch,as_of:'2026-10-20T10:00:00.000Z',plan_hash:'reviewed-original-plan-hash',accounts};
 const manifest={batch,project:'https://project.example.test',plan_hash:plan.plan_hash,accounts:{},operations:{},storage:[],errors:[]};
 for(const a of accounts){
  const appearance={email:a.student_number?a.student_number+'@ump.ac.za':(a.role==='admin'?'nandi.dlamini':'thabo.nkosi')+'@ump.ac.za',first_name:a.role==='admin'?'Nandi':a.role==='supervisor'?'Thabo':'Lerato',last_name:a.role==='admin'?'Dlamini':a.role==='supervisor'?'Nkosi':'Mokoena',school:a.student_number?'Agriculture and Natural Sciences':'Student Affairs',faculty:a.student_number?a.faculty:'Student Affairs',programme:a.student_number?a.programme:'First-Year Experience',bio:'Available to support students with their academic goals.'};
  appearance.full_name=appearance.first_name+' '+appearance.last_name;
  manifest.accounts[a.seed_key]={id:'profile-'+a.seed_key.split('/').slice(-2).join('-'),password:'local-password',email:appearance.email,profile_done:true,appearance};
 }
 return{plan:freeze(plan),manifest};
}

test('appearance overlays only display fields and preserves the frozen academic plan and hash',()=>{
 const {plan,manifest}=fixture(),before=JSON.stringify(plan),displayed=effectivePlan(plan,manifest);
 assert.notEqual(displayed,plan);assert.notEqual(displayed.accounts,plan.accounts);
 assert.equal(displayed.plan_hash,plan.plan_hash);
 for(let i=0;i<plan.accounts.length;i++){
  const original=plan.accounts[i],current=displayed.accounts[i];
  assert.notEqual(current,original);
  for(const [field,value]of Object.entries(original))if(!DISPLAY_FIELDS.includes(field))assert.deepEqual(current[field],value,field+' must remain reviewed.');
  assert.equal(current.email,manifest.accounts[original.seed_key].email);
  assert.equal(current.full_name,manifest.accounts[original.seed_key].appearance.full_name);
 }
 assert.equal(JSON.stringify(plan),before);
});

test('appearance rejects academic, role, identity and ownership changes',()=>{
 for(const field of ['role','id','seed_key','student_number','faculty_id','programme_id','study_year','first_entry_year','entry_status','is_active','academic_verified','password','__proto__']){
  const {plan,manifest}=fixture(),key=plan.accounts[0].seed_key;
  Object.defineProperty(manifest.accounts[key].appearance,field,{value:'changed',enumerable:true});
  assert.throws(()=>effectivePlan(plan,manifest),/Appearance cannot change/,field);
 }
});

test('appearance enforces student-number addresses, natural UMP staff addresses and unique emails',()=>{
 for(const index of [0,1])for(const email of ['260000999@ump.ac.za','260000001@example.test','student@ump.ac.za']){
  const {plan,manifest}=fixture(),state=manifest.accounts[plan.accounts[index].seed_key];state.appearance.email=email;state.email=email;
  assert.throws(()=>effectivePlan(plan,manifest),/original student number/);
 }
 for(const email of ['staff@example.test','260000001@ump.ac.za','demo.admin@ump.ac.za','Nandi.Dlamini@ump.ac.za']){
  const {plan,manifest}=fixture(),state=manifest.accounts[plan.accounts[2].seed_key];state.appearance.email=email;state.email=email;
  assert.throws(()=>effectivePlan(plan,manifest),/personal UMP address/);
 }
 const {plan,manifest}=fixture(),admin=manifest.accounts[plan.accounts[2].seed_key],supervisor=manifest.accounts[plan.accounts[3].seed_key];
 supervisor.appearance.email=admin.email;supervisor.email=admin.email;
 assert.throws(()=>effectivePlan(plan,manifest),/Duplicate/);
});

test('appearance refuses manifest drift and accepts unchanged legacy accounts',()=>{
 for(const field of ['batch','plan_hash']){
  const {plan,manifest}=fixture();manifest[field]='other-batch';
  assert.throws(()=>effectivePlan(plan,manifest),/manifest batch\/plan differs/);
 }
 const {plan,manifest}=fixture();
 manifest.accounts[plan.accounts[0].seed_key].email='wrong@ump.ac.za';
 assert.throws(()=>effectivePlan(plan,manifest),/manifest email differ/);
 for(const a of plan.accounts){delete manifest.accounts[a.seed_key].appearance;manifest.accounts[a.seed_key].email=a.email;}
 assert.deepEqual(effectivePlan(plan,manifest),plan);
});

test('presentation credentials use appearance without changing the source plan',()=>{
 const {plan,manifest}=fixture(),writes=[];
 const {sheet}=load('scripts/demo/seed.cjs',{'./files.cjs':{...files,save:(filename,body)=>writes.push({filename,body})}});
 sheet(plan,manifest);
 assert.equal(writes.length,1);assert.equal(writes[0].filename,plan.batch+'/presentation-logins.csv');
 assert.match(writes[0].body,/Lerato Mokoena/);assert.match(writes[0].body,/260000001@ump\.ac\.za/);
 assert.match(writes[0].body,/Nandi Dlamini/);assert.doesNotMatch(writes[0].body,/demo\.|Original Student|Demo staff/);
 assert.equal(plan.accounts[0].email,'demo.student@example.test');
});

test('account resume uses its tracked appearance and refuses an unowned replacement',async()=>{
 const {plan,manifest}=fixture(),account=plan.accounts[0],state=manifest.accounts[account.seed_key],writes=[];
 const {ensureAccount}=load('scripts/demo/seed.cjs',{'./files.cjs':{...files,save:(filename,body)=>writes.push({filename,body})}});
 const user={id:state.id,email:state.email,app_metadata:{fye_demo_batch:plan.batch,fye_seed_key:account.seed_key}};
 const api={async createUser(){throw Error('Resume must not create another account.');},async rpc(){throw Error('Reviewed profile must not be reseeded.');}};
 await ensureAccount(api,plan,manifest,account,[user]);
 assert.equal(writes.length,1);assert.equal(state.email,'260000001@ump.ac.za');
 await assert.rejects(ensureAccount(api,plan,manifest,account,[{...user,app_metadata:{}}]),/unmarked/);
 await assert.rejects(ensureAccount(api,plan,manifest,account,[{...user,id:'replacement-account'}]),/missing or changed/);
});

function liveHarness(plan,manifest){
 const calls={preflight:[],provision:[],logins:[],access:[],sheets:[],writes:[],cleanup:[]};
 const displayed=effectivePlan(plan,manifest);
 const api={
  async users(){return displayed.accounts.map(a=>({id:manifest.accounts[a.seed_key].id,email:a.email,app_metadata:{fye_demo_batch:plan.batch,fye_seed_key:a.seed_key}}));},
  async rpc(name,args){
   if(name==='demo_batch_report')return{profiles:displayed.accounts.map(a=>({...a,id:manifest.accounts[a.seed_key].id,auth_link:true,auth_owned:true,email_confirmed:true,mentor_active:a.role==='mentor'})),scenario_counts:{applications:100,assignments:100,events:100,attendance:100,cancellations:100,messages:100,notices:100}};
   if(name==='demo_cleanup_batch'){calls.cleanup.push(args);return{auth_ids:Object.values(manifest.accounts).map(state=>state.id)};}
   return{schema_intact:true};
  },
  async signIn(email){calls.logins.push(email);return email;},
  async request(){}
 };
 const live=load('scripts/demo/live.cjs',{
  './api.cjs':{config:()=>({url:manifest.project,key:'test-private-key'}),SupabaseAPI:class{constructor(){return api;}},sleep:async()=>{}},
  './files.cjs':{...files,read:()=>manifest,save:(filename,body)=>calls.writes.push({filename,body})},
  './seed.cjs':{loadPlan:()=>plan,lock:async(batch,work)=>work(),manifestFor:(source)=>{assert.equal(source,plan);return manifest;},preflight:async(api,source)=>calls.preflight.push(source),ensureAccount:async(api,effective,state,account)=>calls.provision.push({effective,account}),pool:async(items,size,work)=>{for(const item of items)await work(item);},checkpoint:()=>{},sheet:effective=>calls.sheets.push(effective)},
  './scenarios.cjs':{scenarios:async()=>{}},
  './access.cjs':{verifyAccess:async(api,effective,state)=>{calls.access.push(effective);return{passed:true,verified_at:'2026-10-20T12:00:00Z'};}}
 });
 return{...live,calls};
}

test('seed, trial, verification and access use appearance while preflight retains the reviewed original plan',async()=>{
 for(const command of ['seed','trial','verify','access']){
  const {plan,manifest}=fixture(true),before=JSON.stringify(plan),harness=liveHarness(plan,manifest);
  await harness.run(command,{batch:plan.batch,programme:'1'});
  if(command!=='access')assert.equal(harness.calls.preflight[0],plan);
  for(const effective of harness.calls.access)assert.equal(effective.accounts[0].email,'260000001@ump.ac.za');
  for(const {effective,account}of harness.calls.provision){assert.equal(effective.plan_hash,plan.plan_hash);assert.equal(account.email,manifest.accounts[account.seed_key].appearance.email);}
  for(const email of harness.calls.logins)assert.match(email,/@ump\.ac\.za$/);
  if(command==='seed')assert.equal(harness.calls.sheets[0].accounts[0].full_name,'Lerato Mokoena');
  assert.equal(JSON.stringify(plan),before);
 }
});

test('cleanup validates appearance before remote mutations and retains tracked ownership',async()=>{
 const {plan,manifest}=fixture(),harness=liveHarness(plan,manifest);
 await harness.run('cleanup',{batch:plan.batch,execute:true});
 assert.deepEqual(harness.calls.cleanup.map(call=>call.p_execute),[false,true]);
 // The harness reads the mutable manifest; changing it after setup simulates
 // invalid stored appearance without making any filesystem or network calls.
 const original=fixture(),bad=liveHarness(original.plan,original.manifest);
 original.manifest.accounts[original.plan.accounts[0].seed_key].appearance.role='admin';
 await assert.rejects(bad.run('cleanup',{batch:original.plan.batch,execute:true}),/Appearance cannot change role/);
 assert.equal(bad.calls.cleanup.length,0);
});
