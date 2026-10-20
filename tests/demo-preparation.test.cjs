const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PGlite } = require('@electric-sql/pglite');
const { validateAudit, findings, reviewTemplate } = require('../scripts/demo/audit.cjs');
const { digest, csv, importAudit, parseCSV, privatePath } = require('../scripts/demo/files.cjs');
const { generate, validatePlan, summary, PREFERENCES } = require('../scripts/demo/identities.cjs');
const { academicDate, cycleAt, applicationEligibility, eligibleMentee, assignmentActive } = require('../scripts/demo/policy.cjs');

const fixture = `
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TABLE auth.users(id UUID PRIMARY KEY,email TEXT);
CREATE TABLE public.faculties(id BIGINT PRIMARY KEY,name TEXT);
CREATE TABLE public.programmes(id BIGINT PRIMARY KEY,name TEXT,faculty_id BIGINT REFERENCES faculties);
CREATE TABLE public.profiles(id UUID PRIMARY KEY REFERENCES auth.users,student_number TEXT,
  faculty_id BIGINT REFERENCES faculties,programme_id BIGINT REFERENCES programmes,role TEXT,is_active BOOLEAN);
CREATE TABLE mentor_applications(id UUID PRIMARY KEY,applicant_id UUID UNIQUE,study_year SMALLINT CHECK(study_year>=2));
CREATE TABLE mentor_assignments(id UUID PRIMARY KEY);
CREATE TABLE calendar_events(id BIGINT PRIMARY KEY);
CREATE TABLE event_requests(id UUID PRIMARY KEY);
CREATE TABLE event_notifications(id UUID PRIMARY KEY);
CREATE TABLE supervisor_notifications(id UUID PRIMARY KEY);
CREATE TABLE system_notices(id BIGINT PRIMARY KEY);
CREATE TABLE event_attendance(id UUID PRIMARY KEY);
CREATE TABLE storage.buckets(id TEXT,public BOOLEAN,file_size_limit BIGINT,allowed_mime_types TEXT[]);
CREATE FUNCTION public.handle_signup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO public.profiles(id,role,is_active) VALUES(NEW.id,'student',true); RETURN NEW; END $$;
CREATE TRIGGER handle_signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_signup();
INSERT INTO faculties VALUES(1,'Science'),(2,'Education'),(3,'Empty faculty');
INSERT INTO programmes VALUES(1,'BSc',1),(2,'BEd',2),(3,'Honours',1),(4,'Masters',1),(5,'Doctorate',1),(6,'PGDip',2);
INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000001','existing@example.test');
INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000002','private.person@university.ac.za');
UPDATE profiles SET student_number='260000001',faculty_id=1,programme_id=1
WHERE id='00000000-0000-0000-0000-000000000001';
`;

let audited;
test('read-only SQL audit executes against PostgreSQL and detects deployed constraints', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(fixture);
  const sql = fs.readFileSync(path.join(__dirname,'../database/DEMO_READ_ONLY_AUDIT.sql'),'utf8');
  const before = (await db.query('SELECT count(*)::integer AS total FROM profiles')).rows[0].total;
  await db.exec('BEGIN READ ONLY');
  try {
    audited = (await db.query(sql)).rows[0].audit;
    // Fixed clock for deterministic offline fixtures, never changes the live clock.
    audited.academic_date = '2026-10-19';
  } finally { await db.exec('ROLLBACK'); }
  assert.equal(validateAudit(audited),audited);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM profiles')).rows[0].total,before);
  assert.equal(audited.programmes[0].id,'1');
  assert.equal(audited.programmes[0].faculty_id,'1');
  assert.deepEqual(audited.existing_student_numbers,['260000001']);
  const report = findings(audited);
  assert.equal(report.legacy_single_application_constraint,true);
  assert.equal(report.legacy_year_two_restriction,true);
  assert.deepEqual(report.faculties_without_programmes,['Empty faculty']);
  assert.equal(report.auth_profile_triggers[0].name,'handle_signup');
  assert.equal(report.auth_profile_summary.auth_without_profile,0);
  assert.equal(report.writes_enabled,false);
  assert(JSON.stringify(audited).includes('existing@example.test'));
  assert(!JSON.stringify(audited).includes('private.person@university.ac.za'));
  assert.equal(audited.auth_profile_summary.auth_accounts,2);
});

function reviewed() {
  const mapping = reviewTemplate(audited);
  const levels = ['undergraduate','undergraduate','honours','masters','doctorate','postgraduate_diploma'];
  mapping.programmes.forEach((p,i) => { p.qualification_level = levels[i]; p.max_study_year = i < 2 ? 4 : 2; });
  mapping.reviewed = true;
  return mapping;
}

test('SQL export importer handles Supabase JSON and CSV without exposing output', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'fye-demo-audit-'));
  try {
    const variants = [audited,[{audit:audited}],[{audit:JSON.stringify(audited)}]];
    for (const [i,variant] of variants.entries()) {
      const name = path.join(temp,`${i}.json`); fs.writeFileSync(name,JSON.stringify(variant));
      assert.deepEqual(importAudit(name),audited);
    }
    const name = path.join(temp,'audit.csv');
    fs.writeFileSync(name,csv([{ audit: JSON.stringify(audited) }]));
    assert.deepEqual(importAudit(name),audited);
    fs.writeFileSync(name,'audit\n"unclosed');
    assert.throws(() => importAudit(name),/Unclosed/);
  } finally {
    assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'fye-demo-audit-'));
    fs.rmSync(temp,{recursive:true,force:true});
  }
});

test('unreviewed, missing and mismatched programmes block preview', () => {
  assert.throws(() => generate(audited,reviewTemplate(audited),'test-demo'),/Review/);
  let mapping = reviewed(); mapping.programmes.pop();
  assert.throws(() => generate(audited,mapping,'test-demo'),/incomplete/);
  mapping = reviewed(); mapping.programmes[0].qualification_level = 'made-up';
  assert.throws(() => generate(audited,mapping,'test-demo'),/Invalid qualification/);
  mapping = reviewed(); mapping.programmes[0].faculty_id='2';
  assert.throws(() => generate(audited,mapping,'test-demo'),/Invalid qualification/);
});

test('every programme receives exactly 50 new students with correct cohort and language mix', () => {
  const mapping = reviewed(); const plan = generate(audited,mapping,'test-demo');
  assert.equal(validatePlan(plan,audited,mapping),true);
  const counts = summary(plan);
  assert.equal(counts.total,306); assert.equal(counts.students,300);assert.equal(counts.staff,2);
  assert.equal(counts.mentors,4); assert.equal(counts.eligible_mentees,60);
  for (const programme of mapping.programmes) {
    const students = plan.accounts.filter(a => a.programme_id === programme.id && a.role === 'student');
    assert.equal(students.length,50);
    assert.deepEqual(new Set(students.map(s => s.language_preference)),new Set(PREFERENCES));
    assert(students.every(s => s.study_year >= 1 && s.study_year <= programme.max_study_year));
    if (programme.qualification_level !== 'undergraduate') assert(students.every(s => s.entry_status==='returning'));
  }
  assert.equal(new Set(plan.accounts.filter(a=>a.student_number).map(a => a.student_number)).size,304);
  assert.equal(plan.version, 2);
  assert(plan.accounts.every(a => a.email.endsWith('@ump.ac.za')));
  assert(plan.accounts.filter(a => ['student', 'mentor'].includes(a.role)).every(a => a.email === `${a.student_number}@ump.ac.za`));
  assert.deepEqual(plan.accounts.filter(a => ['admin', 'supervisor'].includes(a.role)).map(a => a.email),
    ['rendani.mulaudzi@ump.ac.za', 'palesa.mokoena@ump.ac.za']);
  assert(plan.accounts.every(a => !/demo|prototype/i.test([a.full_name,a.email,a.faculty,a.programme].join(' '))));
  assert.equal(PREFERENCES[8],'Xitsonga');
});

test('identities stay deterministic and avoid audited student-number collisions', () => {
  const mapping = reviewed();
  const first = generate(audited,mapping,'test-demo');
  assert.deepEqual(generate(audited,mapping,'test-demo'),first);
  const changedAudit = structuredClone(audited);
  changedAudit.existing_student_numbers.push(first.accounts[0].student_number);
  const changed = generate(changedAudit,mapping,'test-demo');
  assert.notEqual(changed.accounts[0].student_number,first.accounts[0].student_number);
  assert.notEqual(changed.accounts[0].email,first.accounts[0].email);
  assert.equal(changed.accounts[0].email,`${changed.accounts[0].student_number}@ump.ac.za`);
  const existing = structuredClone(audited); existing.existing_demo_emails.push(first.accounts[0].email);
  assert.throws(() => generate(existing,mapping,'test-demo'),/Resume/);
  const staffCollision = structuredClone(audited); staffCollision.existing_demo_emails.push('rendani.mulaudzi@ump.ac.za');
  assert.throws(() => generate(staffCollision,mapping,'test-demo'),/Resume/);
});

test('v2 plans enforce student-number addresses and v1 frozen plans still validate', () => {
  const mapping = reviewed(); const plan = generate(audited,mapping,'test-demo');
  const invalid = structuredClone(plan);
  invalid.accounts[0].email = 'another.student@ump.ac.za';
  const { plan_hash: invalidHash, ...invalidBody } = invalid;
  invalid.plan_hash = digest(invalidBody);
  assert.throws(() => validatePlan(invalid,audited,mapping),/Invalid or duplicate/);

  const legacy = structuredClone(plan); legacy.version = 1;
  for (const account of legacy.accounts) {
    if (['admin', 'supervisor'].includes(account.role)) {
      account.email = `demo.${legacy.batch}.${account.role}@example.test`;
      account.faculty = 'Demo staff'; account.programme = 'Demo staff';
    } else {
      const index = account.seed_key.split('/').at(-1);
      const programmeToken = digest(String(account.programme_id)).slice(0,16);
      account.email = `demo.${legacy.batch}.p${programmeToken}.${account.role[0]}${index.padStart(3,'0')}@example.test`;
    }
  }
  const { plan_hash: legacyHash, ...legacyBody } = legacy;
  legacy.plan_hash = digest(legacyBody);
  assert.equal(validatePlan(legacy,audited,mapping),true);
});

test('plan tampering, duplicate identities, changed schema and invalid batch paths stop validation', () => {
  const mapping = reviewed(); const plan = generate(audited,mapping,'test-demo');
  plan.accounts[0].entry_status='returning';
  assert.throws(() => validatePlan(plan,audited,mapping),/integrity/);
  const {plan_hash,...body} = plan; plan.plan_hash=digest(body);
  assert.throws(() => validatePlan(plan,audited,mapping),/mix failed/);
  assert.throws(() => generate(audited,mapping,'../../other'),/Batch name/);
  assert.throws(() => privatePath('../public/credentials.json'),/must stay/);
  const changed = structuredClone(audited); changed.tables[0].rls_enabled=true;
  assert.throws(() => validatePlan(generate(audited,mapping,'test-demo'),changed,mapping),/integrity/);
});

test('CSV previews preserve Unicode and escape spreadsheet formulas', () => {
  const parsed = parseCSV(csv([{ name:'Marlé "Mpho", Adams',programme:'=HYPERLINK("bad")',note:'a\nb' }]).replace(/^\uFEFF/,''));
  assert.equal(parsed[1][0],'Marlé "Mpho", Adams');
  assert.equal(parsed[1][1],'\'=HYPERLINK("bad")');
  assert.equal(parsed[1][2],'a\nb');
});

test('Johannesburg application window and January cohorts use exact boundaries', () => {
  assert.deepEqual(academicDate('2026-09-30T22:00:00Z'),{ year:2026,month:10,day:1 });
  assert.equal(cycleAt('2026-09-30T21:59:59Z').open,false);
  assert.deepEqual(cycleAt('2027-01-31T21:59:59Z'),{year:2026,open:true});
  assert.equal(cycleAt('2027-01-31T22:00:00Z').open,false);
  const current = { qualification_level:'undergraduate',first_entry_year:2026,entry_status:'first_time',study_year:1,is_active:true };
  assert.equal(applicationEligibility(current,'2027-01-10T12:00:00Z').eligible,true);
  assert.equal(applicationEligibility({...current,first_entry_year:2027},'2027-01-10T12:00:00Z').eligible,false);
  assert.equal(applicationEligibility({...current,first_entry_year:2027},'2027-10-01T12:00:00Z').eligible,true);
});

test('mentee rules exclude returning Year 1, postgraduates and unverified/inactive accounts', () => {
  const first = {role:'student',is_active:true,qualification_level:'undergraduate',study_year:1,entry_status:'first_time',first_entry_year:2026,academic_verified:true};
  const date = '2026-10-19T12:00:00Z';
  assert.equal(eligibleMentee(first,date),true);
  for (const change of [{entry_status:'returning'},{qualification_level:'honours'},{academic_verified:false},{is_active:false},{role:'mentor'},{first_entry_year:2025}]) {
    assert.equal(eligibleMentee({...first,...change},date),false);
  }
});

test('assignments become ineffective on January 1 even before persistence sweep', () => {
  const assignment = { academic_year:2026,assigned_at:'2026-03-01T08:00:00Z',effective_end_at:'2026-12-31T22:00:00Z',ended_at:null };
  assert.equal(assignmentActive(assignment,'2026-12-31T21:59:59Z'),true);
  assert.equal(assignmentActive(assignment,'2026-12-31T22:00:00Z'),false);
  assert.equal(assignmentActive({...assignment,ended_at:'2026-12-01T00:00:00Z'},'2026-12-15T00:00:00Z'),false);
  assert.equal(assignmentActive({...assignment,effective_end_at:null},'2026-12-15T00:00:00Z'),false);
  assert.equal(assignmentActive({...assignment,academic_year:null,effective_end_at:null},'2026-12-15T00:00:00Z'),true,'Legacy matches continue until their academic year is reviewed.');
});

test('local audit → reviewed preview → check is repeatable and retains the named batch', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'fye-demo-cli-'));
  try {
    const scripts = path.join(temp,'scripts','demo');
    fs.mkdirSync(scripts,{recursive:true});
    for (const filename of fs.readdirSync(path.join(__dirname,'../scripts/demo'))) {
      if (filename.endsWith('.cjs')) fs.copyFileSync(path.join(__dirname,'../scripts/demo',filename),path.join(scripts,filename));
    }
    const exported = path.join(temp,'export.json');
    fs.writeFileSync(exported,JSON.stringify([{audit:audited}]));
    function cli(...args) {
      return spawnSync(process.execPath,[path.join(scripts,'cli.cjs'),...args],{ cwd:temp,encoding:'utf8' });
    }
    let result = cli('audit','--input',exported);
    assert.equal(result.status,0,result.stderr);
    const privateDir = path.join(temp,'.demo-seed');
    assert.equal(cli('preview','--batch','cli-test').status,1,'Unreviewed mapping must stop preview.');
    fs.writeFileSync(path.join(privateDir,'qualification-review.json'),JSON.stringify(reviewed()));
    result = cli('preview','--batch','cli-test');
    assert.equal(result.status,0,result.stderr);
    const planPath = path.join(privateDir,'cli-test','plan.json');
    const original = fs.readFileSync(planPath,'utf8');
    assert.equal(cli('check','--batch','cli-test').status,0);
    assert.equal(cli('preview','--batch','cli-test').status,0);
    assert.equal(fs.readFileSync(planPath,'utf8'),original);
    assert.equal(cli('audit','--input',exported).status,0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(privateDir,'qualification-review.json'),'utf8')).reviewed,true);
    const changed = structuredClone(audited); changed.tables[0].rls_enabled=true;
    fs.writeFileSync(exported,JSON.stringify(changed));
    assert.equal(cli('audit','--input',exported).status,0);
    result = cli('check','--batch','cli-test');
    assert.equal(result.status,1); assert.match(result.stderr,/schema\/catalogue changed/);
    assert.equal(fs.readFileSync(planPath,'utf8'),original);
    assert.equal(cli('seed','--batch','cli-test').status,1,'No unreviewed live-write command exists.');
  } finally {
    assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'fye-demo-cli-'));
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
