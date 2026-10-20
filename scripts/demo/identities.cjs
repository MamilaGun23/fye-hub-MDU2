'use strict';
const crypto = require('node:crypto');
const { LEVELS, academicDate, eligibleMentee } = require('./policy.cjs');
const { catalogueFingerprint, schemaFingerprint, validateAudit } = require('./audit.cjs');
const { digest } = require('./files.cjs');

// Curated fictional combinations. Language preference is assigned independently
// of the name pool; names never establish ethnicity, language or disability.
const NAME_POOLS = [
  ['isiZulu', ['Thandeka','Sipho','Nokuthula','Sibusiso'], ['Dlamini','Khumalo','Mthembu','Ngcobo']],
  ['isiXhosa', ['Lulama','Akhona','Siyabonga','Noluthando'], ['Mbeki','Gqoboka','Maqoma','Ngqula']],
  ['isiNdebele', ['Mthokozisi','Nobuhle','Bongani','Zanele'], ['Mahlangu','Masango','Mabena','Sibanyoni']],
  ['siSwati', ['Lungile','Sifiso','Nomcebo','Sibusisiwe'], ['Simelane','Maseko','Shongwe','Hlophe']],
  ['Sepedi', ['Mpho','Lerato','Kgaogelo','Mahlatse'], ['Mokgopa','Mphahlele','Mashilo','Molepo']],
  ['Sesotho', ['Palesa','Teboho','Nthabiseng','Kabelo'], ['Mokoena','Mofokeng','Molefe','Radebe']],
  ['Setswana', ['Boitumelo','Kagiso','Refilwe','Tshepo'], ['Molema','Mogapi','Modise','Moroka']],
  ['Tshivenda', ['Rendani','Fhatuwani','Mulalo','Vhulenda'], ['Ramabulana','Netshitenzhe','Mulaudzi','Tshikovhi']],
  ['Xitsonga', ['Nhlamulo','Rirhandzu','Tsakani','Hlayisani'], ['Baloyi','Chauke','Mabunda','Maluleke']],
  ['Afrikaans', ['Anri','Marlé','Johan','Ruan'], ['Botha','Jacobs','Van Wyk','Pieterse']],
  ['English', ['Naledi','Jamie','Keagan','Aaliyah'], ['Daniels','Petersen','Adams','Williams']]
];
const PREFERENCES = Object.freeze(['isiZulu','isiXhosa','isiNdebele','siSwati','Sepedi','Sesotho','Setswana','Tshivenda','Xitsonga','Afrikaans','English','SASL']);
const STAFF_IDENTITIES = Object.freeze({
  admin: { first_name: 'Rendani', last_name: 'Mulaudzi', email: 'rendani.mulaudzi@ump.ac.za', language_preference: 'Tshivenda' },
  supervisor: { first_name: 'Palesa', last_name: 'Mokoena', email: 'palesa.mokoena@ump.ac.za', language_preference: 'Sesotho' }
});
function integer(seed, maximum) {
  return crypto.createHash('sha256').update(seed).digest().readUInt32BE(0) % maximum;
}
function batchName(batch) {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(batch || '')) throw new Error('Batch name: 3–40 lowercase letters, digits or hyphens.');
  return batch;
}
function validateMapping(audit, mapping) {
  if (!mapping?.reviewed || mapping.reviewed !== true || mapping.catalogue_hash !== catalogueFingerprint(audit)) {
    throw new Error('Review qualification-review.json against this audit and set reviewed=true.');
  }
  if (!Array.isArray(mapping.programmes) || mapping.programmes.length !== audit.programmes.length) throw new Error('Programme mapping is incomplete.');
  const mapped = new Map();
  for (const p of mapping.programmes) {
    const source = audit.programmes.find(s => String(s.id) === String(p.id));
    if (!source || mapped.has(String(p.id)) || source.name !== p.name || String(source.faculty_id) !== String(p.faculty_id)
      || !LEVELS.includes(p.qualification_level) || !Number.isInteger(p.max_study_year) || p.max_study_year < 1 || p.max_study_year > 20) {
      throw new Error(`Invalid qualification mapping: ${p.id}.`);
    }
    mapped.set(String(p.id), p);
  }
  return mapped;
}
function generate(audit, mapping, batch, asOf = audit.academic_date + 'T12:00:00+02:00') {
  validateAudit(audit); batchName(batch);
  const mapped = validateMapping(audit, mapping);
  const { year } = academicDate(asOf);
  const usedNumbers = new Set(audit.existing_student_numbers.map(String));
  const usedEmails = new Set(audit.existing_demo_emails.map(e => e.toLowerCase()));
  const faculties = new Map(audit.faculties.map(f => [String(f.id), f.name]));
  const accounts = [];
  // Source IDs, not display order, determine identity. Lexical ordering is stable.
  for (const programme of [...mapped.values()].sort((a,b) => String(a.id).localeCompare(String(b.id), 'en'))) {
    const ug = programme.qualification_level === 'undergraduate';
    // Two extra approved mentors per UG programme. PG mentor scenarios will use
    // separately tracked extras after explicit supervisor programme mappings.
    const count = ug ? 52 : 50;
    for (let index = 0; index < count; index++) {
      const role = index >= 50 ? 'mentor' : 'student';
      const key = `${batch}/programme/${programme.id}/${role}/${index + 1}`;
      const firstTime = ug && programme.first_time_entry !== false && index < 30;
      const studyYear = firstTime ? 1 : ug
        ? (programme.max_study_year === 1 ? 1 : 2 + integer(key + '/year', programme.max_study_year - 1))
        : 1 + integer(key + '/year', programme.max_study_year);
      // Keep approved mentors consistent with their valid current study year.
      const firstEntryYear = firstTime ? year : year - (ug ? Math.max(1, studyYear - 1) : studyYear + 3) - integer(key + '/entry', 3);
      const prefix = String(firstEntryYear % 100).padStart(2, '0');
      let suffix = integer(key + '/number', 10000000);
      let number, attempts = 0;
      do {
        number = prefix + String(suffix).padStart(7, '0'); suffix = (suffix + 1) % 10000000;
        if (++attempts > 10000000) throw new Error('Student number namespace exhausted.');
      } while (usedNumbers.has(number));
      usedNumbers.add(number);
      const email = `${number}@ump.ac.za`;
      if (usedEmails.has(email)) throw new Error('Email already exists. Resume its original batch rather than generating another preview.');
      usedEmails.add(email);
      const pool = NAME_POOLS[(index + integer(batch + '/' + programme.id, NAME_POOLS.length)) % NAME_POOLS.length];
      const firstName = pool[1][integer(key + '/first', pool[1].length)];
      const surname = pool[2][integer(key + '/last', pool[2].length)];
      accounts.push({ seed_key: key, email, first_name: firstName, last_name: surname,
        full_name: `${firstName} ${surname}`, student_number: number,
        faculty_id: String(programme.faculty_id), faculty: faculties.get(String(programme.faculty_id)),
        programme_id: String(programme.id), programme: programme.name,
        qualification_level: programme.qualification_level, study_year: studyYear,
        first_entry_year: firstEntryYear, entry_status: firstTime ? 'first_time' : 'returning',
        role, is_active: true, academic_verified: true,
        language_preference: PREFERENCES[index % PREFERENCES.length],
        presentation_login: index === 0 || index === 30 || index === 50,
        approval_scenario: role === 'mentor' ? 'historical_returning_appointment' : null });
    }
  }
  for (const [role, identity] of Object.entries(STAFF_IDENTITIES)) {
    if (usedEmails.has(identity.email)) throw new Error('Email already exists. Resume its original batch rather than generating another preview.');
    usedEmails.add(identity.email);
    accounts.push({seed_key:`${batch}/staff/${role}`, ...identity,
      full_name:`${identity.first_name} ${identity.last_name}`,
      student_number:null,faculty_id:null,faculty:'Student Affairs',programme_id:null,programme:'First-Year Experience',qualification_level:null,study_year:null,first_entry_year:null,
      entry_status:null,role,is_active:true,academic_verified:false,presentation_login:true,approval_scenario:null});
  }
  const plan = { version: 2, batch, as_of: new Date(asOf).toISOString(), schema_hash: schemaFingerprint(audit),
    catalogue_hash: catalogueFingerprint(audit), mapping_hash: digest(mapping), accounts };
  plan.plan_hash = digest(plan);
  validatePlan(plan, audit, mapping);
  return plan;
}
function validatePlan(plan, audit, mapping) {
  const mapped = validateMapping(audit, mapping);
  const { plan_hash, ...body } = plan;
  if (![1, 2].includes(plan.version) || digest(body) !== plan_hash || schemaFingerprint(audit) !== plan.schema_hash
      || catalogueFingerprint(audit) !== plan.catalogue_hash || digest(mapping) !== plan.mapping_hash) {
    throw new Error('Preview integrity check failed. Regenerate the preview from the audited inputs.');
  }
  batchName(plan.batch);
  const keys = new Set(), emails = new Set(audit.existing_demo_emails.map(e => e.toLowerCase())), numbers = new Set(audit.existing_student_numbers.map(String));
  for (const account of plan.accounts) {
    if(['admin','supervisor'].includes(account.role)){
      // Existing frozen v1 plans keep their original addresses so resume and
      // cleanup retain the exact identities recorded in their manifests.
      const expectedEmail = plan.version === 1 ? `demo.${plan.batch}.${account.role}@example.test` : STAFF_IDENTITIES[account.role].email;
      if(account.seed_key!==`${plan.batch}/staff/${account.role}`||account.email!==expectedEmail||account.programme_id!==null||account.faculty_id!==null||account.academic_verified!==false||keys.has(account.seed_key)||emails.has(account.email))throw new Error('Invalid demo staff account.');
      keys.add(account.seed_key);emails.add(account.email);continue;
    }
    const programme = mapped.get(account.programme_id);
    const date = academicDate(plan.as_of);
    if (!programme || account.faculty_id !== String(programme.faculty_id)
        || account.qualification_level !== programme.qualification_level
        || !Number.isInteger(account.study_year) || account.study_year < 1 || account.study_year > programme.max_study_year
        || !/^\d{9}$/.test(account.student_number)
        || account.student_number.slice(0,2) !== String(account.first_entry_year % 100).padStart(2,'0')
        || !Number.isInteger(account.first_entry_year) || account.first_entry_year < 1900
        || account.first_entry_year > date.year || !PREFERENCES.includes(account.language_preference)
        || !account.seed_key.startsWith(plan.batch + '/programme/' + account.programme_id + '/')
        || (plan.version === 1
          ? !(account.email.startsWith('demo.' + plan.batch + '.') && account.email.endsWith('@example.test'))
          : account.email !== `${account.student_number}@ump.ac.za`)
        || account.is_active !== true || account.academic_verified !== true
        || !['first_time','returning'].includes(account.entry_status)
        || !['student','mentor'].includes(account.role)
        || (account.entry_status === 'first_time' && !eligibleMentee(account, plan.as_of))
        || keys.has(account.seed_key) || emails.has(account.email) || numbers.has(account.student_number)) {
      throw new Error(`Invalid or duplicate demo identity: ${account.seed_key}.`);
    }
    keys.add(account.seed_key); emails.add(account.email); numbers.add(account.student_number);
  }
  if(plan.accounts.filter(a=>a.role==='admin').length!==1||plan.accounts.filter(a=>a.role==='supervisor').length!==1)throw new Error('Demo staff population is invalid.');
  for (const p of mapped.values()) {
    const students = plan.accounts.filter(a => a.programme_id === String(p.id) && a.role === 'student');
    const mentors = plan.accounts.filter(a => a.programme_id === String(p.id) && a.role === 'mentor');
    if (students.length !== 50 || new Set(students.map(a => a.language_preference)).size !== 12) throw new Error(`Population/language target failed: ${p.name}.`);
    if (p.qualification_level === 'undergraduate') {
      if (students.filter(a => eligibleMentee(a,plan.as_of)).length !== (p.first_time_entry === false ? 0 : 30) || mentors.length !== 2) throw new Error(`Undergraduate mix failed: ${p.name}.`);
    } else if (students.some(a => eligibleMentee(a,plan.as_of))) throw new Error(`Postgraduate mentee found: ${p.name}.`);
  }
  return true;
}
function summary(plan) {
  function grouped(fields) {
    const groups = new Map();
    for (const a of plan.accounts) {
      const key = JSON.stringify(fields.map(f => a[f]));
      if (!groups.has(key)) groups.set(key, { ...Object.fromEntries(fields.map(f => [f,a[f]])), count: 0 });
      groups.get(key).count++;
    }
    return [...groups.values()];
  }
  return { batch: plan.batch, plan_hash: plan.plan_hash, total: plan.accounts.length,
    students: plan.accounts.filter(a => a.role === 'student').length,
    mentors: plan.accounts.filter(a => a.role === 'mentor').length,
    staff: plan.accounts.filter(a=>['admin','supervisor'].includes(a.role)).length,
    eligible_mentees: plan.accounts.filter(a => eligibleMentee(a,plan.as_of)).length,
    by_programme: grouped(['faculty','programme','qualification_level','role','entry_status']),
    by_language: grouped(['faculty','programme','language_preference']),
    by_study_year: grouped(['qualification_level','study_year','entry_status']) };
}
module.exports = { PREFERENCES, NAME_POOLS, batchName, validateMapping, generate, validatePlan, summary };
