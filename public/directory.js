/* Shared directory matching. Account identity always comes from the profile ID,
   never a name: different students can have exactly the same name. */
(() => {
  const normalize = value => String(value ?? '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-ZA').trim();
  function matches(profile, filters = {}, mentorId = '') {
    const text = normalize([profile.full_name, profile.first_name, profile.last_name,
      profile.email, profile.student_number].filter(Boolean).join(' '));
    return normalize(filters.search).split(/\s+/).filter(Boolean).every(term => text.includes(term))
      && (!filters.studentNumber || normalize(profile.student_number).includes(normalize(filters.studentNumber)))
      && (!filters.facultyId || String(profile.faculty_id ?? '') === String(filters.facultyId))
      && (!filters.programmeId || String(profile.programme_id ?? '') === String(filters.programmeId))
      && (!filters.role || profile.role === filters.role)
      && (!filters.status || (profile.is_active !== false ? 'active' : 'disabled') === filters.status)
      && (!filters.entryStatus || profile.entry_status === filters.entryStatus)
      && (!filters.studyYear || String(profile.study_year ?? '') === String(filters.studyYear))
      && (!filters.assignment || (mentorId ? 'assigned' : 'unassigned') === filters.assignment)
      && (!filters.mentorId || String(mentorId) === String(filters.mentorId));
  }
  function unique(profiles) {
    return [...new Map(profiles.map(profile => [profile.id, profile])).values()];
  }
  window.fyeDirectory = { normalize, matches, unique };
})();
