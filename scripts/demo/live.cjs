'use strict';
const fs=require('node:fs');
const {config,SupabaseAPI,sleep}=require('./api.cjs');
const {read,save,privatePath}=require('./files.cjs');
const {batchName}=require('./identities.cjs');
const {loadPlan,lock,manifestFor,preflight,ensureAccount,pool,checkpoint,sheet}=require('./seed.cjs');
const {scenarios}=require('./scenarios.cjs');
const {cycleAt}=require('./policy.cjs');
const {verifyAccess}=require('./access.cjs');
const {effectivePlan}=require('./appearance.cjs');
async function verify(api,plan,manifest,accounts,checkLogins=true){
 const displayed=effectivePlan(plan,manifest),byKey=new Map(displayed.accounts.map(a=>[a.seed_key,a]));
 accounts=(accounts||plan.accounts).map(a=>{const current=byKey.get(a.seed_key);if(!current)throw Error('Verification account is not in this plan: '+a.seed_key);return current;});plan=displayed;
 const report=await api.rpc('demo_batch_report',{p_batch:plan.batch});const errors=[];
 for(const a of accounts){const state=manifest.accounts[a.seed_key],p=report.profiles.find(p=>p.id===state.id);if(!p){errors.push('Missing profile: '+a.seed_key);continue;}
  if(!p.auth_link||!p.auth_owned||!p.email_confirmed||p.email!==a.email)errors.push('Auth/profile link failed: '+a.seed_key);
  if(['student','mentor'].includes(a.role)&&(p.programme_id!==a.programme_id||p.faculty_id!==a.faculty_id||p.student_number!==a.student_number||p.study_year!==a.study_year||p.entry_status!==a.entry_status||p.first_entry_year!==a.first_entry_year||!p.academic_verified))errors.push('Academic fields differ: '+a.seed_key);
  if(a.role==='mentor'&&!p.mentor_active)errors.push('Mentor appointment is not active: '+a.seed_key);
 }
 const programmes=[...new Set(accounts.filter(a=>a.role==='student').map(a=>a.programme_id))];
 for(const id of programmes){if(report.profiles.filter(p=>p.programme_id===id&&p.role==='student').length<50)errors.push('Fewer than 50 Student-role accounts in programme '+id);}
 if(report.notification_leaks||report.cross_batch_assignments||report.capacity_violations||report.early_firstyear_approvals)errors.push('Cohort/capacity/approval isolation check failed.');
 const facultyCount=new Set(accounts.filter(a=>a.role==='mentor').map(a=>a.faculty_id)).size;
 const firstTimeProgrammes=new Set(accounts.filter(a=>a.role==='student'&&a.entry_status==='first_time').map(a=>a.programme_id)).size;
 const minimum={applications:accounts.filter(a=>a.role==='mentor').length+(cycleAt(new Date()).open?3*programmes.length:0),assignments:24*firstTimeProgrammes,events:4*facultyCount,attendance:8*facultyCount,cancellations:2*facultyCount,messages:2*firstTimeProgrammes,notices:2};
 for(const [name,count]of Object.entries(minimum))if((report.scenario_counts?.[name]||0)<count)errors.push('Demo scenario missing/changed: '+name);
 const loginFailures=[];
 if(checkLogins){
  const selected=accounts.filter(a=>a.presentation_login);let checked=0;
  await pool(selected,1,async a=>{
   let failure;
   for(let attempt=0;attempt<3;attempt++){
    try{await api.signIn(a.email,manifest.accounts[a.seed_key].password);failure=null;break;}
    catch(error){failure=error;if(attempt===2||![0,429,500,502,503,504].includes(error.status))break;await sleep(1000*2**attempt);}
   }
   if(failure){errors.push('Presentation login failed: '+a.seed_key);loginFailures.push({seed_key:a.seed_key,status:failure.status??null,code:failure.code??null});}
   checked++;if(checked%10===0||checked===selected.length)console.log(`Presentation sign-ins checked: ${checked}/${selected.length}.`);
   await sleep(250);
  });
 }
 const result={verified_at:new Date().toISOString(),batch:plan.batch,counts:{profiles:report.profiles.length,programmes:programmes.length},records:report.records,errors,login_failures:loginFailures,passed:errors.length===0};
 save(plan.batch+'/verification.json',result);if(errors.length)throw Error('Verification failed. See the private verification.json report; manual edits were preserved.');return result;
}
async function run(command,options){
 const batch=batchName(options.batch),sourcePlan=loadPlan(batch),settings=config(),api=new SupabaseAPI(settings);
 return lock(batch,async()=>{
  if(command==='access'){
   const manifest=read(batch+'/manifest.json');if(manifest.project!==settings.url||manifest.plan_hash!==sourcePlan.plan_hash)throw Error('Access manifest project/plan differs.');
   const plan=effectivePlan(sourcePlan,manifest);
   const result=await verifyAccess(api,plan,manifest);if(!result.passed)throw Error('Some live access checks failed or await the directory migration. See the private access-verification.json report.');
   manifest.access_verified_at=result.verified_at;checkpoint(batch,manifest);console.log('Live dashboard access checks passed.');return;
  }
  if(command==='cleanup'){
   const manifest=read(batch+'/manifest.json');if(manifest.project!==settings.url||manifest.plan_hash!==sourcePlan.plan_hash)throw Error('Cleanup manifest project/plan differs.');
   const plan=effectivePlan(sourcePlan,manifest),trackedKeys=new Set(plan.accounts.map(a=>a.seed_key));
   const preview=await api.rpc('demo_cleanup_batch',{p_batch:batch,p_execute:false});save(batch+'/cleanup-preview.json',preview);
   console.log(`Cleanup preview saved for ${batch}: ${preview.auth_ids.length} tracked Auth accounts.`);if(!options.execute){console.log('To remove this batch, rerun with --execute.');return;}
   const ids=new Set([...preview.auth_ids,...Object.values(manifest.accounts).map(s=>s.id).filter(Boolean)]),users=await api.users();
   for(const id of preview.auth_ids){const user=users.find(u=>u.id===id),key=user?.app_metadata?.fye_seed_key,entry=key&&trackedKeys.has(key)&&manifest.accounts[key];if(!entry||user.app_metadata?.fye_demo_batch!==batch||(entry.id&&entry.id!==id))throw Error('Auth account is not tracked by this private manifest; cleanup stopped.');}
   for(const name of manifest.storage){const owner=name.split('/')[0];if(!ids.has(owner)||!name.startsWith(owner+'/demo-'+batch+'/'))throw Error('Untracked Storage path; cleanup stopped.');}
   // Database performs reference checks first, before any destructive Storage/Auth operation.
   await api.rpc('demo_cleanup_batch',{p_batch:batch,p_execute:true});
   for(let start=0;start<manifest.storage.length;start+=100)await api.request('/storage/v1/object/mentor-academic-records',{method:'DELETE',body:{prefixes:manifest.storage.slice(start,start+100)}});
   for(const id of preview.auth_ids){const user=users.find(u=>u.id===id);if(!user)continue;if(user.app_metadata?.fye_demo_batch!==batch)throw Error('Auth ownership changed; cleanup stopped.');await api.request('/auth/v1/admin/users/'+encodeURIComponent(id),{method:'DELETE',body:{should_soft_delete:false}});}
   manifest.cleaned_at=new Date().toISOString();checkpoint(batch,manifest);console.log('Tracked demo batch removed. Existing users were preserved.');return;
  }
  const manifest=manifestFor(sourcePlan,settings.url,settings.presentationPassword),plan=effectivePlan(sourcePlan,manifest);
  await preflight(api,sourcePlan);
  let accounts=plan.accounts;
  if(command==='trial'){
   if(!options.programme||!accounts.some(a=>a.programme_id===options.programme))throw Error('Trial requires --programme <catalogue ID>.');
   accounts=accounts.filter(a=>a.programme_id===options.programme||['admin','supervisor'].includes(a.role));
  }
  if(command==='verify'){const result=await verify(api,plan,manifest,accounts);const access=await verifyAccess(api,plan,manifest,{accounts});if(!access.passed)throw Error('Live dashboard access verification failed. See the private access-verification.json report.');manifest.verified_at=result.verified_at;manifest.access_verified_at=access.verified_at;manifest.completed_at ||= access.verified_at;checkpoint(batch,manifest);console.log(`Verified ${result.counts.profiles} demo profiles and live dashboard access. Private reports saved.`);return;}
  const users=await api.users();
  // Provision demo staff first; the future scenario workflows require these actors.
  const staff=accounts.filter(a=>['admin','supervisor'].includes(a.role));
  for(const a of staff)await ensureAccount(api,plan,manifest,a,users);
  const rest=accounts.filter(a=>!staff.includes(a));let completed=0;
  try{for(let start=0;start<rest.length;start+=12){const readiness=await api.rpc('demo_seed_status');if(!readiness.schema_intact)throw Error('Deployed schema changed during loading; stopped at the saved checkpoint.');await pool(rest.slice(start,start+12),3,async a=>{await ensureAccount(api,plan,manifest,a,users);completed++;});console.log(`Account progress: ${completed}/${rest.length}; checkpoint saved.`);}
   await scenarios(api,plan,manifest,accounts);
   sheet(plan,manifest);await verify(api,plan,manifest,accounts);
   const access=await verifyAccess(api,plan,manifest,{accounts});if(!access.passed)throw Error('Live dashboard access verification failed. See the private access-verification.json report.');manifest.access_verified_at=access.verified_at;
   manifest.completed_at=new Date().toISOString();checkpoint(batch,manifest);console.log('Demo population verified. Presentation credentials are in the private presentation-logins.csv file.');
  }catch(error){manifest.errors.push({at:new Date().toISOString(),message:error.message.replaceAll(settings.key,'[redacted]')});checkpoint(batch,manifest);sheet(plan,manifest);throw error;}
 });
}
module.exports={run,verify};
