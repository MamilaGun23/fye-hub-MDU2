'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const seed=require('../scripts/demo/seed.cjs');
const policy=require('../scripts/demo/policy.cjs');

// Exercise scenario requests without writing checkpoints or depending on the
// calendar date on which the test suite is run.
const checkpoint=seed.checkpoint,cycleAt=policy.cycleAt;
let scenarios;
try{
 seed.checkpoint=()=>{};
 policy.cycleAt=()=>({open:true});
 ({scenarios}=require('../scripts/demo/scenarios.cjs'));
}finally{
 seed.checkpoint=checkpoint;
 policy.cycleAt=cycleAt;
}

test('generated activity reads naturally while preserving workflow and storage ownership',async()=>{
 const batch='presentation-natural';
 const accounts=[];
 const faculty='Agriculture and Natural Sciences',programme='Bachelor of Science in Agriculture';
 for(const role of ['supervisor','admin'])accounts.push({seed_key:batch+'/staff/'+role,role,email:role+'@ump.ac.za',full_name:role==='admin'?'Nandi Dlamini':'Thabo Nkosi'});
 for(let i=0;i<2;i++)accounts.push({seed_key:batch+'/mentor/'+i,role:'mentor',full_name:i?'Anele Nkosi':'Lerato Mokoena',student_number:'25000010'+i,email:'25000010'+i+'@ump.ac.za',faculty,faculty_id:'1',programme,programme_id:'1'});
 for(let i=0;i<27;i++)accounts.push({seed_key:batch+'/student/'+i,role:'student',full_name:'Amogelang '+['Mahlangu','Mokoena','Ndlovu'][i%3],student_number:'26000'+String(i).padStart(4,'0'),email:'26000'+String(i).padStart(4,'0')+'@ump.ac.za',faculty,faculty_id:'1',programme,programme_id:'1',entry_status:i<24?'first_time':'returning'});
 const plan={batch,accounts};
 const manifest={accounts:Object.fromEntries(accounts.map((a,i)=>[a.seed_key,{id:'account-'+i,password:'local-password'}])),operations:{},storage:[]};
 const calls=[],uploads=[];
 let nextId=1;
 const api={
  async signIn(email){return email;},
  async upload(path,bytes){uploads.push({path,bytes});},
  async rpc(name,args,actor){
   calls.push({name,args,actor});
   if(name==='demo_workflow_once')return nextId++;
  },
  async table(name){return name==='event_requests'?[{calendar_event_id:500}]:[{id:700}];}
 };
 await scenarios(api,plan,manifest,accounts,()=>{});
 const workflows=calls.filter(call=>call.name==='demo_workflow_once');
 const byName=name=>workflows.filter(call=>call.args.p_rpc===name).map(call=>call.args.p_args);
 const events=byName('create_event_request');
 assert.equal(events.length,4);
 assert.equal(new Set(events.map(event=>event.p_title)).size,4,'Each event has its own meaningful title.');
 assert.equal(new Set(events.map(event=>event.p_event_date)).size,4,'Sessions have distinct dates.');
 assert.equal(byName('send_mentor_student_message').length,2);
 assert.match(byName('send_mentor_student_message')[0].p_body,/Lerato Mokoena/);
 assert.match(byName('send_mentor_student_message')[0].p_body,/Bachelor of Science in Agriculture/);
 assert.equal(byName('save_mentor_application').length,3);
 assert.equal(byName('request_event_cancellation').length,2);
 assert.equal(byName('create_notice').length,2);
 const textFields=new Set(['p_body','p_reason','p_title','p_purpose','p_venue','p_note','title','message']);
 for(const {args}of workflows)for(const [key,value]of Object.entries(args.p_args)){
  if(textFields.has(key)&&typeof value==='string')assert.doesNotMatch(value,/\b(?:demo|prototype|fictional|demonstration)\b/i,key+' should read as ordinary activity.');
 }
 assert.equal(uploads.length,10,'Mentors and returning applicants have both supporting documents.');
 for(const upload of uploads){
  assert.match(upload.path,/^account-\d+\/demo-presentation-natural\/(academic|registration)\.pdf$/,'Storage ownership stays intact.');
  assert.match(upload.bytes.toString(),/Student number: 2[56]\d{7}/);
  assert.match(upload.bytes.toString(),/(Academic results summary|Registration summary)/);
  assert.doesNotMatch(upload.bytes.toString(),/\b(?:demo|prototype|fictional|demonstration)\b/i);
 }
 assert(workflows.every(call=>call.args.p_key in manifest.operations),'Idempotency keys remain checkpointed.');
 const before={calls:calls.length,uploads:uploads.length,storage:manifest.storage.length};
 await scenarios(api,plan,manifest,accounts,()=>{});
 assert.deepEqual({calls:calls.length,uploads:uploads.length,storage:manifest.storage.length},before,'Resuming does not duplicate messages, notices, events or attachments.');
});
