const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
function setup(t,profile,application=null){
 const dom=new JSDOM(read('student.html'),{url:'https://example.test/student.html',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,calls=[];
 w.fyeSupabase={auth:{getUser:async()=>({data:{user:{id:'student'}}})},rpc:async(name,args)=>{calls.push({name,args});return{data:name==='mentor_application_is_approved'?false:'application'};},
 storage:{from:()=>({upload:async(name)=>{calls.push({upload:name});return{};}})},
 from(table){let one=false;const query={select(){return query;},eq(){return query;},order(){return query;},limit(){return query;},single(){one=true;return query;},maybeSingle(){one=true;return query;},then(resolve,reject){return Promise.resolve({data:table==='profiles'?profile:one?application:application?[application]:[],error:null}).then(resolve,reject);}};return query;}};
 w.eval(read('academic.js'));w.fyeAcademic.cycle=()=>({year:2026,open:true});return{w,calls,run:()=>w.eval(read('mentor-application.js'))};
}
test('first-year application form allows Year 1 and on-time submission without PDF uploads',async t=>{
 const app=setup(t,{student_number:'260000001',study_year:1,entry_status:'first_time',first_entry_year:2026,first_time_cohort_year:2026,school:'Science'});
 app.run();await settle();const d=app.w.document,form=d.querySelector('#mentor-application-form');
 assert.equal(form.hidden,false);assert.equal(d.querySelector('#mentor-academic-record').required,false);
 assert.equal(d.querySelector('#mentor-registration-record').required,false);assert.equal(d.querySelector('#mentor-study-year').value,'1');
 form.dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));await settle();
 const submission=app.calls.find(c=>c.name==='save_mentor_application');assert(submission);assert.equal(submission.args.p_submit,true);assert.equal(submission.args.p_details.academic_record_path,null);assert.equal(app.calls.filter(c=>c.upload).length,0);
});
test('new January entrants wait while the previous first-year cohort can still apply',async t=>{
 const newcomer=setup(t,{student_number:'270000001',study_year:1,entry_status:'first_time',first_entry_year:2027,first_time_cohort_year:2027});newcomer.run();await settle();
 assert.equal(newcomer.w.document.querySelector('#mentor-application-form').hidden,true);assert.match(newcomer.w.document.querySelector('#mentor-application-status').textContent,/wait until October/);
 const previous=setup(t,{student_number:'260000001',study_year:2,entry_status:'returning',first_entry_year:2026,first_time_cohort_year:2026});previous.run();await settle();
 assert.equal(previous.w.document.querySelector('#mentor-application-form').hidden,false);assert.equal(previous.w.document.querySelector('#mentor-academic-record').required,false);
});
test('closed recruitment window keeps submitted evidence completion available',async t=>{
 const app=setup(t,{student_number:'260000001',study_year:2,entry_status:'returning',first_entry_year:2026,first_time_cohort_year:2026},
 {id:'application',cycle_year:2026,status:'pending',submitted_at:'2026-10-19',results_year:2026});
 app.w.fyeAcademic.cycle=()=>({year:2027,open:false});app.run();await settle();const forms=app.w.document.querySelectorAll('form');
 assert.equal(app.w.document.querySelector('#mentor-application-form').hidden,true);
 const evidence=[...forms].find(f=>f.textContent.includes('Complete or replace academic evidence'));assert(evidence);assert.equal(evidence.hidden,false);
 assert.match(app.w.document.querySelector('#mentor-application-status').textContent,/Awaiting academic evidence/);
});
