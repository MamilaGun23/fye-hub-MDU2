'use strict';
const { digest } = require('./files.cjs');
const REQUIRED = ['profiles','faculties','programmes','mentor_applications','mentor_assignments',
  'calendar_events','event_requests','event_notifications','supervisor_notifications',
  'system_notices','event_attendance'];
function identifier(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === ''
      || (typeof value === 'number' && !Number.isSafeInteger(value))) {
    throw new Error('Catalogue identifiers must be strings or safe integers.');
  }
  return String(value);
}
function validateAudit(audit) {
  if (audit?.audit_version !== 1 || !Number.isFinite(Date.parse(audit.captured_at))
      || !/^\d{4}-\d{2}-\d{2}$/.test(audit.academic_date || '')) {
    throw new Error('Use the report from database/DEMO_READ_ONLY_AUDIT.sql.');
  }
  for (const field of ['faculties','programmes','tables','triggers','routines','policies','grants',
    'routine_grants','profile_counts','existing_student_numbers','existing_demo_emails','storage_buckets']) {
    if (!Array.isArray(audit[field])) throw new Error(`Audit is missing ${field}.`);
  }
  if (!audit.auth_profile_summary || !audit.programmes.length) throw new Error('Audit has no programme catalogue or Auth/profile summary.');
  const ids = new Set();
  for (const faculty of audit.faculties) {
    const id = identifier(faculty.id);
    if (ids.has(id) || typeof faculty.name !== 'string' || !faculty.name.trim()) throw new Error('Invalid/duplicate faculty.');
    ids.add(id);
  }
  const programmes = new Set();
  for (const programme of audit.programmes) {
    const id = identifier(programme.id);
    if (programmes.has(id) || !ids.has(identifier(programme.faculty_id))
        || typeof programme.name !== 'string' || !programme.name.trim()) throw new Error('Invalid programme or faculty reference.');
    programmes.add(id);
  }
  for (const name of REQUIRED) {
    if (!audit.tables.some(table => table.schema_name === 'public' && table.table_name === name)) {
      throw new Error(`Required public table missing: ${name}.`);
    }
  }
  return audit;
}
function schemaFingerprint(audit) {
  return digest({ tables: audit.tables, triggers: audit.triggers, routines: audit.routines,
    policies: audit.policies, grants: audit.grants, routine_grants: audit.routine_grants,
    storage_buckets: audit.storage_buckets });
}
function catalogueFingerprint(audit) {
  return digest({ faculties: audit.faculties, programmes: audit.programmes });
}
function reviewTemplate(audit, previous) {
  const previousById = new Map((previous?.programmes || []).map(item => [String(item.id), item]));
  return {
    catalogue_hash: catalogueFingerprint(audit), reviewed: false,
    instructions: 'Set each qualification_level and valid max_study_year from the actual catalogue, then set reviewed=true. Do not invent qualifications.',
    programmes: audit.programmes.map(p => {
      const prior = previousById.get(String(p.id));
      const same = prior?.name === p.name && String(prior.faculty_id) === String(p.faculty_id);
      return { id: String(p.id), faculty_id: String(p.faculty_id), name: p.name,
        qualification_level: same ? prior.qualification_level : null,
        max_study_year: same ? prior.max_study_year : null };
    })
  };
}
function findings(audit) {
  const application = audit.tables.find(t => t.schema_name === 'public' && t.table_name === 'mentor_applications');
  const routines = audit.routines.map(r => r.definition || '').join('\n');
  const profile = audit.tables.find(t => t.schema_name === 'public' && t.table_name === 'profiles');
  const profileTriggers = audit.triggers.filter(t => t.schema_name === 'auth' && t.table_name === 'users');
  return {
    captured_at: audit.captured_at, academic_date: audit.academic_date,
    schema_hash: schemaFingerprint(audit), catalogue_hash: catalogueFingerprint(audit),
    faculty_count: audit.faculties.length, programme_count: audit.programmes.length,
    faculties_without_programmes: audit.faculties.filter(f => !audit.programmes.some(p => String(p.faculty_id) === String(f.id))).map(f => f.name),
    auth_profile_summary: audit.auth_profile_summary,
    profile_required_columns: (profile?.columns || []).filter(c => !c.nullable && !c.default && !c.identity).map(c => c.name),
    auth_profile_triggers: profileTriggers.map(t => ({ name: t.name, enabled: t.enabled, definition: t.definition })),
    legacy_single_application_constraint: (application?.constraints || []).some(c => /UNIQUE\s*\(applicant_id\)/i.test(c.definition)),
    legacy_year_two_restriction: /applicant_year\s*<\s*2|p_study_year\s*<\s*2|study_year\s*>=\s*2/i.test(routines + JSON.stringify(application?.constraints)),
    scheduled_jobs_extension: audit.scheduled_jobs_extension,
    deployment_review_required: [
      'Review Auth signup trigger body and required profile columns before Auth creation.',
      'Review programme qualification levels and valid study years.',
      'Migrate recruitment cycles, verified academic details and effective mentor appointments together with all clients.',
      'Audit all SECURITY DEFINER RPCs and RLS policies for demo audience and academic enforcement.',
      'Review legacy assignment academic-year backfill before annual expiry.',
      'Test demo notification/calendar isolation and dependency-aware cleanup before demo activity.'
    ],
    writes_enabled: false
  };
}
module.exports = { REQUIRED, validateAudit, schemaFingerprint, catalogueFingerprint, reviewTemplate, findings };
