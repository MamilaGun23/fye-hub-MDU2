const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const load=n=>fs.readFileSync(path.join(__dirname,'..',n),'utf8');
const id=n=>`10000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
test('academic lifecycle and cohort isolation execute against the deployed schema contract',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(load('tests/fixtures/deployed-contract.sql'));
 await db.exec(load('database/20261019000000_academic_lifecycle.sql'));
 await db.exec(load('database/20261019010000_demo_cohort_and_seeding.sql'));
 await db.exec(load('database/20261019020000_academic_clients_and_analytics.sql'));
 await db.exec(`CREATE SCHEMA cron; CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;`);
 await db.exec(load('database/20261019040000_demo_workflows_and_schedule.sql'));
 await db.exec(`CREATE OR REPLACE FUNCTION fye_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT DATE '2026-10-19' $$;
 INSERT INTO faculties(id,name) OVERRIDING SYSTEM VALUE VALUES(1,'Science'),(2,'Education');
 INSERT INTO programmes(id,faculty_id,name,qualification_level,max_study_year,first_time_entry) OVERRIDING SYSTEM VALUE
 VALUES(1,1,'BSc','undergraduate',3,true),(2,1,'MSc','masters',2,false),(3,2,'BEd','undergraduate',4,true);
 INSERT INTO fye_demo_batches(id,plan_hash) VALUES('demo-test','hash');`);
 for(const [n,role,prog,entry,year,batch] of [[1,'supervisor',null,null,null,null],[2,'admin',null,null,null,null],
 [3,'student',1,'first_time',1,null],[4,'student',1,'returning',1,null],[5,'student',2,'returning',1,null],
 [6,'student',1,'returning',2,null],[7,'supervisor',null,null,null,'demo-test'],[8,'student',1,'first_time',1,'demo-test'],[9,'student',1,'returning',2,'demo-test']]){
 await db.query(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())`,[id(n),`person${n}@example.test`]);
 await db.query(`UPDATE profiles SET role=$2,programme_id=$3,faculty_id=CASE WHEN $3::bigint IS NULL THEN NULL ELSE 1 END,entry_status=$4,study_year=$5,
 first_entry_year=CASE WHEN $4='first_time' THEN 2026 ELSE 2023 END,student_number=$6,demo_batch=$7 WHERE id=$1`,[id(n),role,prog,entry,year,`26${String(n).padStart(7,'0')}`,batch]);
 await db.query(`UPDATE profiles SET academic_verified_at=now() WHERE id=$1`,[id(n)]);
 }
 async function asUser(n,sql,params=[]){
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[id(n)]); await db.exec('SET ROLE authenticated');
  try{return await db.query(sql,params);}finally{await db.exec('RESET ROLE');await db.exec(`SELECT set_config('request.jwt.claim.sub','',false)`);}
 }
 const setDay=day=>db.exec(`CREATE OR REPLACE FUNCTION fye_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT DATE '${day}' $$;`);
 let firstApplication;
 await t.test('only verified first-time undergraduates qualify as mentees',async()=>{
  assert.equal((await db.query('SELECT fye_eligible_mentee($1) AS ok',[id(3)])).rows[0].ok,true);
  for(const n of [4,5,6])assert.equal((await db.query('SELECT fye_eligible_mentee($1) AS ok',[id(n)])).rows[0].ok,false);
  assert.equal((await asUser(3,'UPDATE profiles SET academic_verified_at=now() WHERE id=$1 RETURNING id',[id(3)])).rows.length,0);
  await db.query(`UPDATE profiles SET role='mentor' WHERE id=$1`,[id(6)]);
  await assert.rejects(asUser(6,'UPDATE profiles SET academic_verified_at=now() WHERE id=$1',[id(6)]),/authorised/);
 });
 await db.query(`INSERT INTO mentor_appointments(mentor_id,starts_at) VALUES($1,now()-interval '1 day'),($2,now()-interval '1 day')`,[id(6),id(9)]);
 await t.test('manual assignment fills assigned_by and rejects returning students and cross-batch pairs',async()=>{
  await asUser(1,'SELECT assign_students_to_mentor($1,$2::uuid[])',[id(6),[id(3)]]);
  const a=(await db.query('SELECT * FROM mentor_assignments WHERE student_id=$1',[id(3)])).rows[0];
  assert.equal(a.assigned_by,id(1));assert.equal(a.academic_year,2026);
  await assert.rejects(asUser(1,'SELECT assign_students_to_mentor($1,$2::uuid[])',[id(6),[id(4)]]),/first-time/);
  await assert.rejects(asUser(1,'SELECT assign_students_to_mentor($1,$2::uuid[])',[id(6),[id(8)]]),/cohort/);
 });
 await t.test('first-years submit without results; returning applicants require evidence',async()=>{
  const result=await asUser(3,`SELECT save_mentor_application($1,true) AS id`,[{school:'Science'}]);
  const aid=result.rows[0].id;
  firstApplication=aid;
  await asUser(1,`SELECT review_mentor_application($1,'shortlisted',NULL)`,[aid]);
  await assert.rejects(asUser(1,`SELECT review_mentor_application($1,'approved',NULL)`,[aid]),/Verify academic/);
  assert((await db.query('SELECT count(*)::integer AS n FROM mentor_application_history WHERE application_id=$1',[aid])).rows[0].n>=2);
  await assert.rejects(asUser(4,`SELECT save_mentor_application($1,true)`,[{school:'Science'}]),/Upload/);
 });
 await t.test('January rollover retains the previous first-year cohort and excludes new January entrants',async()=>{
  await setDay('2027-01-15');
  for(const n of [10,11]){await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[id(n),`new${n}@example.test`]);
   await db.query(`UPDATE profiles SET programme_id=1,faculty_id=1,entry_status='first_time',first_entry_year=$2,study_year=1,student_number=$3 WHERE id=$1`,[id(n),n===10?2027:2026,`26${String(n).padStart(7,'0')}`]);}
  await assert.rejects(asUser(10,'SELECT save_mentor_application($1,true)',[{school:'Science'}]),/January entrants/);
  await db.query(`UPDATE profiles SET entry_status='returning',study_year=2 WHERE id=$1`,[id(11)]);
  const app=(await asUser(11,'SELECT save_mentor_application($1,true) AS id',[{school:'Science'}])).rows[0].id;
  assert.equal((await db.query('SELECT cohort_snapshot FROM mentor_applications WHERE id=$1',[app])).rows[0].cohort_snapshot.first_time,true);
  await setDay('2027-02-01');
  await assert.rejects(asUser(10,'SELECT save_mentor_application($1,false)',[{school:'Science'}]),/October 1/);
  await setDay('2026-10-19');
 });
 await t.test('first-year approval requires verified progression and replacement evidence resets verification',async()=>{
  await setDay('2027-01-15');
  await db.query(`UPDATE profiles SET entry_status='returning',study_year=2 WHERE id=$1`,[id(3)]);
  await asUser(1,'SELECT verify_academic_details($1)',[id(3)]);
  const academic=id(3)+'/a.pdf',replacement=id(3)+'/b.pdf',registration=id(3)+'/registration.pdf';
  for(const name of [academic,replacement,registration])await db.query(`INSERT INTO storage.objects(bucket_id,name) VALUES('mentor-academic-records',$1)`,[name]);
  await asUser(3,'SELECT complete_mentor_documents($1,$2,$3,2026)',[firstApplication,academic,registration]);
  await asUser(1,'SELECT verify_mentor_documents($1,false,false,2027)',[firstApplication]);
  await assert.rejects(asUser(1,`SELECT review_mentor_application($1,'approved',NULL)`,[firstApplication]),/progression/);
  await asUser(1,'SELECT verify_mentor_documents($1,true,true,2027)',[firstApplication]);
  await assert.rejects(asUser(1,`SELECT review_mentor_application($1,'approved',NULL)`,[firstApplication]),/Verify academic/);
  await asUser(1,'SELECT verify_mentor_documents($1,true,false,2027)',[firstApplication]);
  await asUser(3,'SELECT complete_mentor_documents($1,$2,$3,2026)',[firstApplication,replacement,registration]);
  assert.equal((await db.query('SELECT results_verified_at FROM mentor_applications WHERE id=$1',[firstApplication])).rows[0].results_verified_at,null);
  await assert.rejects(asUser(1,`SELECT review_mentor_application($1,'approved',NULL)`,[firstApplication]),/Verify academic/);
  await asUser(1,'SELECT verify_mentor_documents($1,true,false,2027)',[firstApplication]);
  await asUser(1,`SELECT review_mentor_application($1,'approved',NULL)`,[firstApplication]);
  const starts=(await db.query('SELECT starts_at FROM mentor_appointments WHERE application_id=$1',[firstApplication])).rows[0].starts_at;
  assert(Date.parse(starts)>=Date.parse('2027-01-01T00:00:00+02:00'));
  await asUser(3,'SELECT complete_mentor_documents($1,$2,$3,2026)',[firstApplication,academic,registration]);
  assert.equal((await db.query('SELECT replacement_review_required FROM mentor_applications WHERE id=$1',[firstApplication])).rows[0].replacement_review_required,true);
  assert.equal((await db.query('SELECT paused FROM mentor_appointments WHERE application_id=$1',[firstApplication])).rows[0].paused,true);
  await setDay('2026-10-19');
 });
 await t.test('completion extensions preserve an audit reason without reopening new applications',async()=>{
  const app=(await db.query('SELECT id FROM mentor_applications WHERE applicant_id=$1',[id(11)])).rows[0].id;
  await db.query(`UPDATE mentor_applications SET completion_extension=now()-interval '1 day' WHERE id=$1`,[app]);
  await assert.rejects(asUser(11,'SELECT complete_mentor_documents($1,$2,$3,2026)',[app,id(11)+'/a.pdf',id(11)+'/r.pdf']),/deadline/);
  await asUser(1,"SELECT extend_mentor_completion($1,now()+interval '30 days','Delayed publication confirmed')",[app]);
  const history=(await db.query('SELECT snapshot FROM mentor_application_history WHERE application_id=$1 ORDER BY id DESC LIMIT 1',[app])).rows[0].snapshot;
  assert.equal(history.review_reason,'Delayed publication confirmed');
  await setDay('2027-02-01');
  await assert.rejects(asUser(10,'SELECT save_mentor_application($1,true)',[{school:'Science'}]),/October 1/);
  await setDay('2026-10-19');
 });
 await t.test('postgraduate mappings stay within faculty and share one total capacity of 20',async()=>{
  await db.query(`INSERT INTO mentor_appointments(mentor_id,starts_at) VALUES($1,now()-interval '1 day')`,[id(5)]);
  await asUser(1,'SELECT map_postgraduate_mentor($1,1,false)',[id(5)]);
  await assert.rejects(asUser(1,'SELECT map_postgraduate_mentor($1,3,false)',[id(5)]),/same faculty/);
  await db.exec(`INSERT INTO programmes(id,faculty_id,name,qualification_level,max_study_year) OVERRIDING SYSTEM VALUE VALUES(4,1,'BSc alternate','undergraduate',3);`);
  await asUser(1,'SELECT map_postgraduate_mentor($1,4,false)',[id(5)]);
  const students=[];
  for(let n=12;n<33;n++){await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[id(n),`capacity${n}@example.test`]);
   await db.query(`UPDATE profiles SET faculty_id=1,programme_id=$2,study_year=1,first_entry_year=2026,entry_status='first_time',student_number=$3 WHERE id=$1`,[id(n),n%2?1:4,`26${String(n).padStart(7,'0')}`]);
   await db.query('UPDATE profiles SET academic_verified_at=now() WHERE id=$1',[id(n)]);students.push(id(n));}
  await asUser(1,'SELECT assign_students_to_mentor($1,$2::uuid[])',[id(5),students.slice(0,20)]);
  await assert.rejects(asUser(1,'SELECT assign_students_to_mentor($1,$2::uuid[])',[id(5),students.slice(20)]),/capacity is 20/);
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM active_mentor_assignments WHERE mentor_id=$1',[id(5)])).rows[0].n,20);
 });
 await t.test('demo notices never notify pre-existing users, and seed RPCs reject browser roles',async()=>{
  await db.query(`INSERT INTO system_notices(title,message,starts_at,ends_at,created_by) VALUES('Demo only','Synthetic notice',now(),now()+interval '1 day',$1)`,[id(7)]);
  const n=(await db.query('SELECT recipient_id FROM system_notice_notifications')).rows;
  assert(n.length>0);assert(n.every(r=>[id(7),id(8),id(9)].includes(r.recipient_id)));
  const supervisors=(await db.query('SELECT recipient_id FROM supervisor_notifications WHERE notification_type=\'admin_notice\'')).rows;
  assert(supervisors.every(r=>r.recipient_id===id(7)));
  await assert.rejects(asUser(2,'SELECT demo_seed_status()'),/permission denied/);
 });
 await t.test('appointment ending revokes authority even if old approval flags remain',async()=>{
  await asUser(1,`SELECT manage_mentor_appointment($1,'end','Presentation check')`,[id(6)]);
  assert.equal((await db.query('SELECT mentor_application_is_approved($1) AS ok',[id(6)])).rows[0].ok,false);
 });
});
