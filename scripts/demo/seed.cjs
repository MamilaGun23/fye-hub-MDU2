'use strict';
const fs=require('node:fs');const os=require('node:os');const crypto=require('node:crypto');
const {save,read,privatePath,csv}=require('./files.cjs');
const {validatePlan}=require('./identities.cjs');
const {academicDate}=require('./policy.cjs');
const {effectivePlan}=require('./appearance.cjs');
function pdf(label){
 // Helvetica's basic character set requires transliteration in the attachment;
 // profile names retain their original Unicode spelling.
 const lines=['FYE Hub supporting document',...String(label).split(' - ')].map(line=>line.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'?').replace(/([()\\])/g,'\\$1'));
 const content=`BT /F1 12 Tf 30 740 Td 20 TL ${lines.map((line,index)=>(index?'T* ':'')+`(${line}) Tj`).join(' ')} ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
 let result='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(result));result+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const start=Buffer.byteLength(result);result+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;return Buffer.from(result);
}
function loadPlan(batch){const plan=read(batch+'/plan.json');validatePlan(plan,read(batch+'/audit-snapshot.json'),read(batch+'/qualification-snapshot.json'));return plan;}
async function lock(batch,fn){const filename=privatePath(batch+'/operation.lock');
 if(fs.existsSync(filename)){const previous=JSON.parse(fs.readFileSync(filename,'utf8'));if(previous.host!==os.hostname())throw Error('Another machine owns the batch lock.');let alive=true;try{process.kill(previous.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}if(alive)throw Error('Another operation is using this batch.');fs.unlinkSync(filename);}
 fs.writeFileSync(filename,JSON.stringify({pid:process.pid,host:os.hostname()}),{flag:'wx',mode:0o600});
 try{return await fn();}finally{fs.unlinkSync(filename);}
}
function checkpoint(batch,manifest){save(batch+'/manifest.json',manifest);}
function manifestFor(plan,project,presentationPassword){
 const filename=privatePath(plan.batch+'/manifest.json');let manifest;
 if(fs.existsSync(filename)){manifest=read(plan.batch+'/manifest.json');if(manifest.plan_hash!==plan.plan_hash||manifest.project!==project)throw Error('Manifest project or plan differs.');}
 else{const chosen=presentationPassword||`FyeDemo-${crypto.randomBytes(6).toString('hex')}-2026!`;if(chosen.length<12)throw Error('Presentation password must contain at least 12 characters.');
 manifest={version:1,batch:plan.batch,plan_hash:plan.plan_hash,project,created_at:new Date().toISOString(),accounts:{},operations:{},storage:[],errors:[]};
 for(const a of plan.accounts)manifest.accounts[a.seed_key]={password:a.presentation_login?chosen:crypto.randomBytes(24).toString('base64url'),email:a.email,profile_done:false};
 checkpoint(plan.batch,manifest);}
 return manifest;
}
async function preflight(api,plan){
 const status=await api.rpc('demo_seed_status');if(status?.version!==2||!status.academic_rules||!status.demo_isolation||!status.workflows||!status.directory_reads||!status.schema_intact)throw Error('Apply/review the complete current academic/demo migrations; the deployed schema must match the installed contract.');
 const mapping=read(plan.batch+'/qualification-snapshot.json');
 if(!Array.isArray(status.programmes)||status.programmes.length!==mapping.programmes.length)throw Error('Deployed catalogue changed; re-audit before insertion.');
 for(const p of mapping.programmes){const current=status.programmes.find(q=>String(q.id)===p.id);if(!current||current.name!==p.name||String(current.faculty_id)!==p.faculty_id||current.qualification_level!==p.qualification_level||current.max_study_year!==p.max_study_year||current.first_time_entry!==(p.first_time_entry!==false))throw Error('Deployed qualification mapping differs: '+p.id);}
 if(academicDate(plan.as_of).year!==academicDate(new Date()).year)throw Error('Preview academic year differs from the current year. Generate a fresh reviewed batch.');
 await api.rpc('demo_start_batch',{p_batch:plan.batch,p_plan_hash:plan.plan_hash});
}
async function ensureAccount(api,plan,manifest,account,users){
 const state=manifest.accounts[account.seed_key];
 if(!state)throw Error('Account is not tracked by this manifest: '+account.seed_key);
 if(state.appearance!==undefined)account=effectivePlan(plan,manifest).accounts.find(a=>a.seed_key===account.seed_key);
 if(state.email!==undefined&&state.email!==account.email)throw Error('Manifest email differs from the account appearance: '+account.seed_key);
 let existing=users.find(u=>u.email?.toLowerCase()===account.email);
 function owned(u){return u?.app_metadata?.fye_demo_batch===plan.batch&&u?.app_metadata?.fye_seed_key===account.seed_key;}
 if(existing&&!owned(existing))throw Error('Refusing to adopt an existing unmarked account: '+account.email);
 if(state.id&&(!existing||existing.id!==state.id))throw Error('Tracked Auth account is missing or changed. Resolve it before resume.');
 if(!existing){
  try{existing=await api.createUser({email:account.email,password:state.password,email_confirm:true,
   user_metadata:{...account,role:'student'},app_metadata:{fye_demo_batch:plan.batch,fye_seed_key:account.seed_key}});}
  catch(error){const refreshed=await api.users();existing=refreshed.find(u=>u.email?.toLowerCase()===account.email);if(!owned(existing))throw error;}
  if(!existing?.id||!owned(existing))throw Error('Created account did not retain protected seed ownership.');users.push(existing);
 }
 state.id=existing.id;state.email=account.email;checkpoint(plan.batch,manifest);
 if(!state.profile_done){await api.rpc('demo_seed_profile',{p_batch:plan.batch,p_key:account.seed_key,p_id:state.id,p_details:account});state.profile_done=true;checkpoint(plan.batch,manifest);}
 return state;
}
async function pool(items,size,fn){let next=0,error;await Promise.all(Array.from({length:Math.min(size,items.length)},async()=>{while(!error){const index=next++;if(index>=items.length)return;try{await fn(items[index],index);}catch(e){error=e;}}}));if(error)throw error;}
function sheet(plan,manifest){const displayed=effectivePlan(plan,manifest);save(plan.batch+'/presentation-logins.csv',csv(displayed.accounts.filter(a=>a.presentation_login&&manifest.accounts[a.seed_key]?.id).map(a=>({name:a.full_name,role:a.role,faculty:a.faculty,programme:a.programme,email:a.email,password:manifest.accounts[a.seed_key].password,auth_id:manifest.accounts[a.seed_key].id}))));}
module.exports={pdf,loadPlan,lock,manifestFor,preflight,ensureAccount,pool,checkpoint,sheet};
