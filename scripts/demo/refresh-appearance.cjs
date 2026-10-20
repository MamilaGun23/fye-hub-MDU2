'use strict';
const {config,SupabaseAPI}=require('./api.cjs');
const {read,save,privatePath,digest,csv}=require('./files.cjs');
const {loadPlan,lock,pool,checkpoint,sheet,pdf}=require('./seed.cjs');
const fs=require('node:fs');
const {effectivePlan}=require('./appearance.cjs');

const TAG=/\bdemo\b|prototype|fictional|synthetic|demonstration/i;
const TEXT_FIELDS={
 event_requests:['title','purpose','venue','supervisor_note'],
 calendar_events:['title','description','location','cancellation_reason','completion_note','mentor_outcome'],
 event_notifications:['title','message'],supervisor_notifications:['title','message'],
 system_notices:['title','message'],system_notice_notifications:['title','message'],
 mentor_student_messages:['body'],event_cancellation_requests:['reason','review_note'],
 mentor_applications:['school','review_reason'],event_attendance:['correction_reason'],
 event_activity_log:['details']
};
const REPLACEMENTS=[
 ['Fictional university update for the prototype presentation. Visible only to the generated demo cohort.','Welcome to FYE Hub. Check your mentor messages, upcoming faculty events and support resources regularly.'],
 ['Fictional expired notice retained for the notice-expiry demonstration.','The orientation registration period has closed. Contact your FYE coordinator if you need assistance.'],
 ['This fictional demo message introduces your mentor.','I am your assigned mentor and look forward to supporting you.'],
 ['Fictional faculty study and orientation workshop for the prototype presentation.','A faculty workshop on study planning, campus resources and academic support.'],
 ['Fictional historical attendance scenario','A faculty workshop on study planning and academic support.'],
 ['Fictional historical demonstration record','Attendance recorded by the supervisor at the workshop.'],
 ['Fictional demonstration: the venue is unavailable.','The venue is unavailable. An alternative date will be shared.'],
 ['Fictional demonstration: venue unavailable.','The venue is unavailable. An alternative date will be shared.'],
 ['Fictional review: strengthen the supporting academic statement before resubmitting.','Please strengthen your supporting academic statement before resubmitting.'],
 ['Demo supervisor approval','Approved for the proposed date and venue.'],
 ['Demo cancellation approved','Cancellation approved. Please notify the affected students.'],
 ['Demo faculty seminar room','Faculty seminar room'],['Demo seminar room','Seminar room'],
 ['Demo: completed faculty study workshop','Study skills and academic planning workshop'],
 ['Demo: Welcome to FYE Hub','University update'],['Demo: Expired orientation notice','Application updates']
];

function cleanText(value){
 if(typeof value!=='string')return value;
 let text=value;
 for(const [from,to]of REPLACEMENTS)text=text.split(from).join(to);
 text=text.replace(/Demo:\s*/gi,'').replace(/\s+cancellation-pending workshop/gi,' peer support workshop')
  .replace(/\s+approved workshop/gi,' study skills workshop').replace(/\s+pending workshop/gi,' academic planning workshop')
  .replace(/\s+cancelled workshop/gi,' campus resources workshop');
 if(TAG.test(text))throw Error('Unmapped visible label; review the private preview before applying.');
 return text;
}

function cleanObject(value){
 if(Array.isArray(value))return value.map(cleanObject);
 if(!value||typeof value!=='object')return typeof value==='string'?cleanText(value):value;
 return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
  /(?:^id$|_id$|_path$|_token$|^demo_batch$|^seed_key$|^action$)/.test(key)?item:cleanObject(item)]));
}

function accountChange(account,state,user,profile,batch){
 if(!state?.id||user?.id!==state.id||profile?.id!==state.id||profile.demo_batch!==batch
  ||user.app_metadata?.fye_demo_batch!==batch||user.app_metadata?.fye_seed_key!==account.seed_key)throw Error('Account ownership differs from the private manifest.');
 const numbered=['student','mentor'].includes(profile.role);
 if(numbered&&(!/^\d{9}$/.test(profile.student_number)||profile.student_number!==account.student_number))throw Error('Student registration differs from the frozen plan.');
 const name=TAG.test(profile.full_name||'')?account.full_name:profile.full_name;
 const first=TAG.test(profile.first_name||'')?account.first_name:profile.first_name||account.first_name;
 const last=TAG.test(profile.last_name||'')?account.last_name:profile.last_name||account.last_name;
 const staffLocal=[first,last].join('.').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9.]/g,'');
 const email=numbered?`${profile.student_number}@ump.ac.za`:`${staffLocal}@ump.ac.za`;
 const school=TAG.test(profile.school||'')?(account.faculty_id?account.faculty:'Student Affairs'):profile.school;
 const appearance={email,full_name:cleanText(name),first_name:cleanText(first),last_name:cleanText(last),school};
 if(!account.faculty_id){appearance.faculty='Student Affairs';appearance.programme='First-Year Experience';}
 if(TAG.test(profile.bio||''))appearance.bio=profile.role==='mentor'?'I support first-year students with study planning, campus life and academic resources.':'Looking forward to learning, meeting new people and making the most of university life.';
 const patch=Object.fromEntries(Object.entries(appearance).filter(([key,value])=>!['faculty','programme'].includes(key)&&value!==profile[key]));
 const metadata={...user.user_metadata,...appearance,role:profile.role};
 return {key:account.seed_key,id:profile.id,email,previous_email:user.email,appearance,patch,metadata};
}

function contentChanges(table,rows,profiles,accounts){
 const pMap=new Map(profiles.map(p=>[p.id,p]));
 return rows.flatMap(row=>{
  const patch={};
  for(const field of TEXT_FIELDS[table]||[]){
   const old=row[field];if(old==null)continue;
   let value;
   if(field==='school'&&TAG.test(old))value=pMap.get(row.applicant_id)?.school;
   else value=typeof old==='object'?cleanObject(old):cleanText(old);
   if(field==='body'&&typeof old==='string'&&TAG.test(old)){
    const mentor=pMap.get(row.mentor_id);if(mentor)value=`Hi, I am ${mentor.full_name}, your assigned mentor. Welcome to FYE Hub. We can discuss study planning, campus resources and any questions about your first year here.`;
   }
   if(value===undefined)throw Error('A visible field could not be mapped.');
   if(JSON.stringify(old)!==JSON.stringify(value))patch[field]=value;
  }
  return Object.keys(patch).length?[{id:row.id,patch}]:[];
 });
}

function validateAppearances(plan,manifest,changes){
 const accounts={...manifest.accounts};
 for(const change of changes)accounts[change.key]={...accounts[change.key],email:change.email,appearance:change.appearance};
 effectivePlan(plan,{...manifest,accounts});
}

async function prepare(api,plan,manifest,project){
 if(manifest.project!==project||manifest.plan_hash!==plan.plan_hash)throw Error('Manifest project or frozen plan differs.');
 const [users,allProfiles]=await Promise.all([api.users(),api.table('profiles',{})]);
 const uMap=new Map(users.map(u=>[u.id,u])),pMap=new Map(allProfiles.map(p=>[p.id,p]));
 const accounts=plan.accounts.map(a=>accountChange(a,manifest.accounts[a.seed_key],uMap.get(manifest.accounts[a.seed_key]?.id),pMap.get(manifest.accounts[a.seed_key]?.id),plan.batch));
 const claimed=new Map();
 validateAppearances(plan,manifest,accounts);
 for(const change of accounts){
  if(claimed.has(change.email))throw Error('Proposed email addresses collide within the batch.');claimed.set(change.email,change.id);
  if(users.some(u=>u.id!==change.id&&u.email?.toLowerCase()===change.email)||allProfiles.some(p=>p.id!==change.id&&p.email?.toLowerCase()===change.email))throw Error('A proposed address belongs to another existing account. No accounts have been changed.');
 }
 const profiles=accounts.map(c=>({...pMap.get(c.id),...c.patch})),effectiveProfiles=new Map(profiles.map(p=>[p.id,p])),content={},backup={profiles:plan.accounts.map(a=>pMap.get(manifest.accounts[a.seed_key].id)),users:plan.accounts.map(a=>uMap.get(manifest.accounts[a.seed_key].id))};
 // Never include passwords/tokens in the private pre-change backup.
 backup.users=backup.users.map(u=>({id:u.id,email:u.email,user_metadata:u.user_metadata,app_metadata:u.app_metadata}));
 for(const table of Object.keys(TEXT_FIELDS)){
  const rows=await api.table(table,{demo_batch:'eq.'+plan.batch});backup[table]=rows;
  content[table]=contentChanges(table,rows,profiles,accounts);
 }
 const applications=backup.mentor_applications.map(a=>a.id),history=[];
 for(let i=0;i<applications.length;i+=50)history.push(...await api.table('mentor_application_history',{application_id:`in.(${applications.slice(i,i+50).join(',')})`}));
 backup.mentor_application_history=history;
 content.mentor_application_history=history.flatMap(row=>{
  const source={...row.snapshot};
  if(TAG.test(source.school||''))source.school=effectiveProfiles.get(source.applicant_id)?.school||'Student Affairs';
  const snapshot=cleanObject(source);
  return JSON.stringify(snapshot)!==JSON.stringify(row.snapshot)?[{id:row.id,patch:{snapshot}}]:[];
 });
 const storage=manifest.storage.map(name=>{
  const owner=name.split('/')[0],account=accounts.find(a=>a.id===owner),original=plan.accounts.find(a=>manifest.accounts[a.seed_key].id===owner);
  if(!account||!name.startsWith(`${owner}/demo-${plan.batch}/`)||!/(?:academic|registration)\.pdf$/.test(name))throw Error('An attachment is not owned by this batch.');
  const kind=name.endsWith('/academic.pdf')?'Academic results summary':'Registration summary';
  return {name,label:`${kind} - ${account.appearance.full_name} - Student number: ${original.student_number}`};
 });
 const result={version:1,batch:plan.batch,project,plan_hash:plan.plan_hash,created_at:new Date().toISOString(),accounts,content,storage};
 result.refresh_hash=digest(result);
 return {preview:result,backup};
}

async function patchRows(api,table,changes,batch,progress,saveProgress){
 const grouped=new Map();
 for(const change of changes){
  const key=JSON.stringify(change.patch);
  if(!grouped.has(key))grouped.set(key,{patch:change.patch,ids:[]});grouped.get(key).ids.push(change.id);
 }
 for(const group of grouped.values())for(let start=0;start<group.ids.length;start+=100){
  const ids=group.ids.slice(start,start+100),key=table+'/'+digest({ids,patch:group.patch});
  if(progress.content.includes(key))continue;
  const filter={id:`in.(${ids.join(',')})`,select:'id'};
  if(table!=='mentor_application_history')filter.demo_batch='eq.'+batch;
  const updated=await api.request('/rest/v1/'+table+'?'+new URLSearchParams(filter),{method:'PATCH',body:group.patch,headers:{Prefer:'return=representation'}});
  if(!Array.isArray(updated)||updated.length!==ids.length)throw Error('A content update did not match its complete owned record set.');
  progress.content.push(key);saveProgress();
 }
}

async function execute(api,plan,manifest,preview,progress,log=console.log){
 if(preview.project!==manifest.project||preview.plan_hash!==plan.plan_hash||preview.batch!==plan.batch)throw Error('Refresh preview differs from the manifest.');
 validateAppearances(plan,manifest,preview.accounts);
 const saveProgress=()=>save(plan.batch+'/appearance-refresh-progress.json',progress);
 const users=await api.users(),byId=new Map(users.map(u=>[u.id,u]));
 // The normal request validator also runs for title/venue edits. Check it
 // before changing any identity so a past request cannot cause a partial run.
 const requestChanges=preview.content.event_requests||[];
 if(requestChanges.length){
  const requests=await api.table('event_requests',{demo_batch:'eq.'+plan.batch},'id,event_date,event_time');
  for(const change of requestChanges){
   const row=requests.find(r=>r.id===change.id);
   if(!row||Date.parse(`${row.event_date}T${String(row.event_time).slice(0,8)}+02:00`)<=Date.now())throw Error('An event request is past its editable date. Review its labels before updating accounts.');
  }
 }
 let completed=progress.accounts.length;
 await pool(preview.accounts,4,async change=>{
  if(progress.accounts.includes(change.id))return;
  const user=byId.get(change.id);
  if(user?.app_metadata?.fye_demo_batch!==plan.batch||user.app_metadata.fye_seed_key!==change.key)throw Error('Auth ownership changed; stopped at the saved checkpoint.');
  if(![change.previous_email,change.email].includes(user.email))throw Error('A managed email changed after preview; review before proceeding.');
  if(users.some(other=>other.id!==change.id&&other.email?.toLowerCase()===change.email))throw Error('An email collision appeared after preview.');
  const updated=await api.request('/auth/v1/admin/users/'+encodeURIComponent(change.id),{method:'PUT',body:{email:change.email,email_confirm:true,user_metadata:{...user.user_metadata,...change.appearance,role:change.metadata.role}}});
  const auth=updated?.user||updated;
  if(auth?.id!==change.id||auth.email!==change.email||auth.app_metadata?.fye_demo_batch!==plan.batch)throw Error('Auth update did not retain its owned identity.');
  const profiles=await api.request('/rest/v1/profiles?'+new URLSearchParams({id:'eq.'+change.id,demo_batch:'eq.'+plan.batch,select:'id,email'}),{method:'PATCH',body:change.patch,headers:{Prefer:'return=representation'}});
  if(profiles?.length!==1||profiles[0].email!==change.email)throw Error('Profile email could not be synchronized with its Auth account.');
  const state=manifest.accounts[change.key];state.email=change.email;state.appearance=change.appearance;
  checkpoint(plan.batch,manifest);progress.accounts.push(change.id);saveProgress();
  completed++;if(completed%100===0||completed===preview.accounts.length)log(`Account identities updated: ${completed}/${preview.accounts.length}.`);
 });
 for(const [table,changes]of Object.entries(preview.content)){
  await patchRows(api,table,changes,plan.batch,progress,saveProgress);
  log(`Visible content updated: ${table} (${changes.length} records).`);
 }
 await pool(preview.storage,3,async file=>{
  if(progress.storage.includes(file.name))return;
  await api.request('/storage/v1/object/mentor-academic-records/'+file.name.split('/').map(encodeURIComponent).join('/'),{method:'POST',body:pdf(file.label),headers:{'Content-Type':'application/pdf','x-upsert':'true'}});
  progress.storage.push(file.name);saveProgress();
 });
 sheet(plan,manifest);save(plan.batch+'/current-accounts.csv',csv(effectivePlan(plan,manifest).accounts.map(({seed_key,...account})=>account)));
 manifest.appearance_updated_at=new Date().toISOString();checkpoint(plan.batch,manifest);
 progress.completed_at=manifest.appearance_updated_at;saveProgress();
 log('Account identities, visible content and attachments updated. Passwords and academic records were retained.');
}

async function run(batch,apply=false){
 const plan=loadPlan(batch),manifest=read(batch+'/manifest.json'),settings=config(),api=new SupabaseAPI(settings);
 return lock(batch,async()=>{
  const previewName=batch+'/appearance-refresh-preview.json';
  let preview;
  if(apply&&fs.existsSync(privatePath(previewName)))preview=read(previewName);
  else {
   const prepared=await prepare(api,plan,manifest,settings.url);preview=prepared.preview;
   save(batch+'/appearance-refresh-backup.json',prepared.backup);save(previewName,preview);
  }
  if(!apply){console.log(`Prepared ${preview.accounts.length} owned account identities; ${Object.values(preview.content).reduce((n,a)=>n+a.length,0)} visible content records and ${preview.storage.length} attachments. No live changes made.`);return preview;}
  const {refresh_hash,...body}=preview;
  if(digest(body)!==refresh_hash)throw Error('Refresh preview integrity check failed.');
  if(preview.accounts.length!==plan.accounts.length||new Set(preview.accounts.map(a=>a.id)).size!==plan.accounts.length)throw Error('Refresh account inventory is incomplete.');
  let progress=fs.existsSync(privatePath(batch+'/appearance-refresh-progress.json'))?read(batch+'/appearance-refresh-progress.json'):{refresh_hash:preview.refresh_hash,accounts:[],content:[],storage:[]};
  if(progress.refresh_hash!==preview.refresh_hash)throw Error('Refresh progress belongs to a different preview.');
  return execute(api,plan,manifest,preview,progress);
 });
}

if(require.main===module){
 const {values}=require('node:util').parseArgs({options:{batch:{type:'string'},execute:{type:'boolean'}}});
 run(values.batch,values.execute).catch(error=>{console.error('Account appearance update stopped: '+error.message);process.exitCode=1;});
}
module.exports={TAG,TEXT_FIELDS,cleanText,cleanObject,accountChange,contentChanges,prepare,patchRows,execute,run};
