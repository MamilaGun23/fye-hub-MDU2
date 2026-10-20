'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verifyAccess}=require('../scripts/demo/access.cjs');
function fixture(options={}){
 const plan={batch:'access-test',accounts:[['admin','a'],['supervisor','s'],['student','u'],['mentor','m']].map(([role,key])=>({role,seed_key:key,email:key+'@example.test',faculty_id:'1',entry_status:role==='student'?'first_time':'returning'}))};
 const manifest={accounts:Object.fromEntries(plan.accounts.map(a=>[a.seed_key,{id:a.seed_key,password:'private-test-password'}])),storage:['m/demo-access-test/academic.pdf']};
 const fields={students:'active_students',mentors:'active_mentors',eligible:'eligible_mentees',unassigned:'unassigned_mentees',awaiting:'awaiting_results',assignments:'active_assignments',disabled:'disabled_profiles',events:'events_in_period',upcoming:'upcoming_events',notices:'active_notices'};
 const metricRows=Object.fromEntries(Object.keys(fields).map(k=>[k,['disabled','awaiting','unassigned'].includes(k)?[]:[{}]]));
 const calls=[];let saved;
 function failure(status,code,message='Request failed.'){return Object.assign(Error(message),{status,code});}
 const api={
  async signIn(email,password){assert.equal(password,'private-test-password');return email[0];},
  async rpc(name,args,token){calls.push({name,token});
   if(name==='demo_seed_status'){
    if(token==='u')throw failure(403,'42501');
    return {version:2,academic_rules:true,workflows:true,demo_isolation:true,schema_intact:true,directory_reads:options.ready!==false};
   }
   if(name==='get_admin_analytics'){
    if(token==='u')throw options.denialTimeout?failure(500,'57014'):failure(400,'P0001','Active admin access is required.');
    assert.equal(token,'a');return Object.fromEntries(Object.entries(fields).map(([k,v])=>[v,metricRows[k].length]));
   }
   if(name==='get_admin_analytics_details'){assert.equal(token,'a');return metricRows[args.p_metric];}
   if(name==='mentor_application_is_approved'){assert.equal(token,'m');return true;}
   throw Error('Unexpected RPC.');
  },
  async request(route,{token,body}={}){calls.push({route,token});
   if(route.startsWith('/rest/v1/active_mentor_assignments')){assert.equal(token,'u');return [{id:1,mentor_id:'m'}];}
   if(route.startsWith('/rest/v1/calendar_events')){
    assert(['u','m'].includes(token));const rows=[{id:1,faculty_id:1,demo_batch:plan.batch,event_status:options.cancelled?'cancelled':'scheduled'}];
    if(options.leak)rows.push({id:2,faculty_id:2,demo_batch:plan.batch,event_status:'scheduled'});return rows;
   }
   if(route.startsWith('/storage/')){assert.equal(token,'s');assert.equal(body.expiresIn,60);if(options.evidenceDenied)throw failure(403,'access_denied');return {signedURL:'/private?token=do-not-save-this-token'};}
   if(route.startsWith('/rest/v1/profiles')){
    assert(['a','s'].includes(token));const offset=Number(new URL('https://example.test'+route).searchParams.get('offset'));
    const ids=options.missingProfile?['a','s','u']:['a','s','u','m'];return ids.slice(offset,offset+2).map(id=>({id}));
   }
   throw Error('Unexpected request.');
  }
 };
 return {plan,manifest,api,calls,run:()=>verifyAccess(api,plan,manifest,{log:()=>{},saveReport:r=>{saved=r;}}),saved:()=>saved};
}
test('live access verification checks capped pagination, all analytics cohorts and real-role paths without saving credentials',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.passed,true);assert.equal(r.counts.admin_profiles,4);assert.equal(r.counts.supervisor_profiles,4);assert.equal(Object.keys(r.counts.analytics).length,10);
 assert.equal(f.calls.filter(c=>c.route?.startsWith('/rest/v1/profiles')).length,6,'Each staff inventory continues until an empty capped page.');
 assert.equal(f.saved(),r);assert.doesNotMatch(JSON.stringify(r),/private-test-password|do-not-save-this-token/);
});
test('missing directory migration blocks expensive reads while independent evidence and privilege checks continue',async()=>{
 const f=fixture({ready:false}),r=await f.run();assert.equal(r.passed,false);assert.equal(r.checks.supervisor_directory.blocked_by,'directory_migration');
 assert.equal(r.checks.supervisor_evidence.passed,true);assert.equal(r.checks.student_staff_access_denied.passed,true);
 assert.equal(f.calls.some(c=>c.route?.startsWith('/rest/v1/calendar_events')||c.route?.startsWith('/rest/v1/profiles')),false);
});
test('access verification rejects cross-faculty/cancelled events, incomplete directories and unreadable evidence',async()=>{
 for(const options of [{leak:true},{cancelled:true},{missingProfile:true},{evidenceDenied:true}])assert.equal((await fixture(options).run()).passed,false);
});
test('a timeout cannot masquerade as a successful permission denial',async()=>{
 const r=await fixture({denialTimeout:true}).run();assert.equal(r.passed,false);assert.equal(r.checks.student_staff_access_denied.passed,false);
});
