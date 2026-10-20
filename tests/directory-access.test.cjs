const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const load=n=>fs.readFileSync(path.join(__dirname,'..',n),'utf8');
const id=n=>'30000000-0000-0000-0000-'+String(n).padStart(12,'0');
test('full population directory skips relationship checks for staff and retains student/mentor isolation',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(load('tests/fixtures/deployed-contract.sql'));
 for(const name of ['20261019000000_academic_lifecycle.sql','20261019010000_demo_cohort_and_seeding.sql','20261019020000_academic_clients_and_analytics.sql'])await db.exec(load('database/'+name));
 await db.exec(`CREATE OR REPLACE FUNCTION fye_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT DATE '2026-10-19' $$;
 INSERT INTO faculties(id,name) OVERRIDING SYSTEM VALUE VALUES(1,'Science'),(2,'Education');
 INSERT INTO programmes(id,faculty_id,name,qualification_level,max_study_year,first_time_entry) OVERRIDING SYSTEM VALUE VALUES(1,1,'BSc','undergraduate',3,true);
 INSERT INTO auth.users(id,email,email_confirmed_at) SELECT ('30000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'scale.'||n||'@example.test',now() FROM generate_series(1,1666) n;
 UPDATE profiles SET programme_id=1,faculty_id=1,study_year=1,entry_status='first_time',first_entry_year=2026,student_number='26'||lpad(right(id::text,12)::integer::text,7,'0');
 UPDATE profiles SET role='admin' WHERE id='${id(1)}';UPDATE profiles SET role='supervisor' WHERE id='${id(2)}';
 UPDATE profiles SET role='mentor',study_year=2,entry_status='returning',first_entry_year=2025 WHERE right(id::text,12)::integer BETWEEN 3 AND 27;
 UPDATE profiles SET academic_verified_at=now();
 INSERT INTO mentor_appointments(mentor_id,starts_at) SELECT id,now()-interval '1 day' FROM profiles WHERE role='mentor';
 INSERT INTO mentor_assignments(student_id,mentor_id,assigned_by)
 SELECT ('30000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('30000000-0000-0000-0000-'||lpad((3+(n-28)/20)::text,12,'0'))::uuid,'${id(2)}'::uuid FROM generate_series(28,527) n;
 INSERT INTO calendar_events(title,event_type,starts_at,created_by,audience,faculty_id,faculty_only)
 VALUES('Science workshop','event',now()+interval '1 day','${id(2)}','university',1,true),('Education workshop','event',now()+interval '1 day','${id(2)}','university',2,true);`);
 await db.exec(load('database/20261019050000_dashboard_read_performance.sql'));
 const original=(await db.query("SELECT pg_get_functiondef('mentor_application_is_approved(uuid)'::regprocedure) AS sql")).rows[0].sql;
 await db.exec(`CREATE OR REPLACE FUNCTION mentor_application_is_approved(p_profile_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN RAISE EXCEPTION 'Staff directory must skip per-relationship authority checks'; END $$;`);
 async function countAs(n,table='profiles'){await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id(n)]);await db.exec('SET ROLE authenticated');try{return Number((await db.query('SELECT count(*) AS n FROM '+table)).rows[0].n);}finally{await db.exec('RESET ROLE');await db.exec("SELECT set_config('request.jwt.claim.sub','',false)");}}
 assert.equal(await countAs(1),1666);assert.equal(await countAs(2),1666);
 await db.exec(original);
 assert.equal(await countAs(3),21,'Mentor sees self and twenty active mentees.');
 assert.equal(await countAs(28),2,'Matched student sees self and own mentor.');
 assert.equal(await countAs(1000),1,'Unassigned student sees self only.');
 assert.equal(await countAs(28,'calendar_events'),1,'Student sees only own-faculty events at full volume.');
 assert.equal(await countAs(3,'calendar_events'),1,'Mentor sees only own-faculty events.');
 assert.equal(await countAs(2,'calendar_events'),2,'Supervisor can manage events in both faculties.');
 await db.exec(load('database/20261019050000_dashboard_read_performance.sql'));
 assert.equal(await countAs(2),1666,'Reapplying the optimisation preserves directory access.');
});
