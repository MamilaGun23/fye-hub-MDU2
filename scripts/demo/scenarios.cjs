'use strict';
const {pdf,checkpoint}=require('./seed.cjs');
const {cycleAt,academicDate}=require('./policy.cjs');
async function scenarios(api,plan,manifest,accounts=plan.accounts,log=console.log){
 const staff=role=>plan.accounts.find(a=>a.role===role);
 const state=a=>manifest.accounts[a.seed_key];
 const supervisor=staff('supervisor'),admin=staff('admin');
 const id=a=>state(a).id;
 const tokens=new Map();
 async function token(a){if(!tokens.has(a.seed_key))tokens.set(a.seed_key,await api.signIn(a.email,state(a).password));return tokens.get(a.seed_key);}
 async function once(key,work){if(Object.hasOwn(manifest.operations,key))return manifest.operations[key];const result=await work();manifest.operations[key]=result??true;checkpoint(plan.batch,manifest);return result;}
 async function workflow(a,key,rpc,args){return once(key,async()=>api.rpc('demo_workflow_once',{p_key:key,p_rpc:rpc,p_args:args},await token(a)));}
 async function documents(a){
  const result={};for(const kind of ['academic','registration']){
   const name=`${id(a)}/demo-${plan.batch}/${kind}.pdf`;
   if(!manifest.storage.includes(name)){manifest.storage.push(name);checkpoint(plan.batch,manifest);}
   const label=kind==='academic'?'Academic results summary':'Registration summary';
   await once('upload/'+a.seed_key+'/'+kind,async()=>{await api.upload(name,pdf(label+' - '+a.full_name+' - Student number: '+a.student_number));return name;});result[kind]=name;
  }return result;
 }
 const mentors=accounts.filter(a=>a.role==='mentor');
 for(const a of mentors){const docs=await documents(a);await once('appointment/'+a.seed_key,()=>api.rpc('demo_historical_mentor',{p_batch:plan.batch,p_mentor_id:id(a),p_supervisor_id:id(supervisor),p_academic_path:docs.academic,p_registration_path:docs.registration}));}
 log(`Prepared ${mentors.length} historical mentor appointments.`);
 const programmeIds=[...new Set(accounts.filter(a=>a.role==='student').map(a=>a.programme_id))];
 for(const programme of programmeIds){
  const students=accounts.filter(a=>a.role==='student'&&a.programme_id===programme);
  const localMentors=mentors.filter(a=>a.programme_id===programme);
  const mentees=students.filter(a=>a.entry_status==='first_time');
  for(let i=0;i<localMentors.length;i++){
   const selected=mentees.slice(i*12,(i+1)*12);if(!selected.length)continue;
   await workflow(supervisor,`assign/${programme}/${i}`,'assign_students_to_mentor',{p_mentor_id:id(localMentors[i]),p_student_ids:selected.map(id)});
   const student=selected[0];
   await workflow(localMentors[i],`message/${programme}/${i}`,'send_mentor_student_message',{p_recipient_id:id(student),p_body:`Hi ${student.full_name.split(' ')[0]}, welcome to FYE Hub. I am ${localMentors[i].full_name}, your mentor for ${student.programme}. Send me a message if you need help with study planning, finding campus services or settling into university life.`});
  }
  if(cycleAt(new Date()).open){
   for(const [i,status]of [[24,'pending'],[25,'shortlisted'],[26,'declined']]){
    const a=students[i];if(!a)continue;const first=a.entry_status==='first_time';const docs=first?{}:await documents(a);
    const aid=await workflow(a,`application/${a.seed_key}`,'save_mentor_application',{p_details:{school:a.faculty,previous_academic_year:String(academicDate(new Date()).year-1),results_year:first?academicDate(new Date()).year:academicDate(new Date()).year-1,academic_record_path:docs.academic||null,registration_record_path:docs.registration||null},p_submit:true});
    if(status!=='pending')await workflow(supervisor,`application-review/${a.seed_key}`,'review_mentor_application',{p_application_id:aid,p_decision:status,p_reason:status==='declined'?'Please provide a more detailed academic statement and confirm your availability before applying in the next cycle.':null});
   }
  }
 }
 const faculties=[...new Set(mentors.map(a=>a.faculty_id))];
 for(const faculty of faculties){
  const mentor=mentors.find(a=>a.faculty_id===faculty),students=accounts.filter(a=>a.role==='student'&&a.faculty_id===faculty);
  await once('past-event/'+faculty,()=>api.rpc('demo_historical_event',{p_batch:plan.batch,p_key:'past-event/'+faculty,p_mentor_id:id(mentor),p_supervisor_id:id(supervisor),p_attendees:students.slice(0,8).map(id)}));
  const events=[
   {kind:'approved',title:'Study skills workshop',purpose:'A practical session on weekly study plans, revision techniques and preparing for assessments.',days:7},
   {kind:'pending',title:'Campus resources orientation',purpose:'Introduce students to library services, academic support and the campus resources available to them.',days:9},
   {kind:'cancellation-pending',title:'Exam preparation session',purpose:'Help students build revision timetables and share strategies for managing assessment pressure.',days:11},
   {kind:'cancelled',title:'Peer support discussion',purpose:'A guided discussion about settling into university, managing coursework and asking for support.',days:14}
  ];
  for(const {kind,title,purpose,days} of events){
   const date=new Date(Date.now()+days*86400000).toISOString().slice(0,10);
   const request=await workflow(mentor,`event/${faculty}/${kind}`,'create_event_request',{p_title:`${mentor.faculty}: ${title}`,p_purpose:purpose,p_event_date:date,p_event_time:'12:00',p_venue:`${mentor.faculty} seminar room`});
   if(kind==='pending')continue;
   await workflow(supervisor,`approve-event/${faculty}/${kind}`,'review_event_request',{p_event_request_id:request,p_decision:'approved',p_note:'Approved. Please share the session details with the students in your faculty.'});
   if(!kind.startsWith('cancel'))continue;
   const req=(await api.table('event_requests',{id:'eq.'+request}))[0];if(!req?.calendar_event_id)throw Error('Approved event is missing its calendar link.');
   await workflow(mentor,`request-cancel/${faculty}/${kind}`,'request_event_cancellation',{p_event_id:req.calendar_event_id,p_reason:'The seminar room is unavailable on the scheduled date. Please cancel this session so a new date can be arranged.'});
   if(kind==='cancelled'){
    const cancel=(await api.table('event_cancellation_requests',{calendar_event_id:'eq.'+req.calendar_event_id}))[0];
    await workflow(supervisor,`approve-cancel/${faculty}`,'review_event_cancellation',{p_request_id:cancel.id,p_approve:true,p_note:'Cancellation approved due to venue availability. Please notify the affected students.'});
    await workflow(supervisor,`finish-cancel/${faculty}`,'cancel_supervisor_event',{p_event_id:req.calendar_event_id,p_reason:'The venue is unavailable. A revised session date will be communicated to students.'});
   }
  }
 }
 const now=Date.now();
 await workflow(admin,'notice/current','create_notice',{title:'University update',message:'Welcome to FYE Hub. Check your mentor messages and faculty calendar regularly for study sessions, campus activities and academic support opportunities.',starts_at:new Date(now-60000).toISOString(),ends_at:new Date(now+7*86400000).toISOString()});
 await workflow(admin,'notice/expired','create_notice',{title:'Application updates',message:'The previous mentor application review period has closed. Applicants can view their application status and feedback in FYE Hub.',starts_at:new Date(now-3*86400000).toISOString(),ends_at:new Date(now-86400000).toISOString()});
 log('Applications, assignments, messages, faculty events, attendance, cancellations and notices prepared.');
}
module.exports={scenarios};
