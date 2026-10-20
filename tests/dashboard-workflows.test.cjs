const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const read=(name)=>fs.readFileSync(path.join(__dirname,'..','public',name),'utf8');
const settle=async()=>{for(let i=0;i<12;i++) await new Promise(resolve=>setImmediate(resolve));};

function setup(t,page,tables={},rpc=async()=>({})) {
  const dom=new JSDOM(read(page),{url:`https://fye.example/${page}`,runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const w=dom.window;
  w.scrollTo=()=>{}; w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.setInterval=()=>0;
  const calls=[];
  const role=page==='admin.html'?'admin':page==='mentor.html'?'mentor':page==='student.html'?'student':'supervisor';
  const actor={id:'actor',role,is_active:true,full_name:'Test User'};
  w.fyeSupabase={
    auth:{getUser:async()=>({data:{user:{id:'actor'}}})},
    storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://example.test/record.pdf'}})})},
    rpc:async(name,args)=>{calls.push({name,args});return rpc(name,args);},
    from(table){
      let rows=[...(tables[table]||[])];
      let single=false,head=false;
      const q={
        select(fields,options){head=options?.head;return q;},order(){return q;},
        eq(key,value){rows=rows.filter(row=>row[key]===value);return q;},
        in(key,values){rows=rows.filter(row=>values.includes(row[key]));return q;},
        is(key,value){rows=rows.filter(row=>(row[key]??null)===value);return q;},
        gte(key,value){rows=rows.filter(row=>row[key]>=value);return q;},lte(){return q;},lt(){return q;},
        or(expression){rows=rows.filter(row=>expression.startsWith('status.in.')
          ? ['pending','shortlisted','declined','closed'].includes(row.status)||(row.status==='approved'&&row.replacement_review_required)
          : !row.ends_at||row.ends_at>new Date().toISOString());return q;},
        limit(n){rows=rows.slice(0,n);return q;},range(a,b){rows=rows.slice(a,b+1);return q;},
        single(){single=true;return q;},maybeSingle(){single=true;return q;},
        insert(payload){calls.push({table,insert:payload});(tables[table]||=[]).push(payload);rows=[];return q;},
        update(payload){calls.push({table,update:payload});rows.forEach(row=>Object.assign(row,payload));return q;},
        then(resolve,reject){return Promise.resolve({data:head?null:single?(table==='profiles'&&rows.length===0?actor:rows[0]):rows,count:head?rows.length:undefined,error:null}).then(resolve,reject);}
      };return q;
    }
  };
  w.eval(read('academic.js'));
  w.eval(read('directory.js'));
  return {w,document:w.document,calls,run(name){w.eval(read(name));},tables};
}

test('shortlisted candidates render separately and retain review controls under three dots',async(t)=>{
  const applications=[{id:'a1',applicant_id:'s1',status:'pending'},{id:'a2',applicant_id:'s2',status:'shortlisted'}];
  const app=setup(t,'supervisor.html',{mentor_applications:applications,profiles:[{id:'s1',full_name:'Pending Student'},{id:'s2',full_name:'Shortlisted Student'}]},async(name,args)=>{
    if(name==='review_mentor_application') applications.find(row=>row.id===args.p_application_id).status=args.p_decision;
    return {};
  });
  app.run('dashboard-ui.js');app.run('supervisor-approvals.js');await settle();
  app.document.querySelector('.page-view[data-page="mentor-applications"]').hidden=false;
  assert.equal(app.document.querySelector('#mentor-applications-content').hidden,true);
  assert.equal(app.document.querySelector('#mentor-shortlisted-content').hidden,true);
  const toggle=app.document.querySelector('[data-disclosure="mentor-applications-content"]');toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.equal(app.document.querySelector('#mentor-applications-content').hidden,false);
  app.document.querySelector('[data-disclosure="mentor-shortlisted-content"]').click();
  const list=app.document.querySelector('#mentor-approval-list');
  const shortlist=app.document.querySelector('#mentor-shortlisted-list');
  assert.match(list.textContent,/Pending Student/);assert.doesNotMatch(list.textContent,/Shortlisted Student/);
  assert.match(shortlist.textContent,/Shortlisted Student/);
  const menu=shortlist.querySelector('.dashboard-action-menu');
  assert.ok(menu);assert.equal(menu.open,false);
  menu.open=true;menu.dispatchEvent(new app.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(menu.open,false);assert.equal(app.document.activeElement,menu.querySelector('summary'));
  menu.open=true;shortlist.querySelector('.mentor-approve-button').click();await settle();
  assert.equal(app.document.querySelector('#shortlisted-count').textContent,'0');
  assert.match(shortlist.textContent,/No candidates/);
});

test('mentor application filters combine across both lists and survive refresh',async(t)=>{
  const app=setup(t,'supervisor.html',{
    mentor_applications:[
      {id:'a1',applicant_id:'s1',status:'pending',school:'Science',student_number:'26001',study_year:2,cycle_year:2026},
      {id:'a2',applicant_id:'s2',status:'shortlisted',school:'Science',student_number:'26002',study_year:2,cycle_year:2026},
      {id:'a3',applicant_id:'s3',status:'closed',school:'Education',study_year:3,cycle_year:2025}],
    profiles:[{id:'s1',full_name:'Alice',programme_id:1},{id:'s2',full_name:'Bob',programme_id:1},{id:'s3',full_name:'Carol',programme_id:2}],
    programmes:[{id:1,name:'Biology'},{id:2,name:'Teaching'}]
  });
  app.run('supervisor-approvals.js');await settle();
  const d=app.document;
  function filter(id,value){const el=d.querySelector(id);el.value=value;el.dispatchEvent(new app.w.Event('input',{bubbles:true}));}
  filter('#application-school','Science');filter('#application-programme','Biology');filter('#application-study-year','2');filter('#application-target-year','2027');
  assert.match(d.querySelector('#application-filter-summary').textContent,/Showing 2 of 3/);
  filter('#application-status','shortlisted');
  assert.equal(d.querySelector('#applications-count').textContent,'0');assert.equal(d.querySelector('#shortlisted-count').textContent,'1');
  filter('#application-search','26001');assert.match(d.querySelector('#application-filter-summary').textContent,/Showing 0 of 3/);
  d.querySelector('#approvals-refresh').click();await settle();
  assert.equal(d.querySelector('#application-school').value,'Science');assert.match(d.querySelector('#application-filter-summary').textContent,/Showing 0 of 3/);
  d.querySelector('#application-filters').reset();await new Promise(r=>setTimeout(r,20));
  assert.match(d.querySelector('#application-filter-summary').textContent,/Showing 3 of 3/);
  assert.match(d.querySelector('#mentor-approval-list').textContent,/Closed/);
});

test('mentor application refresh uses the latest response and keeps loading distinct from empty filters',async(t)=>{
  const app=setup(t,'supervisor.html',{
    mentor_applications:[],profiles:[{id:'old',full_name:'Old Applicant'},{id:'new',full_name:'Latest Applicant'}]
  });
  app.run('supervisor-approvals.js');await settle();
  const originalAll=app.w.fyeAcademic.all,pending=[];
  app.w.fyeAcademic.all=(table,...args)=>table==='mentor_applications'
    ? new Promise(resolve=>pending.push(resolve)):originalAll(table,...args);
  const d=app.document;
  d.querySelector('#approvals-refresh').click();d.querySelector('#approvals-refresh').click();
  const search=d.querySelector('#application-search');search.value='latest';search.dispatchEvent(new app.w.Event('input',{bubbles:true}));
  assert.equal(d.querySelector('#mentor-approval-list').getAttribute('aria-busy'),'true');
  assert.equal(d.querySelector('[data-filter-empty]'),null);
  assert.match(d.querySelector('#application-filter-summary').textContent,/Loading mentor applications/);
  pending[1]([{id:'new',applicant_id:'new',status:'shortlisted'}]);await settle();
  assert.match(d.querySelector('#mentor-shortlisted-list').textContent,/Latest Applicant/);
  assert.equal(d.querySelector('#shortlisted-count').textContent,'1');
  pending[0]([{id:'old',applicant_id:'old',status:'pending'}]);await settle();
  assert.doesNotMatch(d.querySelector('#mentor-approval-list').textContent,/Old Applicant/);
  assert.match(d.querySelector('#application-filter-summary').textContent,/Showing 1 of 1/);
  assert.equal(d.querySelector('#mentor-approval-list').getAttribute('aria-busy'),'false');
});

test('mentor application load errors clear counts, retain filters and recover on refresh',async(t)=>{
  const app=setup(t,'supervisor.html',{
    mentor_applications:[{id:'a',applicant_id:'s',status:'pending',school:'Science'}],profiles:[{id:'s',full_name:'Applicant'}]
  });
  app.run('supervisor-approvals.js');await settle();
  const d=app.document,school=d.querySelector('#application-school');school.value='Science';
  const originalAll=app.w.fyeAcademic.all;
  app.w.fyeAcademic.all=(table,...args)=>table==='mentor_applications'?Promise.reject({message:'Connection interrupted'}):originalAll(table,...args);
  d.querySelector('#approvals-refresh').click();await settle();
  assert.equal(d.querySelector('#applications-count').textContent,'0');
  assert.match(d.querySelector('#application-filter-summary').textContent,/unavailable/);
  school.dispatchEvent(new app.w.Event('change',{bubbles:true}));
  assert.match(d.querySelector('#mentor-approval-list').textContent,/unavailable/);
  assert.equal(d.querySelector('[data-filter-empty]'),null);
  app.w.fyeAcademic.all=originalAll;d.querySelector('#approvals-refresh').click();await settle();
  assert.equal(school.value,'Science');assert.match(d.querySelector('#application-filter-summary').textContent,/Showing 1 of 1/);
  assert.equal(d.querySelector('#approval-feedback').textContent,'');
});

test('mentor application search matches normalized name terms and profile student numbers even when record storage fails',async(t)=>{
  const app=setup(t,'supervisor.html',{
    mentor_applications:[{id:'a',applicant_id:'s',status:'pending',academic_record_path:'record.pdf'}],
    profiles:[{id:'s',first_name:'Lérato',last_name:'Dlamini',student_number:'260000001',programme_id:501}],
    programmes:Array.from({length:501},(_,i)=>({id:i+1,name:i===500?'Last Programme':`Programme ${i+1}`}))
  });
  app.w.fyeSupabase.storage.from=()=>({createSignedUrl:async()=>{throw Error('Storage unavailable');}});
  app.run('supervisor-approvals.js');await settle();
  const d=app.document,search=d.querySelector('#application-search');
  search.value='DLAMINI lerato';search.dispatchEvent(new app.w.Event('input',{bubbles:true}));
  assert.match(d.querySelector('#mentor-approval-list').textContent,/Lérato Dlamini.*260000001.*Last Programme.*Record unavailable/);
  assert.match(d.querySelector('#application-filter-summary').textContent,/Showing 1 of 1/);
  search.value='260000001';search.dispatchEvent(new app.w.Event('input',{bubbles:true}));
  assert.equal(d.querySelector('#applications-count').textContent,'1');
});

test('assignment lists are grouped by mentor and closed until requested',async(t)=>{
  const app=setup(t,'supervisor.html',{
    profiles:[{id:'m1',full_name:'Mentor One',role:'mentor',is_active:true,mentor_approval_status:'approved'},{id:'s1',full_name:'Student One',role:'student',is_active:true}],
    mentor_assignments:[{id:1,mentor_id:'m1',student_id:'s1',ended_at:null,assigned_at:'2020-10-18',effective_end_at:'2099-01-01'}],mentor_applications:[],
    mentor_appointments:[{id:'appointment',mentor_id:'m1',starts_at:'2020-01-01',ended_at:null,paused:false}]
  });
  app.run('supervisor.js');await settle();
  const group=app.document.querySelector('.match-mentor-card');
  assert.ok(group);assert.equal(group.open,false);assert.match(group.querySelector('summary').textContent,/Mentor One.*1 \/ 20/);
  assert.equal(app.document.querySelector('.assignment-match-details').open,false);
  assert.match(app.document.querySelector('#assignment-match-summary').textContent,/1 active matches/);
});

test('every admin metric has details and its own report; event attendance opens accounts',async(t)=>{
  const events=[{event_id:7,title:'Faculty event',students_attended:1,total_attendance:1}];
  const app=setup(t,'admin.html',{},async(name)=>({data:name==='get_admin_event_attendance'
    ?[{profile_id:'s1',name:'Student One',role:'student',method:'qr'}]:events}));
  app.run('admin-details.js');
  app.document.dispatchEvent(new app.w.CustomEvent('fye:admin-data',{detail:{profiles:[{id:'s1',full_name:'Student One',email:'student@example.test',role:'student'}],faculties:[],programmes:[]}}));
  const cards=app.document.querySelectorAll('.admin-metric');
  assert.equal(cards.length,10);for(const card of cards) assert.equal(card.querySelectorAll('button').length,2);
  cards[2].querySelector('button').click();await settle();
  assert.equal(app.document.querySelector('#admin-detail-dialog').open,true);
  const eventLink=[...app.document.querySelectorAll('#admin-detail-content button')].find(button=>button.textContent==='Faculty event');
  eventLink.click();await settle();
  assert.match(app.document.querySelector('#admin-detail-feedback').textContent,/1 students attended/);
  [...app.document.querySelectorAll('#admin-detail-content button')].find(button=>button.textContent==='Student One').click();
  assert.match(app.document.querySelector('#admin-detail-content').textContent,/student@example.test/);
  let blob;app.w.Blob=Blob;app.w.URL.createObjectURL=file=>{blob=file;return 'blob:test';};app.w.URL.revokeObjectURL=()=>{};
  app.w.HTMLAnchorElement.prototype.click=function(){};
  cards[2].querySelectorAll('button')[1].click();await settle();
  assert.ok(blob);assert.match(await blob.text(),/students_attended/);
  assert.equal(app.calls.at(-1).args.p_metric,'events');
});

test('programme account dropdown opens the selected account',async(t)=>{
  const app=setup(t,'admin.html',{
    profiles:[{id:'s1',role:'student',is_active:true,full_name:'Student One',faculty_id:1,programme_id:10}],
    faculties:[{id:1,name:'Science'}],programmes:[{id:10,faculty_id:1,name:'Biology'}]
  },async()=>({data:{}}));
  app.run('admin-details.js');app.run('admin.js');await settle();
  const account=app.document.querySelector('.programme-account-list button');
  assert.ok(account);account.click();
  assert.equal(app.document.querySelector('#admin-detail-title').textContent,'Student One');
});

test('notice duration creates an expiry date and expired notices have no stop action',async(t)=>{
  const app=setup(t,'admin.html',{system_notices:[{id:1,title:'Old update',is_active:true,starts_at:'2020-01-01',ends_at:'2020-01-02'}]});
  app.run('admin-notices.js');await settle();
  assert.match(app.document.querySelector('#notice-list').textContent,/Expired/);
  assert.equal(app.document.querySelector('#notice-list .notice-stop-button'),null);
  app.document.querySelector('#notice-title').value='Application updates';app.document.querySelector('#notice-message').value='Announcement';
  app.document.querySelector('#notice-starts-at').value='2026-10-20T10:00';app.document.querySelector('#notice-duration-days').value='7';
  app.document.querySelector('#notice-form').dispatchEvent(new app.w.Event('submit',{cancelable:true}));await settle();
  const payload=app.calls.find(call=>call.table==='system_notices'&&call.insert)?.insert;
  assert.ok(payload);assert.equal(payload.title,'Application updates');assert.equal(Date.parse(payload.ends_at)-Date.parse(payload.starts_at),7*86400000);
});

test('approved events leave the request workspace and expose recorded attendance in the calendar',async(t)=>{
  const app=setup(t,'supervisor.html',{
    event_requests:[{id:'r1',status:'pending',mentor_id:'m1',title:'Pending request',event_date:'2027-01-01',event_time:'12:00',venue:'Hall'},
      {id:'r2',status:'approved',mentor_id:'m1',title:'Approved request'}],
    calendar_events:[{id:7,title:'Approved request',event_status:'scheduled',event_type:'event',starts_at:'2027-01-01T10:00Z',ends_at:'2027-01-01T12:00Z'}],
    event_attendance:[{id:'a1',calendar_event_id:7,attendee_id:'s1',is_valid:true,attendance_method:'qr',checked_in_at:'2026-10-18T10:00Z'}],
    profiles:[{id:'s1',full_name:'Student One',role:'student'}],event_activity_log:[],event_cancellation_requests:[]
  });
  const calendar=app.document.createElement('section');calendar.className='page-view';calendar.dataset.page='calendar';app.document.body.appendChild(calendar);
  app.run('event-workflow.js');await settle();
  assert.equal(app.document.querySelector('#published-event-management').parentElement,calendar);
  assert.match(app.document.querySelector('#event-request-list').textContent,/Pending request/);
  assert.doesNotMatch(app.document.querySelector('#event-request-list').textContent,/Approved request/);
  assert.match(app.document.querySelector('#supervisor-event-list').textContent,/1 students attended/);
});

test('mentor cancellation submits the reason and displays the pending approval state',async(t)=>{
  const requests=[];
  const app=setup(t,'mentor.html',{
    event_requests:[{id:'r1',status:'approved',mentor_id:'actor',calendar_event_id:7,title:'Workshop'}],
    calendar_events:[{id:7,event_status:'scheduled',ends_at:'2027-01-01'}],event_cancellation_requests:requests
  },async(name,args)=>{
    if(name==='request_event_cancellation')requests.push({calendar_event_id:args.p_event_id,status:'pending',reason:args.p_reason});
    return {};
  });
  const calendar=app.document.createElement('section');calendar.className='page-view';calendar.dataset.page='calendar';app.document.body.appendChild(calendar);
  app.run('event-workflow.js');await settle();
  const form=app.document.querySelector('#mentor-event-requests form');assert.ok(form);
  form.querySelector('textarea').value='Venue unavailable';form.dispatchEvent(new app.w.Event('submit',{cancelable:true}));await settle();
  assert.equal(app.calls.find(call=>call.name==='request_event_cancellation').args.p_reason,'Venue unavailable');
  assert.match(app.document.querySelector('#mentor-event-requests').textContent,/Waiting for supervisor review/);
});

test('CSV reports preserve Unicode and escape spreadsheet formulas',async(t)=>{
  const app=setup(t,'admin.html');app.run('admin-details.js');
  let blob;app.w.Blob=Blob;app.w.URL.createObjectURL=file=>{blob=file;return 'blob:test';};app.w.URL.revokeObjectURL=()=>{};
  app.w.HTMLAnchorElement.prototype.click=function(){};
  app.w.fyeAdminDetails.exportCSV('Accounts',[{name:'Tšhifhiwa',email:'=HYPERLINK("bad")'}],'Current totals');
  const csv=await blob.text();assert.match(csv,/Tšhifhiwa/);assert.match(csv,/'=HYPERLINK/);
});

test('first contact opens the chosen student introduction, preserves drafts and logs only after sending',async(t)=>{
  const tables={profiles:[{id:'s1',role:'student',full_name:'Lerato One'},{id:'s2',role:'student',full_name:'Sipho Two'}],
    active_mentor_assignments:[{id:1,mentor_id:'actor',student_id:'s1'},{id:2,mentor_id:'actor',student_id:'s2'}],mentor_contact_status:[],mentor_student_messages:[]};
  const app=setup(t,'mentor.html',tables,async(name,args)=>{
    if(name==='mentor_application_is_approved')return {data:true};
    if(name==='send_mentor_student_message')tables.mentor_student_messages.push({id:'message',mentor_id:'actor',student_id:args.p_recipient_id,sender_id:'actor',body:args.p_body,created_at:new Date().toISOString()});
    if(name==='record_mentor_contact')tables.mentor_contact_status.push({mentor_id:'actor',student_id:args.p_student_id,last_contact_at:new Date().toISOString()});
    return {};
  });
  app.run('messages.js');app.run('mentor.js');await settle();
  const input=app.document.querySelector('#mentor-message-body'),select=app.document.querySelector('#mentor-message-student');
  input.value='My unsent note for Lerato';
  app.document.querySelectorAll('.mentor-contact-log-button')[1].click();await settle();
  assert.equal(app.document.querySelector('[data-page="messages"]').hidden,false);assert.equal(select.value,'s2');
  assert.match(input.value,/Hi Sipho.*Test User/);assert.equal(app.calls.some(c=>c.name==='record_mentor_contact'||c.name==='send_mentor_student_message'),false);
  input.value='An edited introduction for Sipho';
  select.value='s1';select.dispatchEvent(new app.w.Event('change'));await settle();assert.equal(input.value,'My unsent note for Lerato');
  app.document.querySelectorAll('.mentor-contact-log-button')[1].click();await settle();assert.equal(input.value,'An edited introduction for Sipho');
  app.document.querySelector('#mentor-message-form').dispatchEvent(new app.w.Event('submit',{cancelable:true}));await settle();
  const send=app.calls.find(c=>c.name==='send_mentor_student_message'),contact=app.calls.find(c=>c.name==='record_mentor_contact');
  assert.equal(send.args.p_recipient_id,'s2');assert.equal(send.args.p_body,'An edited introduction for Sipho');assert.equal(contact.args.p_student_id,'s2');
  assert(app.calls.indexOf(send)<app.calls.indexOf(contact));assert.equal(input.value,'');
});

test('failed introduction keeps the draft and never records contact',async(t)=>{
  const app=setup(t,'mentor.html',{profiles:[{id:'s1',full_name:'Student One',role:'student'}],active_mentor_assignments:[{id:1,mentor_id:'actor',student_id:'s1'}]},async(name)=>name==='send_mentor_student_message'?{error:{message:'Try later'}}:{data:true});
  app.run('messages.js');await settle();const input=app.document.querySelector('#mentor-message-body');input.value='My introduction';
  app.document.querySelector('#mentor-message-form').dispatchEvent(new app.w.Event('submit',{cancelable:true}));await settle();
  assert.equal(input.value,'My introduction');assert.equal(app.calls.some(c=>c.name==='record_mentor_contact'),false);
  assert.equal(app.document.querySelector('#mentor-message-form button').disabled,false);
});

test('mentor requests show nearest upcoming first and keep past, rejected and cancelled history collapsed',async(t)=>{
  const app=setup(t,'mentor.html',{event_requests:[
    {id:'far',mentor_id:'actor',title:'Far workshop',event_date:'2099-05-02',event_time:'10:00',status:'pending'},
    {id:'past',mentor_id:'actor',title:'Old workshop',event_date:'2000-01-01',event_time:'10:00',status:'approved'},
    {id:'near',mentor_id:'actor',title:'Next workshop',event_date:'2099-04-01',event_time:'10:00',status:'pending'},
    {id:'cancel',mentor_id:'actor',calendar_event_id:20,title:'Cancelled workshop',event_date:'2099-04-03',event_time:'10:00',status:'approved'},
    {id:'rejected',mentor_id:'actor',title:'Declined workshop',event_date:'2099-04-04',event_time:'10:00',status:'rejected'}
  ],event_cancellation_requests:[{calendar_event_id:20,status:'completed',reason:'Venue unavailable'}]});
  app.run('event-workflow.js');await settle();
  assert.equal(app.document.querySelectorAll('#mentor-event-requests').length,1);
  const list=app.document.querySelector('#mentor-event-requests');
  assert.deepEqual([...list.querySelectorAll(':scope > .event-request-list > article h4')].map(n=>n.textContent),['Next workshop','Far workshop']);
  const history=list.querySelector('.request-history');assert.equal(history.open,false);assert.equal(history.querySelectorAll('.is-past').length,3);
  assert.match(history.textContent,/This event was cancelled/);assert.equal(list.querySelectorAll('form').length,0);
});

test('sidebar badges retain review counts and omit admin and supervisor directory totals',async(t)=>{
  const app=setup(t,'supervisor.html',{mentor_applications:[{id:'a',status:'pending'},{id:'b',status:'shortlisted'},{id:'c',status:'approved',replacement_review_required:false}],event_requests:[{id:'e',status:'pending'}],event_cancellation_requests:[{id:'c',status:'approved'}]});
  app.run('dashboard-counts.js');await settle();
  const badge=view=>app.document.querySelector(`[data-view="${view}"] .nav-count`);
  assert.equal(badge('mentor-applications').textContent,'2');assert.equal(badge('event-requests').textContent,'2');
  app.document.dispatchEvent(new app.w.CustomEvent('fye:supervisor-academic-data',{detail:{profiles:[{id:'s',role:'student'},{id:'m',role:'mentor'}],appointments:[{mentor_id:'m',starts_at:'2020-01-01'}],assignments:[{assigned_at:'2020-01-01',mentor_id:'m',student_id:'s'}]}}));
  assert.equal(badge('students'),null);assert.equal(badge('mentors'),null);assert.equal(badge('assignments'),null);
  app.w.fyeNavCounts.set('students',200,'students');assert.equal(badge('students'),null);
  app.tables.mentor_applications.splice(0,1);app.w.dispatchEvent(new app.w.CustomEvent('fye:counts-refresh'));await settle();assert.equal(badge('mentor-applications').textContent,'1');
  const admin=setup(t,'admin.html');admin.run('dashboard-counts.js');await settle();
  admin.document.dispatchEvent(new admin.w.CustomEvent('fye:admin-data',{detail:{profiles:Array.from({length:1600},(_,id)=>({id})),programmes:Array(32).fill({})}}));
  assert.equal(admin.document.querySelector('[data-view="users"] .nav-count'),null);
  assert.equal(admin.document.querySelector('[data-view="setup"] .nav-count'),null);
});

test('student directory dropdowns apply immediately, combine filters and clear stale faculty selections',async(t)=>{
  const app=setup(t,'supervisor.html',{
    faculties:[{id:1,name:'Science'},{id:2,name:'Education'}],
    programmes:[{id:10,faculty_id:1,name:'Biology'},{id:11,faculty_id:1,name:'Ecology'},{id:20,faculty_id:2,name:'Teaching'}],
    profiles:[{id:'m',role:'mentor',full_name:'Mentor',faculty_id:1,programme_id:10},
      {id:'s1',role:'student',is_active:true,full_name:'Lérato Dlamini',student_number:'260000001',faculty_id:1,programme_id:10,entry_status:'first_time',study_year:1},
      {id:'s2',role:'student',is_active:true,full_name:'Lerato Dlamini',student_number:'240000002',faculty_id:1,programme_id:11,entry_status:'returning',study_year:3},
      {id:'s3',role:'student',is_active:true,full_name:'Other Student',student_number:'260000003',faculty_id:2,programme_id:20,entry_status:'first_time',study_year:1}],
    mentor_appointments:[{mentor_id:'m',starts_at:'2020-01-01'}],
    mentor_assignments:[{student_id:'s1',mentor_id:'m',assigned_at:'2020-01-01'}]
  });
  app.run('supervisor.js');await settle();
  const change=(id,value)=>{const input=app.document.querySelector('#student-filter-'+id);input.value=value;input.dispatchEvent(new app.w.Event('change'));};
  const rows=()=>app.document.querySelector('#students-list').textContent;
  change('programme','11');assert.match(rows(),/240000002/);assert.doesNotMatch(rows(),/260000001/);
  change('faculty','2');assert.match(rows(),/260000003/);assert.equal(app.document.querySelector('#student-filter-programme').value,'');
  assert.equal(app.document.querySelector('#student-filter-programme option[value="10"]'),null);
  app.document.querySelector('#student-filter-clear').click();
  app.document.querySelector('#student-filter-search').value='DLAMINI lerato';app.document.querySelector('#student-filter-apply').click();
  assert.match(rows(),/260000001/);assert.match(rows(),/240000002/);assert.doesNotMatch(rows(),/260000003/);
  change('assignment','unassigned');assert.match(rows(),/240000002/);assert.doesNotMatch(rows(),/260000001/);
  change('mentor','m');assert.match(rows(),/260000001/);assert.equal(app.document.querySelector('#student-filter-assignment').value,'assigned');
  change('assignment','unassigned');assert.equal(app.document.querySelector('#student-filter-mentor').value,'');
  change('year','3');change('entry','returning');assert.match(rows(),/240000002/);
  app.document.querySelector('#student-filter-clear').click();
  app.document.querySelector('#student-filter-search').value='260000003';app.document.querySelector('#student-filter-apply').click();assert.match(rows(),/Other Student/);
  app.document.querySelector('.student-view-btn').click();assert.match(app.document.querySelector('#student-detail-content').textContent,/260000003/);
  assert.match(app.document.querySelector('#student-result-count').textContent,/of 1 results/);
});

test('admin distinguishes namesakes, paginates accounts and filters by student number and status',async(t)=>{
  const profiles=Array.from({length:60},(_,i)=>({id:'s'+i,role:'student',full_name:'Lerato Dlamini',student_number:String(260000000+i),is_active:i!==59,faculty_id:1,programme_id:i%2?10:11}));
  const app=setup(t,'admin.html',{profiles,faculties:[{id:1,name:'Science'}],programmes:[{id:10,faculty_id:1,name:'Biology'},{id:11,faculty_id:1,name:'Ecology'}]},async()=>({data:{}}));
  app.run('admin-details.js');app.run('admin.js');await settle();
  assert.equal(app.document.querySelectorAll('#user-list tr').length,25);
  app.document.querySelector('#user-pagination button[aria-label="Next page of accounts"]').click();
  assert.match(app.document.querySelector('#user-results-count').textContent,/26–50 of 60/);
  const input=app.document.querySelector('#user-search');input.value='260000059';input.dispatchEvent(new app.w.Event('input'));
  assert.equal(app.document.querySelectorAll('#user-list tr').length,1);assert.match(app.document.querySelector('#user-list').textContent,/260000059/);
  app.document.querySelector('#user-list .text-button').click();assert.match(app.document.querySelector('#admin-detail-content').textContent,/260000059/);
  const faculty=app.document.querySelector('#user-faculty-filter');faculty.value='1';faculty.dispatchEvent(new app.w.Event('change'));
  const programme=app.document.querySelector('#user-programme-filter');programme.value='11';programme.dispatchEvent(new app.w.Event('change'));
  assert.match(app.document.querySelector('#user-list').textContent,/No profiles match/);
  app.document.querySelector('#users-clear-filters').click();
  const status=app.document.querySelector('#user-status-filter');status.value='disabled';status.dispatchEvent(new app.w.Event('change'));
  assert.equal(app.document.querySelectorAll('#user-list tr').length,1);assert.match(app.document.querySelector('#user-list').textContent,/260000059/);
  const groups=[...app.document.querySelectorAll('.programme-account-list')];
  for(const group of groups){for(const button of group.querySelectorAll('button')){
    const account=profiles.find(p=>p.id===button.dataset.profileId);assert.ok(account);assert.match(button.textContent,new RegExp(account.student_number));
  }}
});

test('academic catalogue stays collapsed, searches programmes and retains edit actions',async(t)=>{
  const app=setup(t,'admin.html',{faculties:[{id:1,name:'Science'},{id:2,name:'Education'}],programmes:[{id:10,faculty_id:1,name:'Biology'},{id:11,faculty_id:1,name:'Ecology'},{id:20,faculty_id:2,name:'Teaching'}]});
  app.run('dashboard-ui.js');app.run('admin-academic.js');await settle();
  assert.equal(app.document.querySelector('.academic-collection').open,false);
  const groups=app.document.querySelectorAll('#programme-manage-list > li > details[data-faculty-id]');assert.equal(groups.length,2);groups.forEach(group=>assert.equal(group.open,false));
  const input=app.document.querySelector('#programme-manage-search');input.value='ecology science';input.dispatchEvent(new app.w.Event('input'));await settle();
  assert.equal(app.document.querySelectorAll('.academic-programme-item').length,1);assert.equal(app.document.querySelector('#programme-manage-list details').open,true);
  const row=app.document.querySelector('.academic-programme-item');assert.match(row.textContent,/Ecology/);assert.match(row.textContent,/Rename.*Delete.*Qualification/);assert.ok(row.querySelector('.dashboard-action-menu'));
  input.value='no such programme';input.dispatchEvent(new app.w.Event('input'));assert.match(app.document.querySelector('#programme-manage-list').textContent,/No programmes match/);
  input.value='';input.dispatchEvent(new app.w.Event('input'));assert.equal(app.document.querySelectorAll('.academic-programme-item').length,3);
});

test('student and mentor collection badges count only current matches and upcoming events without replacing unread notifications',async(t)=>{
  for(const page of ['student.html','mentor.html']) {
    const mentor=page==='mentor.html';
    const app=setup(t,page,{mentor_student_conversations:[{id:1}],active_mentor_assignments:[{id:1,mentor_id:mentor?'actor':'mentor',student_id:mentor?'student':'actor'}],calendar_events:[
      {id:1,event_type:'event',event_status:'scheduled',starts_at:'2099-04-01'},
      {id:2,event_type:'event',event_status:'scheduled',starts_at:'2000-04-01'},
      {id:3,event_type:'event',event_status:'cancelled',starts_at:'2099-04-01'}
    ]});
    app.document.querySelector('#notification-count').textContent='7';
    app.run('dashboard-counts.js');await settle();
    for(const view of [mentor?'students':'mentor','messages','calendar'])assert.equal(app.document.querySelector(`[data-view="${view}"] .nav-count`).textContent,'1');
    assert.equal(app.document.querySelector('#notification-count').textContent,'7');assert.equal(app.document.querySelector('[data-view="overview"] .nav-count'),null);
  }
});
