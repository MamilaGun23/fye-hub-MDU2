(async () => {
  if (window.fyeAuth && !(await window.fyeAuth.ready)) return;
 const db=window.fyeSupabase;
 const host=document.querySelector('[data-page="mentor-application"]')||document.querySelector('[data-page="profile"]');
 if(!db||!host)return;
 const panel=document.createElement('article');panel.className='content-panel';
 panel.innerHTML='<h3>Academic details</h3><p>Your original university entry year and previous university study determine matching eligibility. Changes require supervisor verification.</p><form class="data-form"><label>Original university entry year<input name="entry" type="number" min="1900" required></label><label>Previous university study<select name="status"><option value="first_time">First-time university entrant this year</option><option value="returning">Returning, transfer or readmitted student</option></select></label><label>Current year within this qualification<input name="year" type="number" min="1" max="20" required></label><button class="form-action">Save academic declaration</button></form><p role="status"></p>';
 host.append(panel);const form=panel.querySelector('form'),feedback=panel.querySelector('[role="status"]');
 const numberLabel=document.createElement('label');numberLabel.textContent='Student number';const number=document.createElement('input');number.name='number';number.required=true;number.maxLength=40;numberLabel.append(number);form.prepend(numberLabel);
 async function load(){const {data}=await db.auth.getUser();if(!data.user)return;const result=await db.from('profiles').select('student_number,first_entry_year,entry_status,study_year,academic_verified_at').eq('id',data.user.id).single();
 if(result.error){feedback.textContent=result.error.message;return;}const p=result.data;number.value=p.student_number||'';form.elements.entry.value=p.first_entry_year||'';form.elements.status.value=p.entry_status||'returning';form.elements.year.value=p.study_year||1;
 feedback.textContent=p.academic_verified_at?'Academic details verified.':'Academic details await supervisor verification.';}
 form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('button');b.disabled=true;
 try{const {error}=await db.rpc('declare_student_registration',{p_student_number:number.value.trim(),p_first_entry_year:Number(form.elements.entry.value),p_entry_status:form.elements.status.value,p_study_year:Number(form.elements.year.value)});if(error)throw error;await load();window.dispatchEvent(new CustomEvent('fye:academic-details-saved'));}
 catch(error){feedback.textContent=error.message;}finally{b.disabled=false;}};load();
})();
