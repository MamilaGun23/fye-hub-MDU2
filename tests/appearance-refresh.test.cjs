const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {accountChange,prepare,patchRows,cleanObject,cleanText,execute}=require('../scripts/demo/refresh-appearance.cjs');
const {privatePath}=require('../scripts/demo/files.cjs');

function fixture(batch='test-batch'){
 const account={seed_key:batch+'/programme/1/student/1',role:'student',student_number:'260000001',email:'demo.'+batch+'.student@example.test',first_name:'Lerato',last_name:'Mokoena',full_name:'Lerato Mokoena',faculty_id:'1',faculty:'Faculty of Science',programme:'Biology',presentation_login:true};
 const state={id:'u1',email:account.email,password:'unchanged-password'};
 const user={id:'u1',email:account.email,user_metadata:{...account},app_metadata:{fye_demo_batch:batch,fye_seed_key:account.seed_key}};
 const profile={id:'u1',role:'student',student_number:account.student_number,email:account.email,full_name:account.full_name,first_name:account.first_name,last_name:account.last_name,school:'Prototype demonstration',demo_batch:batch,study_year:1,academic_verified_at:'2026-10-01'};
 const plan={batch,plan_hash:'frozen-hash',accounts:[account]};const manifest={project:'https://project.test',plan_hash:plan.plan_hash,accounts:{[account.seed_key]:state},storage:[]};
 return {account,state,user,profile,plan,manifest,batch};
}

test('refresh proposes exact student email and faculty school while preserving registration and ownership',()=>{
 const f=fixture();const change=accountChange(f.account,f.state,f.user,f.profile,f.batch);
 assert.equal(change.email,'260000001@ump.ac.za');assert.equal(change.patch.school,'Faculty of Science');
 assert.equal(change.patch.study_year,undefined);assert.equal(change.patch.student_number,undefined);
 assert.equal(change.metadata.seed_key,f.account.seed_key);
 assert.equal(change.metadata.app_metadata,undefined);
 assert.throws(()=>accountChange(f.account,f.state,{...f.user,app_metadata:{}},f.profile,f.batch),/ownership/);
 assert.throws(()=>accountChange(f.account,f.state,f.user,{...f.profile,student_number:'260000002'},f.batch),/registration/);
});

test('refresh refuses an existing email collision before any content read or write',async()=>{
 const f=fixture();let contentRead=false;
 const api={users:async()=>[f.user,{id:'real-user',email:'260000001@ump.ac.za'}],table:async table=>{assert.equal(table,'profiles');return[f.profile];}};
 await assert.rejects(prepare(api,f.plan,f.manifest,f.manifest.project),/belongs to another/);
 assert.equal(contentRead,false);
});

test('visible text cleanup preserves internal ownership paths and rejects unknown tags',()=>{
 const before={school:'Faculty of Science',review_reason:'Fictional review: strengthen the supporting academic statement before resubmitting.',academic_record_path:'u1/demo-test-batch/academic.pdf',demo_batch:'test-batch'};
 const after=cleanObject(before);
 assert.equal(after.academic_record_path,before.academic_record_path);assert.equal(after.demo_batch,before.demo_batch);
 assert.equal(after.review_reason,'Please strengthen your supporting academic statement before resubmitting.');
 assert.equal(cleanText('New approved event: Demo: Science approved workshop'),'New approved event: Science study skills workshop');
 assert.throws(()=>cleanText('An unknown prototype label'),/Unmapped/);
});

test('content patches group identical text and scope every update to owned IDs and batch',async()=>{
 const calls=[],api={request:async(route,args)=>{calls.push({route,args});return[{id:'n1'},{id:'n2'}];}};
 const progress={content:[]};let saved=0;
 const changes=[{id:'n1',patch:{title:'University update'}},{id:'n2',patch:{title:'University update'}}];
 await patchRows(api,'system_notice_notifications',changes,'test-batch',progress,()=>saved++);
 assert.equal(calls.length,1);assert.equal(saved,1);
 const url=new URL(calls[0].route,'https://project.test');
 assert.equal(url.searchParams.get('demo_batch'),'eq.test-batch');assert.equal(url.searchParams.get('id'),'in.(n1,n2)');
 await patchRows(api,'system_notice_notifications',changes,'test-batch',progress,()=>saved++);
 assert.equal(calls.length,1);
});

test('execution updates Auth/profile together without resetting passwords and resumes once',async t=>{
 const batch='appearance-test-'+crypto.randomBytes(4).toString('hex'),f=fixture(batch),dir=privatePath(batch);
 fs.mkdirSync(dir,{recursive:true});t.after(()=>{assert(dir.startsWith(path.resolve(__dirname,'../.demo-seed')+path.sep+'appearance-test-'));fs.rmSync(dir,{recursive:true,force:true});});
 const change=accountChange(f.account,f.state,f.user,f.profile,batch),calls=[];
 const api={users:async()=>[f.user],request:async(route,args)=>{
  calls.push({route,args});
  if(route.startsWith('/auth/'))return {...f.user,email:args.body.email};
  assert(route.startsWith('/rest/v1/profiles?'));assert.equal(args.body.role,undefined);
  return[{id:'u1',email:args.body.email}];
 }};
 const preview={batch,project:f.manifest.project,plan_hash:f.plan.plan_hash,accounts:[change],content:{},storage:[]};
 const progress={accounts:[],content:[],storage:[]};
 await execute(api,f.plan,f.manifest,preview,progress,()=>{});
 assert.equal(calls[0].args.body.password,undefined);assert.equal(calls[0].args.body.email_confirm,true);
 assert.equal(f.state.password,'unchanged-password');assert.equal(f.state.email,'260000001@ump.ac.za');assert.equal(f.state.appearance.email,f.state.email);
 assert.equal(f.plan.accounts[0].email,'demo.'+batch+'.student@example.test');
 await execute(api,f.plan,f.manifest,preview,progress,()=>{});assert.equal(calls.length,2);
});

test('past event requests and invalid appearance stop execution before identity writes',async()=>{
 const f=fixture(),change=accountChange(f.account,f.state,f.user,f.profile,f.batch);
 const preview={batch:f.batch,project:f.manifest.project,plan_hash:f.plan.plan_hash,accounts:[change],content:{event_requests:[{id:'past',patch:{title:'Study planning'}}]},storage:[]};
 let writes=0;
 const api={users:async()=>[f.user],table:async()=>[{id:'past',event_date:'2020-01-01',event_time:'12:00:00'}],request:async()=>{writes++;}};
 await assert.rejects(execute(api,f.plan,f.manifest,preview,{accounts:[],content:[],storage:[]}),/past its editable date/);
 assert.equal(writes,0);
 const invalid={...preview,accounts:[{...change,appearance:{...change.appearance,role:'admin'}}]};
 await assert.rejects(execute(api,f.plan,f.manifest,invalid,{accounts:[],content:[],storage:[]}),/cannot change role/);
 assert.equal(writes,0);
});
