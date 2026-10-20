'use strict';
const fs=require('node:fs');
const os=require('node:os');
const {config,SupabaseAPI,sleep}=require('./api.cjs');
const {read,save,privatePath}=require('./files.cjs');
const {loadPlan,pool}=require('./seed.cjs');
const {batchName}=require('./identities.cjs');
const {effectivePlan,DISPLAY_FIELDS}=require('./appearance.cjs');
const {verifyAccess}=require('./access.cjs');
const {TAG,TEXT_FIELDS}=require('./refresh-appearance.cjs');

const INTERNAL_KEY=/(?:^id$|_ids?$|_paths?$|_tokens?$|^demo_batch$|^seed_key$|^action$)/;
const PROFILE_DISPLAY=new Set(['email','full_name','first_name','last_name','school','bio','updated_at']);
const EPHEMERAL=new Set(['event_notifications','supervisor_notifications','system_notice_notifications']);
const STABLE_TABLES=['mentor_applications','event_requests','calendar_events','event_cancellation_requests','event_attendance'];
const stable=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]))):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const omit=(value,fields)=>Object.fromEntries(Object.entries(value||{}).filter(([key])=>!fields.has(key)));

function assertNoActiveLock(batch,{filesystem=fs,host=os.hostname(),checkProcess=pid=>process.kill(pid,0)}={}){
 const filename=privatePath(batch+'/operation.lock');
 if(!filesystem.existsSync(filename))return 'absent';
 let owner;try{owner=JSON.parse(filesystem.readFileSync(filename,'utf8'));}catch{throw Error('Cannot inspect the batch operation lock.');}
 if(owner.host!==host||!Number.isInteger(owner.pid)||owner.pid<=0)throw Error('A batch operation lock belongs to another or unknown owner.');
 try{checkProcess(owner.pid);}catch(error){if(error.code==='ESRCH')return 'stale';throw Error('Cannot establish that the batch operation lock is inactive.');}
 throw Error('A batch operation is still active. Run appearance verification after it finishes.');
}

function taggedPaths(value,path='',result=[]){
 if(typeof value==='string'){if(TAG.test(value))result.push(path);return result;}
 if(Array.isArray(value)){value.forEach((item,index)=>taggedPaths(item,path+'['+index+']',result));return result;}
 if(value&&typeof value==='object')for(const [key,item]of Object.entries(value))if(!INTERNAL_KEY.test(key))taggedPaths(item,path?path+'.'+key:key,result);
 return result;
}

function signedDownload(project,signed){
 if(typeof signed!=='string'||!signed)throw Error('Storage did not return a signed document URL.');
 const base=new URL(project),route=/^https?:\/\//.test(signed)?signed:signed.startsWith('/storage/v1/')?signed:'/storage/v1/'+signed.replace(/^\//,'');
 const resolved=new URL(route,base);
 if(resolved.origin!==base.origin||resolved.username||resolved.password||!resolved.pathname.startsWith('/storage/v1/object/sign/mentor-academic-records/'))throw Error('Storage returned an unexpected document location.');
 return resolved.href;
}

async function downloadWithRetry(fetcher,url,wait=sleep){
 for(let attempt=0;;attempt++){
  let response;
  try{response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(30000)});}
  catch{if(attempt>=3)throw Error('Supporting document download failed.');await wait(500*2**attempt);continue;}
  if(![429,502,503,504].includes(response.status)||attempt>=3)return response;
  const requested=Number(response.headers?.get('retry-after'))*1000;
  await response.body?.cancel();
  await wait(Math.min(30000,Math.max(500*2**attempt,Number.isFinite(requested)?requested:0)));
 }
}

async function verifyAppearance(api,sourcePlan,manifest,{project=manifest.project,backup,baselineReport,unownedUsers,unownedProfiles,allPresentation=false,log=console.log,fetcher=fetch,accessVerifier=verifyAccess,saveReport}={}){
 if(manifest.project!==project||manifest.plan_hash!==sourcePlan.plan_hash||manifest.batch!==sourcePlan.batch)throw Error('Appearance verification manifest project or frozen plan differs.');
 const plan=effectivePlan(sourcePlan,manifest),report={started_at:new Date().toISOString(),batch:plan.batch,plan_hash:sourcePlan.plan_hash,counts:{},discrepancies:[],checks:{},unowned_preservation:{snapshot_available:!!(unownedUsers||unownedProfiles)}};
 const add=(check,details={})=>report.discrepancies.push({check,...details});
 const failure=(check,error,details={})=>add(check,{...details,status:error?.status??null,code:error?.code??'CHECK_FAILED'});
 async function finish(){report.verified_at=new Date().toISOString();report.passed=report.discrepancies.length===0;if(saveReport)await saveReport(report);log(`Appearance verification ${report.passed?'passed':'found discrepancies'}: ${report.counts.managed_accounts||0} managed accounts, ${report.counts.visible_rows||0} visible records, ${report.counts.pdf_checked||0} attachments; ${report.discrepancies.length} discrepancies.`);return report;}
 let users,profiles;
 try{[users,profiles]=await Promise.all([api.users(),api.table('profiles',{})]);}
 catch(error){failure('inventory_read',error);return finish();}
 report.counts.auth_users=users.length;report.counts.profiles=profiles.length;report.counts.managed_accounts=plan.accounts.length;
 const byUser=new Map(users.map(user=>[user.id,user])),byProfile=new Map(profiles.map(profile=>[profile.id,profile])),managed=new Set(plan.accounts.map(a=>manifest.accounts[a.seed_key].id));
 const oldUsers=new Map((backup?.users||[]).map(user=>[user.id,user])),oldProfiles=new Map((backup?.profiles||[]).map(profile=>[profile.id,profile]));
 report.counts.unowned_auth_users=users.filter(user=>!managed.has(user.id)).length;report.counts.unowned_profiles=profiles.filter(profile=>!managed.has(profile.id)).length;
 if(managed.size!==plan.accounts.length||managed.has(undefined))add('managed_manifest_ids');
 if(!backup?.users||!backup?.profiles)add('managed_backup_missing');
 log(`Inventory loaded: ${users.length} Auth users, ${profiles.length} profiles; checking ${plan.accounts.length} managed accounts.`);
 for(const [index,account]of plan.accounts.entries()){
  const state=manifest.accounts[account.seed_key],user=byUser.get(state.id),profile=byProfile.get(state.id),originalUser=oldUsers.get(state.id),originalProfile=oldProfiles.get(state.id);
  if(!user||!profile){add('managed_account_missing',{id:state.id});continue;}
  if(user.app_metadata?.fye_demo_batch!==plan.batch||user.app_metadata?.fye_seed_key!==account.seed_key||profile.demo_batch!==plan.batch)add('managed_ownership',{id:state.id});
  if(!originalUser||!originalProfile)add('managed_backup_account_missing',{id:state.id});
  if(originalUser&&!same(user.app_metadata,originalUser.app_metadata))add('protected_app_metadata_changed',{id:state.id});
  if(user.email!==account.email||profile.email!==account.email)add('managed_email',{id:state.id});
  if(!user.email_confirmed_at)add('email_unconfirmed',{id:state.id});
  if(['student','mentor'].includes(account.role)&&(user.email!==account.student_number+'@ump.ac.za'||profile.student_number!==account.student_number))add('student_number_email',{id:state.id});
  const appearance=state.appearance||{};
  for(const field of ['full_name','first_name','last_name','school','bio'])if(Object.hasOwn(appearance,field)&&profile[field]!==appearance[field])add('profile_appearance',{id:state.id,field});
  for(const field of DISPLAY_FIELDS){
   if(Object.hasOwn(appearance,field)&&user.user_metadata?.[field]!==appearance[field])add('metadata_appearance',{id:state.id,field});
   if(typeof profile[field]==='string'&&TAG.test(profile[field]))add('visible_profile_tag',{id:state.id,field});
   if(typeof user.user_metadata?.[field]==='string'&&TAG.test(user.user_metadata[field]))add('visible_metadata_tag',{id:state.id,field});
  }
  if(originalProfile&&!same(omit(profile,PROFILE_DISPLAY),omit(originalProfile,PROFILE_DISPLAY)))add('protected_profile_changed',{id:state.id,fields:Object.keys(originalProfile).filter(field=>!PROFILE_DISPLAY.has(field)&&!same(profile[field],originalProfile[field]))});
  if((index+1)%100===0||index+1===plan.accounts.length)log(`Managed identities verified: ${index+1}/${plan.accounts.length}.`);
 }
 for(const user of users)if(user.app_metadata?.fye_demo_batch===plan.batch&&!managed.has(user.id))add('unexpected_marked_auth',{id:user.id});
 for(const profile of profiles)if(profile.demo_batch===plan.batch&&!managed.has(profile.id))add('unexpected_marked_profile',{id:profile.id});
 for(const user of unownedUsers||[])if(!byUser.has(user.id)||byUser.get(user.id).email!==user.email)add('unowned_auth_changed',{id:user.id});
 for(const profile of unownedProfiles||[])if(!byProfile.has(profile.id)||!same(profile,byProfile.get(profile.id)))add('unowned_profile_changed',{id:profile.id});
 if(!report.unowned_preservation.snapshot_available)report.unowned_preservation.limitation='No pre-change unowned snapshot exists; exact before/after values cannot be compared.';
 report.checks.identities=!report.discrepancies.length;

 let liveReport;
 try{
  liveReport=await api.rpc('demo_batch_report',{p_batch:plan.batch});
  if(!baselineReport)add('aggregate_baseline_missing');
  else{
   const liveById=new Map((liveReport.profiles||[]).map(profile=>[profile.id,profile]));
   for(const profile of baselineReport.profiles||[])if(!same(omit(profile,new Set(DISPLAY_FIELDS)),omit(liveById.get(profile.id),new Set(DISPLAY_FIELDS))))add('baseline_academic_status',{id:profile.id});
   if(liveById.size!==(baselineReport.profiles||[]).length)add('baseline_profile_count');
   for(const [field,value]of Object.entries(baselineReport.scenario_counts||{}))if(liveReport.scenario_counts?.[field]!==value)add('baseline_scenario_count',{field});
   const counts=new Map((liveReport.records||[]).map(row=>[row.table_name,Number(row.count)]));
   for(const row of baselineReport.records||[])if(!EPHEMERAL.has(row.table_name)&&counts.get(row.table_name)!==Number(row.count))add('baseline_record_count',{table:row.table_name});
  }
  for(const field of ['notification_leaks','cross_batch_assignments','capacity_violations','early_firstyear_approvals'])if(Number(liveReport[field]||0)!==0)add('cohort_integrity',{field});
  report.counts.active_mentors=(liveReport.profiles||[]).filter(profile=>profile.mentor_active).length;
  report.counts.active_assignments=liveReport.scenario_counts?.assignments;
  log(`Academic/status report checked: ${report.counts.active_mentors} active mentors, ${report.counts.active_assignments} active assignments.`);
 }catch(error){failure('aggregate_read',error);}

 const tables={};report.counts.visible_rows=0;
 for(const [table,fields]of Object.entries(TEXT_FIELDS)){
  try{
   const rows=await api.table(table,{demo_batch:'eq.'+plan.batch});tables[table]=rows;report.counts.visible_rows+=rows.length;
   for(const row of rows){
    if(row.demo_batch!==plan.batch)add('visible_scope',{table,id:row.id});
    for(const field of fields)for(const fieldPath of taggedPaths(row[field],field))add('visible_content_tag',{table,id:row.id,field:fieldPath});
   }
   if(STABLE_TABLES.includes(table)){
    const byId=new Map(rows.map(row=>[String(row.id),row])),excluded=new Set([...fields,'updated_at']);
    for(const row of backup?.[table]||[])if(!same(omit(row,excluded),omit(byId.get(String(row.id)),excluded)))add('protected_record_changed',{table,id:row.id});
   }
   log(`Visible content scanned: ${table}, ${rows.length} records (${report.counts.visible_rows} total).`);
  }catch(error){failure('visible_table_read',error,{table});}
 }
 const applications=(tables.mentor_applications||[]).map(row=>row.id),history=[];
 try{
  for(let start=0;start<applications.length;start+=50){history.push(...await api.table('mentor_application_history',{application_id:`in.(${applications.slice(start,start+50).join(',')})`}));log(`Application history scanned: ${Math.min(start+50,applications.length)}/${applications.length} applications.`);}
  const applicationIds=new Set(applications.map(String));
  for(const row of history){if(!applicationIds.has(String(row.application_id)))add('history_scope',{id:row.id});for(const field of taggedPaths(row.snapshot,'snapshot'))add('visible_history_tag',{id:row.id,field});}
  const byId=new Map(history.map(row=>[String(row.id),row]));
  for(const row of backup?.mentor_application_history||[]){const current=byId.get(String(row.id)),excluded=new Set(['school','review_reason','updated_at']);if(!current||!same(omit(row,new Set(['snapshot'])),omit(current,new Set(['snapshot'])))||!same(omit(row.snapshot,excluded),omit(current.snapshot,excluded)))add('protected_history_changed',{id:row.id});}
  report.counts.history_rows=history.length;report.counts.visible_rows+=history.length;
 }catch(error){failure('history_read',error);}

 const selected=[];
 for(const role of ['admin','supervisor','mentor','student']){const account=plan.accounts.find(a=>a.role===role&&(role!=='student'||a.entry_status==='first_time'))||plan.accounts.find(a=>a.role===role);if(account)selected.push(account);else add('sign_in_role_missing',{role});}
 const returning=plan.accounts.find(a=>a.role==='student'&&a.entry_status==='returning');if(returning)selected.push(returning);else add('returning_student_missing');
 if(allPresentation)selected.push(...plan.accounts.filter(a=>a.presentation_login));
 const signIns=[...new Map(selected.map(a=>[a.seed_key,a])).values()];report.counts.sign_ins=0;
 for(const account of signIns){try{await api.signIn(account.email,manifest.accounts[account.seed_key].password);report.counts.sign_ins++;}catch(error){failure('sign_in',error,{id:manifest.accounts[account.seed_key].id,role:account.role});}log(`Selected sign-ins checked: ${report.counts.sign_ins}/${signIns.length}.`);}
 try{report.access=await accessVerifier(api,plan,manifest,{log,saveReport:()=>{}});if(!report.access.passed)add('real_role_access');}
 catch(error){failure('real_role_access',error);}

 report.counts.pdf_expected=manifest.storage.length;report.counts.pdf_checked=0;
 const seen=new Set(),accountById=new Map(plan.accounts.map(a=>[manifest.accounts[a.seed_key].id,a]));let pdfFinished=0;
 if(manifest.storage.length<2*plan.accounts.filter(a=>a.role==='mentor').length)add('supporting_document_count');
 await pool(manifest.storage,3,async name=>{
  const owner=name.split('/')[0],account=accountById.get(owner),kind=name.endsWith('/academic.pdf')?'Academic results summary':name.endsWith('/registration.pdf')?'Registration summary':null;
  try{
   if(!account||!kind||!name.startsWith(owner+'/demo-'+plan.batch+'/')||seen.has(name)){add('supporting_document_ownership',{id:owner});return;}seen.add(name);
   const signed=await api.request('/storage/v1/object/sign/mentor-academic-records/'+name.split('/').map(encodeURIComponent).join('/'),{method:'POST',body:{expiresIn:60}});
   const url=signedDownload(project,signed?.signedURL||signed?.signedUrl),response=await downloadWithRetry(fetcher,url);
   if(response.status!==200){add('supporting_document_http',{id:owner,status:response.status});return;}
   const source=Buffer.from(await response.arrayBuffer()).toString('utf8');
   const label=account.full_name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'?').replace(/([()\\])/g,'\\$1');
   if(!source.startsWith('%PDF-')||!source.includes('FYE Hub supporting document')||!source.includes(kind)||!source.includes(label)||!source.includes('Student number: '+account.student_number)||TAG.test(source))add('supporting_document_content',{id:owner,kind});
   else report.counts.pdf_checked++;
  }catch(error){failure('supporting_document_read',error,{id:owner,kind});}
  finally{pdfFinished++;if(pdfFinished%10===0||pdfFinished===manifest.storage.length)log(`Supporting PDFs checked: ${pdfFinished}/${manifest.storage.length} (${report.counts.pdf_checked} passed).`);}
 });
 return finish();
}

async function run(batch,{allPresentation=false,log=console.log}={}){
 batch=batchName(batch);assertNoActiveLock(batch);
 const sourcePlan=loadPlan(batch),manifest=read(batch+'/manifest.json'),settings=config();
 if(manifest.project!==settings.url||manifest.plan_hash!==sourcePlan.plan_hash)throw Error('Appearance verification manifest project or frozen plan differs.');
 const optional=name=>fs.existsSync(privatePath(batch+'/'+name))?read(batch+'/'+name):undefined;
 const backup=optional('appearance-refresh-backup.json'),inventory=optional('account-refresh-inventory.json');
 return verifyAppearance(new SupabaseAPI(settings),sourcePlan,manifest,{project:settings.url,backup,baselineReport:inventory?.report,unownedUsers:inventory?.unowned_users,unownedProfiles:inventory?.unowned_profiles,allPresentation,log,saveReport:report=>{assertNoActiveLock(batch);return save(batch+'/appearance-verification.json',report);}});
}

if(require.main===module){const {values}=require('node:util').parseArgs({options:{batch:{type:'string'},'all-presentation':{type:'boolean'}}});run(values.batch,{allPresentation:!!values['all-presentation']}).then(report=>{if(!report.passed)process.exitCode=1;}).catch(()=>{console.error('Appearance verification could not complete. Check the local batch lock, configuration and private manifest.');process.exitCode=1;});}
module.exports={assertNoActiveLock,taggedPaths,signedDownload,downloadWithRetry,verifyAppearance,run};
