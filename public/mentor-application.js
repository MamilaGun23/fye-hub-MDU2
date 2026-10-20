(async () => {
  if (window.fyeAuth && !(await window.fyeAuth.ready)) return;
 const db=window.fyeSupabase, form=document.querySelector('#mentor-application-form');
 if(!db||!form)return;
 const feedback=document.querySelector('#mentor-application-status');
 let user,profile,application,cycle;
 const field=id=>document.querySelector('#'+id);
 function button(text,action){const b=document.createElement('button');b.type='button';b.className='text-button';b.textContent=text;b.onclick=async()=>{b.disabled=true;try{await action();await load();}catch(e){feedback.textContent=e.message;}finally{b.disabled=false;}};return b;}
 async function rpc(name,args){const {data,error}=await db.rpc(name,args);if(error)throw error;return data;}
 async function upload(input){
  const file=input.files[0];if(!file)return null;
  if(file.type!=='application/pdf'||file.size>10*1024*1024)throw Error('Choose a PDF up to 10 MB.');
  const name=`${user.id}/${crypto.randomUUID()}.pdf`;
  const {error}=await db.storage.from('mentor-academic-records').upload(name,file,{contentType:'application/pdf',upsert:false});
  if(error)throw error;return name;
 }
 const actions=document.createElement('div');form.after(actions);
 const complete=document.createElement('form');complete.className='data-form';complete.hidden=true;
 complete.innerHTML='<h3>Complete or replace academic evidence</h3><p>On-time applications can receive results after January. Completion normally closes March 31; supervisors can record extensions. Replacements require fresh verification.</p><label>Academic results PDF<input name="academic" type="file" accept="application/pdf" required></label><label>Proof of registration PDF<input name="registration" type="file" accept="application/pdf" required></label><label>Results academic year<input name="year" type="number" min="1900" required></label><button class="form-action">Submit evidence for verification</button>';
 actions.after(complete);
 complete.onsubmit=async event=>{event.preventDefault();const submit=complete.querySelector('button');submit.disabled=true;try{
  const academic=await upload(complete.elements.academic),registration=await upload(complete.elements.registration);
  await rpc('complete_mentor_documents',{p_application_id:application.id,p_academic_path:academic,p_registration_path:registration,p_results_year:Number(complete.elements.year.value)});
  complete.reset();await load();feedback.textContent='Evidence submitted. Supervisor verification is required.';
 }catch(e){feedback.textContent=e.message;}finally{submit.disabled=false;}};
 async function load(){
  try{
   const auth=await db.auth.getUser();if(auth.error||!auth.data.user)throw Error('Sign in to manage applications.');user=auth.data.user;
   const p=await db.from('profiles').select('*').eq('id',user.id).single();if(p.error)throw p.error;profile=p.data;
   cycle=window.fyeAcademic.cycle();
   const result=await db.from('mentor_applications').select('*').eq('applicant_id',user.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
   if(result.error)throw result.error;application=result.data;
   const current=application?.cycle_year===cycle.year?application:null;
   const locked=current && !['draft','declined'].includes(current.status);
   const deferred=profile.entry_status==='first_time'||profile.first_time_cohort_year===cycle.year;
   const januaryNewcomer=profile.entry_status==='first_time'&&profile.first_entry_year!==cycle.year;
   const appointed=await window.fyeAcademic.mentor(user.id);
   form.hidden=!cycle.open||!!locked||januaryNewcomer||appointed;
   actions.replaceChildren();complete.hidden=true;
   field('mentor-student-number').value=profile.student_number||'';
   field('mentor-student-number').readOnly=true;
   field('mentor-study-year').value=profile.study_year||'';field('mentor-study-year').readOnly=true;
   field('mentor-school').value=current?.school||profile.school||'';
   field('mentor-previous-year').value=current?.results_year||current?.previous_academic_year||(deferred?cycle.year:cycle.year-1);
   field('mentor-previous-year').required=!deferred;
   field('mentor-academic-record').required=!deferred&&!current?.academic_record_path;
   field('mentor-registration-record').required=!deferred&&!current?.registration_record_path;
   feedback.textContent=application?`Application ${application.cycle_year||'legacy'}: ${application.status}. ${application.review_reason||''}`:'No application submitted.';
   if(!cycle.open)feedback.textContent+=' New applications open October 1 through January 31.';
   if(januaryNewcomer)feedback.textContent+=' New January entrants wait until October.';
   if(appointed)feedback.textContent+=' Your mentor appointment continues until a supervisor ends it; no annual reapplication is required.';
   if(application?.submitted_at && ['pending','shortlisted','approved'].includes(application.status)){
    complete.hidden=false;complete.elements.year.value=application.results_year||application.cycle_year;
    feedback.textContent+=application.results_verified_at?' Academic evidence verified.':' Awaiting academic evidence/verification.';
    if(application.supplementary_pending)feedback.textContent+=' Supplementary results outstanding.';
    if(application.status==='approved')feedback.textContent+=' Mentor access starts when the appointment takes effect.';
   }
   if(application&&['draft','pending','shortlisted'].includes(application.status))actions.append(button('Withdraw application',()=>rpc('withdraw_mentor_application',{p_application_id:application.id})));
   if(cycle.open&&!locked&&!januaryNewcomer&&!appointed)actions.append(button('Save draft',()=>submit(false)));
   if(deferred)feedback.textContent+=' First-year approval waits until the following year, verified progression and new-year registration.';
  }catch(e){feedback.textContent=`Application unavailable: ${e.message}`;form.hidden=true;}
 }
 async function submit(publish){
  const academic=await upload(field('mentor-academic-record')),registration=await upload(field('mentor-registration-record'));
  const current=application?.cycle_year===cycle.year?application:null;
  await rpc('save_mentor_application',{p_details:{school:field('mentor-school').value.trim(),previous_academic_year:field('mentor-previous-year').value,
   results_year:field('mentor-previous-year').value?Number(field('mentor-previous-year').value):null,
   academic_record_path:academic||current?.academic_record_path||null,registration_record_path:registration||current?.registration_record_path||null},p_submit:publish});
  form.reset();
 }
 form.onsubmit=async e=>{e.preventDefault();const submitButton=field('mentor-application-submit');submitButton.disabled=true;
  try{await submit(true);await load();}catch(error){feedback.textContent=error.message;}finally{submitButton.disabled=false;}};
 load();window.addEventListener('fye:academic-details-saved',load);
})();
