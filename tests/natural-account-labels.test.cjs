'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('natural account migration preserves protected ownership, legacy resume and service-only grants', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(read('tests/fixtures/deployed-contract.sql'));
  for (const name of ['20261019000000_academic_lifecycle.sql', '20261019010000_demo_cohort_and_seeding.sql',
    '20261019020000_academic_clients_and_analytics.sql']) await db.exec(read('database/' + name));
  await db.exec(`CREATE SCHEMA cron;
    CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;`);
  for (const name of ['20261019040000_demo_workflows_and_schedule.sql', '20261019050000_dashboard_read_performance.sql',
    '20261020000000_update_titles.sql', '20261020010000_natural_account_labels.sql']) await db.exec(read('database/' + name));
  await db.exec(`INSERT INTO faculties(id,name) OVERRIDING SYSTEM VALUE VALUES(1,'Science');
    INSERT INTO programmes(id,faculty_id,name,qualification_level,max_study_year)
    OVERRIDING SYSTEM VALUE VALUES(1,1,'BSc','undergraduate',3);`);
  const batch = 'labels-test';
  const year = (await db.query('SELECT extract(year FROM fye_today())::integer AS year')).rows[0].year;
  const prefix = String(year % 100).padStart(2, '0');
  await db.query('SELECT demo_start_batch($1,$2)', [batch, 'offline-reviewed-plan']);
  async function account(role, index, overrides = {}, metadata) {
    const isStudent = ['student', 'mentor'].includes(role);
    const number = `${prefix}${String(index).padStart(7, '0')}`;
    const details = { role, email: isStudent ? `${number}@ump.ac.za` : `${role}.mokoena@ump.ac.za`,
      first_name: 'Lerato', last_name: 'Mokoena', full_name: 'Lerato Mokoena',
      student_number: isStudent ? number : null, faculty_id: isStudent ? '1' : null, programme_id: isStudent ? '1' : null,
      qualification_level: isStudent ? 'undergraduate' : null, study_year: isStudent ? 1 : null,
      first_entry_year: isStudent ? year : null, entry_status: isStudent ? 'first_time' : null,
      language_preference: 'Sesotho', ...overrides };
    const key = isStudent ? `${batch}/programme/1/${role}/${index}` : `${batch}/staff/${role}`;
    const id = crypto.randomUUID();
    await db.query('INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data) VALUES($1,$2,now(),$3,$4)',
      [id, details.email, { ...details, role: 'student' }, metadata || { fye_demo_batch: batch, fye_seed_key: key }]);
    return { id, key, details };
  }
  async function seed(a, details = a.details, key = a.key) {
    await db.exec('SET ROLE service_role');
    try { return (await db.query('SELECT demo_seed_profile($1,$2,$3,$4) AS profile', [batch, key, a.id, details])).rows[0].profile; }
    finally { await db.exec('RESET ROLE'); }
  }
  const student = await account('student', 1);
  const profile = await seed(student);
  assert.equal(profile.email, `${profile.student_number}@ump.ac.za`);
  assert.equal(profile.school, 'Science'); assert.equal(profile.demo_batch, batch);
  assert.equal((await db.query("SELECT seed_key FROM fye_demo_records WHERE table_name='profiles' AND record_id=$1", [student.id])).rows[0].seed_key, student.key);
  const mentor = await account('mentor', 51); await seed(mentor);
  const supervisor = await account('supervisor', 1); assert.equal((await seed(supervisor)).school, 'Student Affairs');
  const admin = await account('admin', 1); assert.equal((await seed(admin)).role, 'admin');

  const legacy = await account('student', 3, { email: `demo.${batch}.p001.s003@example.test` });
  await seed(legacy);
  await db.query("UPDATE profiles SET full_name='Lerato Ndlovu' WHERE id=$1", [legacy.id]);
  assert.equal((await seed(legacy)).full_name, 'Lerato Ndlovu', 'Resume preserves manual edits to frozen v1 accounts.');

  const mismatched = await account('student', 4, { email: 'another.student@ump.ac.za' });
  await assert.rejects(seed(mismatched), /not owned/);
  const unmarked = await account('student', 5, {}, {});
  await assert.rejects(seed(unmarked), /not owned/);
  const wrongKey = await account('student', 6, {}, { fye_demo_batch: batch, fye_seed_key: `${batch}/programme/1/student/999` });
  await assert.rejects(seed(wrongKey), /not owned/);
  await assert.rejects(seed(student, { ...student.details, student_number: `${prefix}9999999` }), /not owned/);
  await assert.rejects(seed(student, student.details, `${batch}/staff/admin`), /protected key/);
  const collision = await account('student', 7, { email: `demo.${batch}.p001.s007@example.test` });
  await assert.rejects(seed(collision, { ...collision.details, student_number: student.details.student_number }), /Student number collision/);
  const otherBatch = await account('student', 8, { email: 'demo.other-batch.p001.s008@example.test' });
  await assert.rejects(seed(otherBatch), /not owned/);

  const grants = (await db.query(`SELECT
    has_function_privilege('service_role','demo_seed_profile(text,text,uuid,jsonb)','EXECUTE') AS service,
    has_function_privilege('authenticated','demo_seed_profile(text,text,uuid,jsonb)','EXECUTE') AS signed_in,
    has_function_privilege('anon','demo_seed_profile(text,text,uuid,jsonb)','EXECUTE') AS anonymous`)).rows[0];
  assert.deepEqual(grants, { service: true, signed_in: false, anonymous: false });
  const eventId = (await db.query('SELECT demo_historical_event($1,$2,$3,$4,$5) AS id',
    [batch, 'historical/event', mentor.id, supervisor.id, [student.id]])).rows[0].id;
  const event = (await db.query('SELECT title,description,location,demo_batch FROM calendar_events WHERE id=$1', [eventId])).rows[0];
  assert.equal(event.demo_batch, batch); assert.equal(event.title, 'Faculty study workshop');
  assert.doesNotMatch([event.title, event.description, event.location].join(' '), /demo|prototype|fictional/i);
  assert.equal((await db.query('SELECT correction_reason FROM event_attendance WHERE calendar_event_id=$1', [eventId])).rows[0].correction_reason,
    'Attendance verified by the faculty supervisor.');
  await db.exec(read('database/20261020010000_natural_account_labels.sql'));
  assert.equal((await seed(legacy)).full_name, 'Lerato Ndlovu');
  assert.equal((await db.query('SELECT schema_hash=fye_contract_hash() AS intact FROM fye_contract_baseline')).rows[0].intact, true);
});
