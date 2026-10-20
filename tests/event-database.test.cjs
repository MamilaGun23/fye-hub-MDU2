const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// Isolated PostgreSQL fixture for the new migration. This models only the prior
// schema contracts needed by these workflows; it never connects to Supabase.
const schema = `
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::UUID $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE faculties(id BIGINT PRIMARY KEY,name TEXT);
CREATE TABLE programmes(id BIGINT PRIMARY KEY,name TEXT,faculty_id BIGINT);
CREATE TABLE profiles(id UUID PRIMARY KEY,full_name TEXT,email TEXT,role TEXT,is_active BOOLEAN,faculty_id BIGINT,programme_id BIGINT);
GRANT SELECT ON profiles TO authenticated;
CREATE TABLE calendar_events(id BIGSERIAL PRIMARY KEY,title TEXT,event_type TEXT,description TEXT,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,location TEXT,created_by UUID,audience TEXT,organizer_id UUID,attendance_token TEXT,event_status TEXT,cancelled_at TIMESTAMPTZ,cancellation_reason TEXT);
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY old_broad_calendar_access ON calendar_events FOR SELECT TO authenticated USING(true);
CREATE TABLE event_requests(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),mentor_id UUID,title TEXT,purpose TEXT,event_date DATE,event_time TIME,venue TEXT,status TEXT DEFAULT 'pending',approved_by UUID,supervisor_note TEXT,qr_token TEXT,calendar_event_id BIGINT,updated_at TIMESTAMPTZ);
CREATE TABLE event_notifications(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),recipient_id UUID,calendar_event_id BIGINT,event_request_id UUID,notification_type TEXT,title TEXT,message TEXT,scheduled_for TIMESTAMPTZ,qr_token TEXT,UNIQUE(recipient_id,event_request_id,notification_type));
CREATE TABLE event_attendance(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),event_request_id UUID,calendar_event_id BIGINT,attendee_id UUID,recorded_by UUID,is_valid BOOLEAN DEFAULT true,checked_in_at TIMESTAMPTZ DEFAULT now(),attendance_method TEXT,UNIQUE(calendar_event_id,attendee_id));
CREATE TABLE event_activity_log(calendar_event_id BIGINT,actor_id UUID,action_type TEXT,details JSONB);
CREATE TABLE supervisor_notifications(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),recipient_id UUID,notification_type TEXT,subject_id TEXT,title TEXT,message TEXT);
CREATE TABLE mentor_assignments(student_id UUID,mentor_id UUID,assigned_at TIMESTAMPTZ,ended_at TIMESTAMPTZ);
CREATE TABLE system_notices(id BIGSERIAL,title TEXT,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,is_active BOOLEAN);
CREATE FUNCTION mentor_application_is_approved(profile_id UUID) RETURNS BOOLEAN LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM profiles WHERE id=profile_id AND role='mentor' AND is_active=true) $$;
CREATE FUNCTION is_fye_student(profile_id UUID) RETURNS BOOLEAN LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM profiles WHERE id=profile_id AND role IN ('student','mentor') AND is_active=true) $$;
INSERT INTO faculties VALUES(1,'Science'),(2,'Education');
INSERT INTO profiles VALUES
('00000000-0000-0000-0000-000000000001','Mentor One','m1@example.test','mentor',true,1,10),
('00000000-0000-0000-0000-000000000002','Student One','s1@example.test','student',true,1,10),
('00000000-0000-0000-0000-000000000003','Supervisor','super@example.test','supervisor',true,NULL,NULL),
('00000000-0000-0000-0000-000000000004','Admin','admin@example.test','admin',true,NULL,NULL),
('00000000-0000-0000-0000-000000000005','Other student','s2@example.test','student',true,2,20),
('00000000-0000-0000-0000-000000000006','Other mentor','m2@example.test','mentor',true,2,20),
('00000000-0000-0000-0000-000000000007','Disabled','d@example.test','student',false,1,10);
`;
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;

test('faculty events, cancellations and analytics execute in isolated PostgreSQL', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(schema);
  const migration = fs.readFileSync(path.join(__dirname,'..','database','20261010000000_faculty_events_and_dashboard_details.sql'),'utf8');
  await db.exec(migration);
  await db.exec(`CREATE TRIGGER event_request_calendar_sync AFTER INSERT OR UPDATE OF status,calendar_event_id,qr_token ON event_requests FOR EACH ROW EXECUTE FUNCTION sync_event_request_to_calendar();`);
  await db.exec(`CREATE TRIGGER copy_student_event_notifications_to_mentors AFTER INSERT ON event_notifications FOR EACH ROW EXECUTE FUNCTION copy_student_event_notifications_to_mentors();`);
  async function asUser(n, sql, params = []) {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id(n)]);
    await db.exec('SET ROLE authenticated');
    try { return await db.query(sql,params); }
    finally { await db.exec('RESET ROLE'); await db.exec("SELECT set_config('request.jwt.claim.sub','',false)"); }
  }
  let eventId;
  await t.test('request faculty is derived from its mentor and approval creates a BIGINT calendar event',async () => {
    const inserted = await db.query(`INSERT INTO event_requests(mentor_id,title,purpose,event_date,event_time,venue,faculty_id)
      VALUES($1,'Faculty workshop','Study skills',current_date+2,'12:00','Hall',2) RETURNING id,faculty_id`,[id(1)]);
    assert.equal(inserted.rows[0].faculty_id,1);
    await asUser(3,`SELECT review_event_request($1,'approved',NULL)`,[inserted.rows[0].id]);
    const result=await db.query(`SELECT e.id,e.faculty_id,e.organizer_id,e.attendance_token,r.qr_token,r.status FROM calendar_events e JOIN event_requests r ON r.calendar_event_id=e.id`);
    eventId=result.rows[0].id;
    assert.equal(result.rows[0].faculty_id,1);
    assert.equal(result.rows[0].attendance_token,result.rows[0].qr_token);
    assert.equal(result.rows[0].status,'approved');
    const qrNotice=(await db.query("SELECT qr_token FROM event_notifications WHERE recipient_id=$1 AND notification_type='approved'",[id(1)])).rows;
    assert.equal(qrNotice.length,1);assert.equal(qrNotice[0].qr_token,result.rows[0].attendance_token);
    const outside=await db.query('SELECT count(*)::INTEGER AS total FROM event_notifications WHERE recipient_id IN ($1,$2)',[id(5),id(6)]);
    assert.equal(outside.rows[0].total,0);
  });
  await t.test('restrictive RLS overrides an older broad calendar policy',async () => {
    assert.equal((await asUser(2,'SELECT id FROM calendar_events')).rows.length,1);
    assert.equal((await asUser(5,'SELECT id FROM calendar_events')).rows.length,0);
    assert.equal((await asUser(7,'SELECT id FROM calendar_events')).rows.length,0);
    assert.equal((await asUser(4,'SELECT id FROM calendar_events')).rows.length,1);
  });
  await t.test('QR event lookup and attendance reject out-of-faculty students',async () => {
    const token=(await db.query('SELECT attendance_token FROM calendar_events WHERE id=$1',[eventId])).rows[0].attendance_token;
    assert.equal((await asUser(2,'SELECT * FROM get_approved_event_for_attendance($1)',[token])).rows.length,1);
    assert.equal((await asUser(5,'SELECT * FROM get_approved_event_for_attendance($1)',[token])).rows.length,0);
    await assert.rejects(db.query('INSERT INTO event_attendance(calendar_event_id,attendee_id) VALUES($1,$2)',[eventId,id(5)]),/event faculty/);
  });
  await t.test('admin analytics counts actual valid attendance and protects detail RPCs',async () => {
    await db.query("UPDATE calendar_events SET starts_at=now()-INTERVAL '30 minutes',ends_at=now()+INTERVAL '1 hour' WHERE id=$1",[eventId]);
    const token=(await db.query('SELECT attendance_token FROM calendar_events WHERE id=$1',[eventId])).rows[0].attendance_token;
    await asUser(2,'SELECT mark_event_attendance($1)',[token]);
    await asUser(2,'SELECT mark_event_attendance($1)',[token]);
    await assert.rejects(asUser(5,'SELECT mark_event_attendance($1)',[token]),/restricted to its faculty/);
    await db.query(`INSERT INTO event_attendance(calendar_event_id,attendee_id,attendance_method) VALUES($1,$2,'manual')`,[eventId,id(1)]);
    const rows=(await asUser(4,"SELECT get_admin_analytics_details('events',90) AS details")).rows[0].details;
    assert.equal(rows[0].students_attended,1);
    assert.equal(rows[0].total_attendance,2);
    assert.equal((await asUser(4,'SELECT get_admin_event_attendance($1) AS details',[eventId])).rows[0].details.length,2);
    await assert.rejects(asUser(2,"SELECT get_admin_analytics_details('events',90)"),/Active admin/);
  });
  await t.test('mentor requests cancellation; approval leaves the event scheduled until supervisor removal',async () => {
    await assert.rejects(asUser(6,'SELECT request_event_cancellation($1,$2)',[eventId,'No longer available']),/Only the event mentor/);
    await asUser(1,'SELECT request_event_cancellation($1,$2)',[eventId,'Venue unavailable']);
    await assert.rejects(asUser(1,'SELECT request_event_cancellation($1,$2)',[eventId,'Duplicate']),/duplicate key/);
    const req=(await db.query('SELECT id FROM event_cancellation_requests')).rows[0].id;
    await assert.rejects(asUser(1,'SELECT review_event_cancellation($1,true,NULL)',[req]),/Active supervisor/);
    await asUser(3,'SELECT review_event_cancellation($1,true,NULL)',[req]);
    assert.equal((await db.query('SELECT event_status FROM calendar_events WHERE id=$1',[eventId])).rows[0].event_status,'scheduled');
    await asUser(3,'SELECT cancel_supervisor_event($1,$2)',[eventId,'Venue unavailable']);
    assert.equal((await db.query('SELECT status FROM event_cancellation_requests WHERE id=$1',[req])).rows[0].status,'completed');
    assert.equal((await asUser(2,'SELECT id FROM calendar_events')).rows.length,0);
    const recipients=(await db.query("SELECT recipient_id FROM event_notifications WHERE notification_type='event_cancelled' ORDER BY recipient_id")).rows.map((r)=>r.recipient_id);
    assert.deepEqual(recipients,[id(1),id(2)]);
    assert.equal((await db.query("SELECT count(*)::INTEGER AS total FROM event_notifications WHERE notification_type IN ('one_day_reminder','one_hour_reminder')")).rows[0].total,0);
    assert.equal((await db.query('SELECT count(*)::INTEGER AS total FROM event_attendance')).rows[0].total,2);
  });
  await t.test('expired notices are excluded immediately and stopped by the sweep',async () => {
    await db.exec(`ALTER TABLE system_notices DISABLE TRIGGER stop_expired_notice_on_write;
      INSERT INTO system_notices(title,starts_at,ends_at,is_active) VALUES('Expired',now()-INTERVAL '2 days',now()-INTERVAL '1 day',true),('Current',now()-INTERVAL '1 day',now()+INTERVAL '1 day',true);
      ALTER TABLE system_notices ENABLE TRIGGER stop_expired_notice_on_write;`);
    const stats=(await asUser(4,'SELECT get_admin_analytics(90) AS stats')).rows[0].stats;
    assert.equal(stats.active_notices,1);
    await assert.rejects(asUser(2,'SELECT expire_system_notices()'),/Active admin/);
    await asUser(4,'SELECT expire_system_notices()');
    assert.equal((await db.query("SELECT is_active FROM system_notices WHERE title='Expired'")).rows[0].is_active,false);
    await db.exec("UPDATE system_notices SET is_active=true WHERE title='Expired'");
    assert.equal((await db.query("SELECT is_active FROM system_notices WHERE title='Expired'")).rows[0].is_active,false);
  });
  await t.test('every analytics detail/report cohort matches its highlighted total',async () => {
    await db.query('INSERT INTO mentor_assignments(student_id,mentor_id,assigned_at) VALUES($1,$2,now())',[id(2),id(1)]);
    const stats=(await asUser(4,'SELECT get_admin_analytics(90) AS stats')).rows[0].stats;
    for(const [metric,key] of Object.entries({students:'active_students',mentors:'active_mentors',events:'events_in_period',upcoming:'upcoming_events',assignments:'active_assignments',disabled:'disabled_profiles',notices:'active_notices'})) {
      const details=(await asUser(4,'SELECT get_admin_analytics_details($1,90) AS details',[metric])).rows[0].details;
      assert.equal(details.length,stats[key],metric);
    }
  });
  await t.test('the expiry scheduler registers the expiry sweep once a minute',async () => {
    // Verify the schedule contract without pretending pg_cron runs in PGlite.
    await db.exec(`CREATE SCHEMA cron;CREATE TABLE cron.jobs(name TEXT,expression TEXT,command TEXT);
      CREATE FUNCTION cron.schedule(job TEXT,schedule TEXT,command TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO cron.jobs VALUES(job,schedule,command);RETURN 1;END;$$;`);
    // PGlite does not ship pg_cron; its installation is a Supabase prerequisite.
    const scheduler=fs.readFileSync(path.join(__dirname,'..','database','20261011000000_notice_expiry_schedule.sql'),'utf8');
    await db.exec(scheduler.replace('CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;',''));
    const job=(await db.query('SELECT * FROM cron.jobs')).rows[0];
    assert.equal(job.expression,'* * * * *');assert.equal(job.command,'SELECT public.expire_system_notices();');
  });
  await t.test('the new migration can be reapplied without losing attendance history',async () => {
    await db.exec(migration);
    assert.equal((await db.query('SELECT count(*)::INTEGER AS total FROM event_attendance')).rows[0].total,2);
  });
});
