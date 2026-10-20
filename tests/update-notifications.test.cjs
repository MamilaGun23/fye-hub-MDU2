const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const id = n => `30000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('selected update titles reach all recipients without changing permissions or notification history', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(read('tests/fixtures/deployed-contract.sql'));
  for (const n of [1, 2, 3, 4]) {
    await db.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES($1, $2, now())', [id(n), `update-${n}@example.test`]);
  }
  await db.query("UPDATE profiles SET role = 'admin' WHERE id = $1", [id(1)]);
  await db.query("UPDATE profiles SET role = 'supervisor' WHERE id = $1", [id(2)]);
  await db.query("UPDATE profiles SET role = 'mentor' WHERE id = $1", [id(4)]);
  // The schema export models SELECT grants; add the existing admin form's DML
  // grants so these checks exercise its RLS policy under the authenticated role.
  await db.exec('GRANT INSERT, UPDATE ON system_notices TO authenticated; GRANT USAGE, SELECT ON SEQUENCE system_notices_id_seq TO authenticated;');

  async function asUser(n, sql, values = []) {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id(n)]);
    await db.exec('SET ROLE authenticated');
    try { return await db.query(sql, values); }
    finally {
      await db.exec('RESET ROLE');
      await db.exec("SELECT set_config('request.jwt.claim.sub', '', false)");
    }
  }
  const publish = title => asUser(1, `INSERT INTO system_notices(title, message, starts_at, ends_at, created_by)
    VALUES($1, 'Update details', now() - interval '1 minute', now() + interval '1 day', $2) RETURNING id`, [title, id(1)]);

  const historicId = (await publish('Historic campus bulletin')).rows[0].id;
  await db.query("UPDATE supervisor_notifications SET read_at = '2026-10-01T08:00:00Z' WHERE subject_id = $1", [String(historicId)]);
  const history = (await db.query('SELECT id, message, created_at, read_at FROM supervisor_notifications WHERE subject_id = $1', [String(historicId)])).rows;
  const migration = read('database/20261020000000_update_titles.sql');
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual((await db.query('SELECT id, message, created_at, read_at FROM supervisor_notifications WHERE subject_id = $1', [String(historicId)])).rows, history);
  assert.equal((await db.query('SELECT title FROM supervisor_notifications WHERE subject_id = $1', [String(historicId)])).rows[0].title, 'Historic campus bulletin');
  assert.equal((await db.query('SELECT title FROM system_notices WHERE id = $1', [historicId])).rows[0].title, 'Historic campus bulletin');

  for (const title of ['University update', 'Application updates']) {
    const noticeId = (await publish(title)).rows[0].id;
    const supervisors = (await asUser(2, 'SELECT title, message FROM supervisor_notifications WHERE subject_id = $1', [String(noticeId)])).rows;
    assert.deepEqual(supervisors, [{ title, message: 'Update details' }]);
    for (const n of [3, 4]) {
      const inbox = (await asUser(n, 'SELECT recipient_id, title, message FROM system_notice_notifications WHERE system_notice_id = $1', [noticeId])).rows;
      assert.deepEqual(inbox, [{ recipient_id: id(n), title, message: 'Update details' }]);
    }
    await asUser(1, 'UPDATE system_notices SET is_active = false WHERE id = $1', [noticeId]);
    await asUser(1, 'UPDATE system_notices SET is_active = true WHERE id = $1', [noticeId]);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM supervisor_notifications WHERE subject_id = $1', [String(noticeId)])).rows[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM system_notice_notifications WHERE system_notice_id = $1', [noticeId])).rows[0].n, 2);
  }
  assert.equal((await asUser(3, 'SELECT id FROM supervisor_notifications')).rows.length, 0);
  await assert.rejects(asUser(3, `INSERT INTO system_notices(title, message, starts_at, created_by)
    VALUES('Application updates', 'Unauthorised update', now(), $1)`, [id(3)]), /row-level security/);
  assert.equal((await db.query("SELECT has_function_privilege('authenticated', 'public.notify_supervisors_of_admin_notice()', 'EXECUTE') AS allowed")).rows[0].allowed, false);
  const bundled = read('database/DEMO_INSTALL.sql');
  const body = migration.replace(/^BEGIN;\r?$/gm, '').replace(/^COMMIT;\r?$/gm, '').replace(/^NOTIFY pgrst.*$/gm, '');
  assert(bundled.includes(body), 'The demo installer must include the same update migration.');
});
