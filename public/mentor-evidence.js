(() => {
 const db=window.fyeSupabase;
 const dialog=document.createElement('dialog');dialog.className='admin-detail-dialog';
 dialog.innerHTML='<h2>Application evidence</h2><p class="evidence-context"></p><div class="evidence-links"></div><form class="data-form"><label>Registration academic year<input name="year" type="number" min="2000" required></label><label><input name="progression" type="checkbox">Verified eligibility to progress to Year 2</label><label><input name="supplementary" type="checkbox">Supplementary results remain outstanding</label><button class="form-action">Verify current evidence</button></form><details><summary>Extend results completion</summary><form class="data-form extension"><label>New deadline<input name="deadline" type="datetime-local" required></label><label>Recorded reason<textarea name="reason" required></textarea></label><button class="form-action">Record supervisor extension</button></form></details><details><summary>Decision and document history</summary><div class="evidence-history"></div></details><p role="status"></p><button type="button" class="close-evidence">Close</button>';
 document.body.append(dialog);let application,refresh;
 const feedback=dialog.querySelector('[role="status"]');dialog.querySelector('.close-evidence').onclick=()=>dialog.close();
 async function submit(event,name,args){event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
 try{const {error}=await db.rpc(name,args);if(error)throw error;feedback.textContent='Saved. Evidence verification and approval remain separate decisions.';await refresh();}
 catch(e){feedback.textContent=e.message;}finally{button.disabled=false;}}
 const form=dialog.querySelector('form');form.onsubmit=event=>submit(event,'verify_mentor_documents',{p_application_id:application.id,p_progression:form.elements.progression.checked,p_supplementary_pending:form.elements.supplementary.checked,p_registration_year:Number(form.elements.year.value)});
 const extension=dialog.querySelector('.extension');extension.onsubmit=event=>submit(event,'extend_mentor_completion',{p_application_id:application.id,p_deadline:new Date(extension.elements.deadline.value+'+02:00').toISOString(),p_reason:extension.elements.reason.value});
 async function open(app,applicant,reload){application=app;refresh=reload;feedback.textContent='';dialog.querySelector('.evidence-context').textContent=`${applicant.full_name||applicant.email} · Cycle ${app.cycle_year||'legacy'} · ${app.status} · Results year ${app.results_year||'not supplied'}`;
 form.elements.year.value=app.registration_year||(app.cycle_year?app.cycle_year+1:'');form.elements.progression.checked=!!app.progression_confirmed;form.elements.supplementary.checked=!!app.supplementary_pending;
 const links=dialog.querySelector('.evidence-links');links.replaceChildren();
 const history=dialog.querySelector('.evidence-history');history.replaceChildren();if(!dialog.open)dialog.showModal();
 for(const [label,path]of [['Academic results',app.academic_record_path],['Proof of registration',app.registration_record_path]]){if(!path)continue;const {data,error}=await db.storage.from('mentor-academic-records').createSignedUrl(path,300);if(!error){const a=document.createElement('a');a.href=data.signedUrl;a.target='_blank';a.rel='noopener';a.textContent=label;links.append(a,document.createTextNode(' '));}}
 const result=await db.from('mentor_application_history').select('action,snapshot,created_at').eq('application_id',app.id).order('created_at',{ascending:false});
 if(result.error){history.textContent=result.error.message;return;}
 for(const item of result.data||[]){const p=document.createElement('p');p.textContent=`${new Date(item.created_at).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'})} · ${item.snapshot.status} · ${item.snapshot.review_reason||item.action} · Results ${item.snapshot.results_verified_at?'verified':'unverified'}`;history.append(p);}
 }
 window.fyeMentorEvidence={open};
})();
