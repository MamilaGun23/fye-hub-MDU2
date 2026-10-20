'use strict';

// Appearance is a separate overlay: the reviewed academic plan and its hash
// continue to identify the original batch for preflight, ownership and cleanup.
const DISPLAY_FIELDS=Object.freeze(['email','full_name','first_name','last_name','school','faculty','programme','bio']);
const ALLOWED=new Set(DISPLAY_FIELDS);

function effectivePlan(plan,manifest){
 if(!Array.isArray(plan?.accounts)||!manifest?.accounts||typeof manifest.accounts!=='object'||Array.isArray(manifest.accounts))throw Error('Appearance requires a plan and account manifest.');
 if((manifest.batch!==undefined&&manifest.batch!==plan.batch)||(manifest.plan_hash!==undefined&&manifest.plan_hash!==plan.plan_hash))throw Error('Appearance manifest batch/plan differs.');
 const emails=new Set();
 const accounts=plan.accounts.map(original=>{
  const state=manifest.accounts[original.seed_key];
  if(!state||typeof state!=='object'||Array.isArray(state))throw Error('Appearance account is not tracked: '+original.seed_key);
  const account={...original};
  if(state.appearance!==undefined){
   const appearance=state.appearance;
   if(!appearance||typeof appearance!=='object'||Array.isArray(appearance)||![Object.prototype,null].includes(Object.getPrototypeOf(appearance)))throw Error('Invalid account appearance: '+original.seed_key);
   for(const [key,value]of Object.entries(appearance)){
    if(!ALLOWED.has(key))throw Error('Appearance cannot change '+key+': '+original.seed_key);
    if(value===null&&['school','bio'].includes(key)){account[key]=null;continue;}
    if(typeof value!=='string'||value.length>(key==='bio'?2000:250)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||(key!=='bio'&&!value.trim()))throw Error('Invalid appearance '+key+': '+original.seed_key);
    account[key]=value;
   }
   if(Object.hasOwn(appearance,'email')){
    if(['student','mentor'].includes(original.role)){
     if(!/^\d{9}$/.test(original.student_number)||account.email!==original.student_number+'@ump.ac.za')throw Error('Appearance email must match the original student number: '+original.seed_key);
    }else if(['admin','supervisor'].includes(original.role)){
     if(!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*@ump\.ac\.za$/.test(account.email)||/(?:^|[._-])(?:demo|prototype|test)(?:[._-]|@)/i.test(account.email))throw Error('Appearance staff email must be a personal UMP address: '+original.seed_key);
    }else throw Error('Unsupported appearance account role: '+original.seed_key);
   }
  }
  if(state.email!==undefined&&state.email!==account.email)throw Error('Appearance and manifest email differ: '+original.seed_key);
  if(typeof account.email!=='string'||emails.has(account.email.toLowerCase()))throw Error('Duplicate or invalid appearance email: '+original.seed_key);
  emails.add(account.email.toLowerCase());
  return account;
 });
 return {...plan,accounts};
}

module.exports={DISPLAY_FIELDS,effectivePlan};
