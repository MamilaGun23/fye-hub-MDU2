'use strict';

// Shared, clock-injected domain rules for preview generation and offline checks.
// Live enforcement must also exist in PostgreSQL before any seed writes are enabled.
const LEVELS = Object.freeze(['undergraduate', 'honours', 'postgraduate_diploma', 'masters', 'doctorate']);
function academicDate(instant = new Date()) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid academic date.');
  const parts = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
function cycleAt(instant) {
  const { year, month } = academicDate(instant);
  return { year: month === 1 ? year - 1 : year, open: month >= 10 || month === 1 };
}
function applicationEligibility(student, instant) {
  const cycle = cycleAt(instant);
  if (!cycle.open) return { eligible: false, reason: 'Applications open October 1 through January 31.' };
  if (student.is_active === false) return { eligible: false, reason: 'An active student account is required.' };
  if (!LEVELS.includes(student.qualification_level) || !Number.isInteger(student.first_entry_year)
      || !Number.isInteger(student.study_year) || student.study_year < 1
      || student.first_entry_year > academicDate(instant).year
      || (student.entry_status === 'first_time' && student.qualification_level !== 'undergraduate')
      || !['first_time', 'returning'].includes(student.entry_status)) {
    return { eligible: false, reason: 'Complete academic details before applying.' };
  }
  if (student.entry_status === 'first_time' && student.first_entry_year !== cycle.year) {
    return { eligible: false, reason: 'New January entrants wait until October.' };
  }
  return { eligible: true, cycle: cycle.year, target_year: cycle.year + 1,
    deferred_first_year: student.entry_status === 'first_time' };
}
function eligibleMentee(student, instant) {
  const { year } = academicDate(instant);
  return student.role === 'student' && student.is_active === true
    && student.qualification_level === 'undergraduate' && student.study_year === 1
    && student.entry_status === 'first_time' && student.first_entry_year === year
    && student.academic_verified === true;
}
function assignmentActive(assignment, instant = new Date()) {
  const time = new Date(instant).getTime();
  // New assignments have explicit expiry. Existing unknown-year matches continue
  // until a supervisor reviews them; migration must not silently sever them.
  return !assignment.ended_at && Date.parse(assignment.assigned_at) <= time
    && (assignment.academic_year == null || Date.parse(assignment.effective_end_at) > time);
}
module.exports = { LEVELS, academicDate, cycleAt, applicationEligibility, eligibleMentee, assignmentActive };
