'use strict';
const assert=require('node:assert/strict');
const {save}=require('./files.cjs');

// Exercise the same JWT/RLS paths as the browser. Data counts alone cannot
// establish that the application can read its seeded records.
async function verifyAccess(api,plan,manifest,{accounts=plan.accounts,log=console.log,saveReport}={}){
 const checks={},counts={},tokens={};let readiness,student,mentor,matches=[];
 async function step(name,work,ready=true,blockedBy='sign_in'){
  if(!ready){checks[name]={passed:false,blocked_by:blockedBy};log(`Access check ${name}: blocked (${blockedBy}).`);return;}
  try{await work();checks[name]={passed:true};log(`Access check ${name}: passed.`);}
  catch(error){checks[name]={passed:false,status:error.status??null,code:error.code??'CHECK_FAILED'};log(`Access check ${name}: failed (see private report).`);}
 }
 const id=a=>manifest.accounts[a.seed_key]?.id;
 async function login(role){const a=accounts.find(a=>a.role===role);assert(a&&id(a),'A tracked demo actor is required.');tokens[role]=await api.signIn(a.email,manifest.accounts[a.seed_key].password);}
 await step('installed_contract',async()=>{
  readiness=await api.rpc('demo_seed_status');
  assert(readiness.version===2&&readiness.academic_rules&&readiness.workflows&&readiness.demo_isolation&&readiness.schema_intact&&readiness.directory_reads,'The full current migration contract is required.');
 });
 for(const role of ['admin','supervisor'])await step(role+'_sign_in',()=>login(role));
 await step('analytics_details',async()=>{
  const totals=await api.rpc('get_admin_analytics',{p_period_days:0},tokens.admin);counts.analytics={};
  for(const [metric,field]of Object.entries({students:'active_students',mentors:'active_mentors',eligible:'eligible_mentees',unassigned:'unassigned_mentees',awaiting:'awaiting_results',assignments:'active_assignments',disabled:'disabled_profiles',events:'events_in_period',upcoming:'upcoming_events',notices:'active_notices'})){
   const rows=await api.rpc('get_admin_analytics_details',{p_metric:metric,p_period_days:0},tokens.admin);
   assert(Array.isArray(rows));assert.equal(rows.length,Number(totals[field]),'Analytics details must match their total.');counts.analytics[metric]=rows.length;
  }
 },!!tokens.admin);
 await step('student_sign_in',async()=>{
  student=accounts.find(a=>a.role==='student'&&a.entry_status==='first_time')||accounts.find(a=>a.role==='student');
  assert(student&&id(student));tokens.student=await api.signIn(student.email,manifest.accounts[student.seed_key].password);
 });
 await step('student_active_match',async()=>{
  matches=await api.request('/rest/v1/active_mentor_assignments?select=id,mentor_id&student_id=eq.'+encodeURIComponent(id(student)),{token:tokens.student});
  assert.equal(matches.length,student.entry_status==='first_time'?1:0);counts.student_matches=matches.length;
 },!!tokens.student);
 await step('mentor_sign_in_and_authority',async()=>{
  mentor=matches.length?accounts.find(a=>id(a)===matches[0].mentor_id):accounts.find(a=>a.role==='mentor');
  assert(mentor&&id(mentor));tokens.mentor=await api.signIn(mentor.email,manifest.accounts[mentor.seed_key].password);
  assert.equal(await api.rpc('mentor_application_is_approved',{p_profile_id:id(mentor)},tokens.mentor),true);
 },checks.student_active_match?.passed===true,'student_active_match');
 await step('student_staff_access_denied',async()=>{
  async function denied(work,expected){let error;try{await work();}catch(e){error=e;}assert(error&&expected(error),'Expected an explicit permission rejection, not a timeout or network failure.');}
  await denied(()=>api.rpc('get_admin_analytics',{p_period_days:0},tokens.student),e=>e.code==='P0001'&&/admin.*access/i.test(e.message));
  await denied(()=>api.rpc('demo_seed_status',{},tokens.student),e=>e.status===403&&e.code==='42501');
 },!!tokens.student);
 await step('supervisor_evidence',async()=>{
  const prefix=id(mentor)+'/demo-'+plan.batch+'/',document=manifest.storage.find(name=>name.startsWith(prefix));assert(document,'Tracked mentor evidence is required.');
  const signed=await api.request('/storage/v1/object/sign/mentor-academic-records/'+document.split('/').map(encodeURIComponent).join('/'),{method:'POST',body:{expiresIn:60},token:tokens.supervisor});
  assert(signed.signedURL||signed.signedUrl,'Supervisor must be able to open mentor evidence.');
 },!!tokens.supervisor&&!!tokens.mentor);
 const readsReady=readiness?.directory_reads===true&&readiness?.schema_intact===true;
 for(const role of ['student','mentor'])await step(role+'_faculty_calendar',async()=>{
  const actor=role==='student'?student:mentor;
  const rows=await api.request('/rest/v1/calendar_events?select=id,faculty_id,demo_batch,event_status',{token:tokens[role]});
  const demo=rows.filter(e=>e.demo_batch===plan.batch);assert(demo.length>0,'Demo faculty events must be visible.');
  assert(demo.every(e=>String(e.faculty_id)===String(actor.faculty_id)&&e.event_status!=='cancelled'),'Only own-faculty, non-cancelled demo events may be visible.');counts[role+'_faculty_events']=demo.length;
 },readsReady&&!!tokens[role],readsReady?'sign_in':'directory_migration');
 for(const role of ['admin','supervisor'])await step(role+'_directory',async()=>{
  const seen=new Set();let offset=0;
  for(;;){assert(offset<100000,'Directory inventory limit exceeded.');const rows=await api.request('/rest/v1/profiles?select=id&order=id.asc&limit=500&offset='+offset,{token:tokens[role]});assert(Array.isArray(rows));if(!rows.length)break;for(const row of rows)seen.add(row.id);offset+=rows.length;}
  assert(accounts.every(a=>id(a)&&seen.has(id(a))),'Staff directory must include every tracked demo account.');counts[role+'_profiles']=seen.size;
 },readsReady&&!!tokens[role],readsReady?'sign_in':'directory_migration');
 const report={verified_at:new Date().toISOString(),batch:plan.batch,passed:Object.values(checks).every(c=>c.passed),checks,counts};
 if(saveReport)await saveReport(report);else save(plan.batch+'/access-verification.json',report);
 return report;
}
module.exports={verifyAccess};
