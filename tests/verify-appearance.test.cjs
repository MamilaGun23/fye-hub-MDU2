'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assertNoActiveLock,taggedPaths,signedDownload,downloadWithRetry,verifyAppearance}=require('../scripts/demo/verify-appearance.cjs');
const {pdf}=require('../scripts/demo/seed.cjs');
const clone=value=>structuredClone(value);

test('PDF downloads retry temporary rate limits and stop on permanent access errors',async()=>{
 const waits=[];let calls=0;
 const response=await downloadWithRetry(async()=>++calls<3?new Response('',{status:429,headers:{'retry-after':'2'}}):new Response('pdf',{status:200}),'https://project.example.test/private',async ms=>waits.push(ms));
 assert.equal(response.status,200);assert.equal(calls,3);assert.deepEqual(waits,[2000,2000]);
 calls=0;
 const denied=await downloadWithRetry(async()=>{calls++;return new Response('',{status:403});},'https://project.example.test/private',async()=>{});
 assert.equal(denied.status,403);assert.equal(calls,1);
});

function fixture(){
 const batch='appearance-verification',project='https://project.example.test';
 const accounts=[['admin','Nandi','Dlamini',null,null],['supervisor','Thabo','Nkosi',null,null],['mentor','Lerato','Mokoena','250000001','returning'],['student','Anele','Mahlangu','260000001','first_time'],['student','Tshepo','Ndlovu','240000001','returning']].map(([role,first,last,number,entry],index)=>({seed_key:batch+'/'+role+'/'+index,role,email:'demo.'+index+'@example.test',first_name:first,last_name:last,full_name:first+' '+last,student_number:number,faculty_id:number?'1':null,faculty:number?'Natural Sciences':'Demo staff',programme_id:number?'1':null,programme:number?'BSc':'Demo staff',study_year:entry==='first_time'?1:number?2:null,first_entry_year:number?Number('20'+number.slice(0,2)):null,entry_status:entry,academic_verified:!!number,is_active:true,presentation_login:index<4}));
 const plan={batch,version:1,plan_hash:'frozen-plan-hash',accounts},manifest={batch,project,plan_hash:plan.plan_hash,accounts:{},storage:[]},users=[],profiles=[];
 for(const [index,account]of accounts.entries()){
  const id='profile-'+index,appearance={email:account.student_number?account.student_number+'@ump.ac.za':account.first_name.toLowerCase()+'.'+account.last_name.toLowerCase()+'@ump.ac.za',first_name:account.first_name,last_name:account.last_name,full_name:account.full_name,school:account.student_number?'Natural Sciences':'Student Affairs',faculty:account.student_number?'Natural Sciences':'Student Affairs',programme:account.student_number?'BSc':'First-Year Experience'};
  manifest.accounts[account.seed_key]={id,email:appearance.email,password:'private-password-do-not-save',appearance};
  users.push({id,email:appearance.email,email_confirmed_at:'2026-10-19T10:00:00Z',app_metadata:{fye_demo_batch:batch,fye_seed_key:account.seed_key,provider:'email'},user_metadata:{...appearance,role:account.role,seed_key:account.seed_key}});
  profiles.push({id,demo_batch:batch,email:appearance.email,first_name:appearance.first_name,last_name:appearance.last_name,full_name:appearance.full_name,school:appearance.school,bio:null,role:account.role,student_number:account.student_number,programme_id:account.programme_id,faculty_id:account.faculty_id,study_year:account.study_year,first_entry_year:account.first_entry_year,entry_status:account.entry_status,is_active:true,academic_verified_at:account.student_number?'2026-10-19T10:00:00Z':null,mentor_approval_status:account.role==='mentor'?'approved':null});
 }
 const mentorId=manifest.accounts[accounts[2].seed_key].id;
 manifest.storage=[mentorId+'/demo-'+batch+'/academic.pdf',mentorId+'/demo-'+batch+'/registration.pdf'];
 const application={id:'application-1',applicant_id:mentorId,demo_batch:batch,school:'Natural Sciences',review_reason:'Approved based on academic results.',status:'approved',student_number:'250000001',academic_record_path:manifest.storage[0],registration_record_path:manifest.storage[1],updated_at:'2026-10-20T10:00:00Z'};
 const tables={mentor_applications:[application],event_requests:[{id:'request-1',demo_batch:batch,title:'Study skills workshop',purpose:'Build useful revision habits.',venue:'Seminar room',status:'pending'}],calendar_events:[{id:1,demo_batch:batch,title:'Faculty welcome session',description:'Meet your mentor.',location:'Seminar room',event_status:'completed'}],mentor_student_messages:[{id:'message-1',demo_batch:batch,body:'Welcome to FYE Hub. Please share your weekly timetable.'}],event_activity_log:[{id:'log-1',demo_batch:batch,details:{note:'Attendance recorded.',seed_key:batch+'/demo-operation',academic_record_path:manifest.storage[0]}}],mentor_application_history:[{id:1,application_id:'application-1',actor_id:'profile-1',action:'updated',created_at:'2026-10-19T10:00:00Z',snapshot:clone(application)}]};
 const backup={users:clone(users).map((user,index)=>({...user,email:accounts[index].email})),profiles:clone(profiles).map((profile,index)=>({...profile,email:accounts[index].email,school:'Prototype demonstration'}))};
 for(const [table,rows]of Object.entries(tables))backup[table]=clone(rows);
 backup.mentor_applications[0].school='Prototype demonstration';backup.mentor_application_history[0].snapshot.school='Prototype demonstration';
 const aggregate={profiles:profiles.map(profile=>({id:profile.id,email:profile.email,role:profile.role,student_number:profile.student_number,programme_id:profile.programme_id,faculty_id:profile.faculty_id,study_year:profile.study_year,first_entry_year:profile.first_entry_year,entry_status:profile.entry_status,academic_verified:!!profile.academic_verified_at,auth_link:true,auth_owned:true,email_confirmed:true,mentor_active:profile.role==='mentor',eligible_mentee:profile.entry_status==='first_time'})),records:[{table_name:'mentor_applications',count:1},{table_name:'mentor_assignments',count:24},{table_name:'mentor_appointments',count:1},{table_name:'event_notifications',count:3}],scenario_counts:{applications:1,assignments:24,events:1,attendance:1,cancellations:0,messages:1,notices:1},notification_leaks:0,cross_batch_assignments:0,capacity_violations:0,early_firstyear_approvals:0};
 const baselineReport=clone(aggregate);baselineReport.profiles.forEach((profile,index)=>profile.email=accounts[index].email);baselineReport.records.find(row=>row.table_name==='event_notifications').count=100;
 users.push({id:'unowned-user',email:'existing@ump.ac.za',app_metadata:{},user_metadata:{full_name:'Existing Person'}});profiles.push({id:'unowned-user',email:'existing@ump.ac.za',full_name:'Existing Person',demo_batch:null});
 const calls={tables:[],requests:[],logins:[],logs:[],downloads:[],saved:[],access:[]};
 const api={
  async users(){return users;},
  async table(table,filter){calls.tables.push({table,filter});if(table==='profiles')return profiles;if(table==='mentor_application_history')return tables[table];return tables[table]||[];},
  async rpc(name){assert.equal(name,'demo_batch_report');return aggregate;},
  async signIn(email,password){assert.equal(password,'private-password-do-not-save');calls.logins.push(email);return 'private-session-do-not-save';},
  async request(route,options){assert.equal(options.method,'POST');assert(route.startsWith('/storage/v1/object/sign/'));calls.requests.push({route,options});return{signedURL:route.replace('/storage/v1','')+'?token=private-signed-url-do-not-save'};}
 };
 const options={project,backup,baselineReport,log:message=>calls.logs.push(message),saveReport:report=>calls.saved.push(report),accessVerifier:async(api,effective,state,options)=>{calls.access.push(effective);assert.equal(state,manifest);await options.saveReport({passed:true});return{passed:true,checks:{student_staff_access_denied:{passed:true}},counts:{}};},fetcher:async(url)=>{calls.downloads.push(url);const kind=new URL(url).pathname.endsWith('/academic.pdf')?'Academic results summary':'Registration summary';return new Response(pdf(kind+' - '+accounts[2].full_name+' - Student number: '+accounts[2].student_number),{status:200,headers:{'content-type':'application/pdf'}});}};
 return{plan,manifest,users,profiles,tables,backup,aggregate,options,calls,api,run:()=>verifyAppearance(api,plan,manifest,options)};
}

test('read-only appearance verification checks all managed accounts, content, role access and PDFs without saving credentials',async()=>{
 const f=fixture(),before=JSON.stringify({plan:f.plan,manifest:f.manifest,users:f.users,profiles:f.profiles,tables:f.tables});
 const report=await f.run();
 assert.equal(report.passed,true,JSON.stringify(report.discrepancies));assert.equal(report.counts.managed_accounts,5);assert.equal(report.counts.unowned_auth_users,1);
 assert.equal(report.counts.active_mentors,1);assert.equal(report.counts.active_assignments,24);assert.equal(report.counts.pdf_expected,2);assert.equal(report.counts.pdf_checked,2);assert.equal(report.counts.sign_ins,5);
 assert.equal(f.calls.access.length,1);assert.match(f.calls.access[0].accounts[0].email,/@ump\.ac\.za$/);
 assert.equal(f.calls.saved.length,1);assert.equal(f.calls.saved[0],report);assert.equal(report.unowned_preservation.snapshot_available,false);
 assert.doesNotMatch(JSON.stringify(report),/private-password|private-session|private-signed-url/);
 assert.equal(JSON.stringify({plan:f.plan,manifest:f.manifest,users:f.users,profiles:f.profiles,tables:f.tables}),before,'Verification does not modify input or live records.');
 assert(f.calls.tables.some(call=>call.table==='mentor_application_history'&&call.filter.application_id==='in.(application-1)'));
 assert(f.calls.logs.some(message=>message.includes('Supporting PDFs checked: 2/2')));
});

test('verification reports ownership, email, metadata, academic and application status drift',async()=>{
 const cases=[
  {check:'managed_ownership',change:f=>f.users[0].app_metadata.fye_seed_key='wrong-key'},
  {check:'managed_email',change:f=>f.users[3].email='wrong@ump.ac.za'},
  {check:'email_unconfirmed',change:f=>f.users[3].email_confirmed_at=null},
  {check:'metadata_appearance',change:f=>f.users[0].user_metadata.school='Another school'},
  {check:'visible_profile_tag',change:f=>f.profiles[3].school='Demo school'},
  {check:'protected_profile_changed',change:f=>f.profiles[3].study_year=2},
  {check:'protected_record_changed',change:f=>f.tables.mentor_applications[0].status='declined'},
  {check:'baseline_academic_status',change:f=>f.aggregate.profiles[2].mentor_active=false},
  {check:'baseline_scenario_count',change:f=>f.aggregate.scenario_counts.assignments=23},
  {check:'visible_content_tag',change:f=>f.tables.mentor_student_messages[0].body='Fictional mentor message'},
  {check:'visible_history_tag',change:f=>f.tables.mentor_application_history[0].snapshot.review_reason='Prototype review'},
  {check:'protected_history_changed',change:f=>f.tables.mentor_application_history[0].snapshot.status='declined'}
 ];
 for(const {check,change}of cases){const f=fixture();change(f);const report=await f.run();assert.equal(report.passed,false,check);assert(report.discrepancies.some(item=>item.check===check),check);}
});

test('tag scanning preserves internal ownership, identifiers and document paths',()=>{
 assert.deepEqual(taggedPaths({demo_batch:'demo-batch',seed_key:'demo-key',academic_record_path:'id/demo-batch/academic.pdf',registration_record_path:'id/demo-batch/registration.pdf',recipient_id:'demo-id',token:'ordinary token',details:{note:'Orientation session'}}),[]);
 assert.deepEqual(taggedPaths({snapshot:{school:'Prototype school',review_reason:'Fictional review',demo_batch:'demo-batch'}}),['snapshot.school','snapshot.review_reason']);
});

test('PDF checks reject tagged, missing and cross-origin documents without disclosing signed URLs',async()=>{
 for(const scenario of ['tagged','missing','external']){
  const f=fixture();
  if(scenario==='tagged')f.options.fetcher=async()=>new Response('%PDF-1.4\nDEMO DOCUMENT',{status:200});
  if(scenario==='missing')f.options.fetcher=async()=>new Response('Missing',{status:404});
  if(scenario==='external')f.api.request=async()=>({signedURL:'https://unrelated.example.test/document?token=private-signed-url-do-not-save'});
  const report=await f.run();assert.equal(report.passed,false);assert.equal(report.counts.pdf_checked,0);
  assert(report.discrepancies.some(item=>item.check.startsWith('supporting_document_')));
  assert.doesNotMatch(JSON.stringify(report),/private-signed-url/);
 }
 const project='https://project.example.test',suffix='/object/sign/mentor-academic-records/owner/academic.pdf?token=secret';
 assert.equal(signedDownload(project,suffix),project+'/storage/v1'+suffix);
 assert.equal(signedDownload(project,'/storage/v1'+suffix),project+'/storage/v1'+suffix);
 assert.equal(signedDownload(project,project+'/storage/v1'+suffix),project+'/storage/v1'+suffix);
 assert.throws(()=>signedDownload(project,'https://elsewhere.example.test'+suffix),/unexpected document location/);
});

test('verification compares unowned users only when a pre-change snapshot exists',async()=>{
 const f=fixture();f.options.unownedUsers=[clone(f.users.at(-1))];f.options.unownedProfiles=[clone(f.profiles.at(-1))];
 f.users.at(-1).email='changed@ump.ac.za';f.profiles.at(-1).full_name='Changed Name';
 const report=await f.run();assert.equal(report.unowned_preservation.snapshot_available,true);
 assert(report.discrepancies.some(item=>item.check==='unowned_auth_changed'));assert(report.discrepancies.some(item=>item.check==='unowned_profile_changed'));
});

test('active or unknown operation locks stop verification while stale local locks remain untouched',()=>{
 const options={host:'this-machine',filesystem:{existsSync:()=>true,readFileSync:()=>JSON.stringify({host:'this-machine',pid:123})},checkProcess:()=>{}};
 assert.throws(()=>assertNoActiveLock('verification-test',options),/still active/);
 assert.throws(()=>assertNoActiveLock('verification-test',{...options,host:'different-machine'}),/another or unknown owner/);
 assert.equal(assertNoActiveLock('verification-test',{...options,checkProcess:()=>{throw Object.assign(Error('Gone'),{code:'ESRCH'});}}),'stale');
 assert.throws(()=>assertNoActiveLock('verification-test',{...options,checkProcess:()=>{throw Object.assign(Error('Denied'),{code:'EPERM'});}}),/Cannot establish/);
 assert.equal(assertNoActiveLock('verification-test',{...options,filesystem:{existsSync:()=>false}}),'absent');
});
