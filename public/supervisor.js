const db = window.fyeSupabase;

const navLinks = document.querySelectorAll('.nav-link[data-view]');
const pages = document.querySelectorAll('.page-view');

const dashboardFeedback = document.querySelector('#dashboard-feedback');
const assignmentFeedback = document.querySelector('#assignment-feedback');
const facultySelect = document.querySelector('#assignment-faculty');
const programmeSelect = document.querySelector('#assignment-programme');
const mentorSelect = document.querySelector('#assignment-mentor');
const startButton = document.querySelector('#start-assignment');
const workflow = document.querySelector('#assignment-workflow');
const studentChoices = document.querySelector('#eligible-students');
const finishButton = document.querySelector('#finish-assignment');
const selectAvailableButton = document.querySelector('#select-available-students');
const balanceButton = document.querySelector('#balance-assignments');

const state = {
  // Debounce timer for student filter apply
  _studentFilterDebounce: null,

  user: null,
  profile: null,
  faculties: [],
  programmes: [],
  students: [],
  mentors: [],
  assignments: [],
  selectedMentor: null,
  currentPage: 1,
  pageSize: 10,
  mentorCurrentPage: 1,
  mentorPageSize: 10,
  studentFilters: {},
  mentorFilters: { facultyId: '', programmeId: '' }
};
let remainingCapacity = 0;
function showPage(pageName, updateHistory = true) {
  if (![...pages].some((page) => page.dataset.page === pageName)) return;

  pages.forEach((page) => {
    page.hidden = page.dataset.page !== pageName;
  });

  navLinks.forEach((link) => {
    const active = link.dataset.view === pageName;
    link.classList.toggle('active', active);

    if (active) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  if (updateHistory && history.state?.fyeDashboardView !== pageName) {
    history.pushState({ fyeDashboardView: pageName }, '', `#${pageName}`);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const initialView = [...pages].some((page) => page.dataset.page === location.hash.slice(1))
  ? location.hash.slice(1)
  : 'overview';
history.replaceState({ fyeDashboardView: initialView }, '', `#${initialView}`);
showPage(initialView, false);
window.addEventListener('popstate', (event) => {
  showPage(event.state?.fyeDashboardView || 'overview', false);
});

navLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    showPage(link.dataset.view);
  });
});

document.querySelectorAll('[data-go]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    showPage(button.dataset.go);
  });
});

function profileName(profile) {
  return profile.full_name || profile.email || 'Name not provided';
}

function makeCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = value || 'Not set';
  row.appendChild(cell);
}

function facultyName(id) {
  return state.faculties.find(
    (faculty) => String(faculty.id) === String(id)
  )?.name || 'Not set';
}

function programmeName(id) {
  return state.programmes.find(
    (programme) => String(programme.id) === String(id)
  )?.name || 'Not set';
}

function activeAssignmentsForMentor(mentorId) {
  return state.assignments.filter(
    (assignment) =>
      assignment.mentor_id === mentorId &&
      window.fyeAcademic.active(assignment)
  ).length;
}

function activeMentorForStudent(studentId) {
  const assignment = state.assignments.find(
    (item) =>
      item.student_id === studentId &&
      window.fyeAcademic.active(item)
  );

  return state.mentors.find(
    (mentor) => mentor.id === assignment?.mentor_id
  );
}

function attachStudentViewListeners() {
  document.querySelectorAll('.student-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const studentId = btn.dataset.id;
      const student = state.students.find((s) => s.id === studentId);
      if (!student) return;
      const mentor = activeMentorForStudent(student.id);
      const contentDiv = document.querySelector('#student-detail-content');
      contentDiv.replaceChildren();
      const heading = document.createElement('h2');
      heading.textContent = profileName(student);
      contentDiv.appendChild(heading);
      for (const [label, value] of [
        ['Student number', student.student_number],
        ['Email', student.email],
        ['Faculty', facultyName(student.faculty_id)],
        ['Programme', programmeName(student.programme_id)],
        ['Mentor', mentor ? profileName(mentor) : 'Unassigned'],
        ['Bio', student.bio]
      ]) {
        const paragraph = document.createElement('p');
        const title = document.createElement('strong');
        title.textContent = `${label}: `;
        paragraph.append(title, value || 'Not provided');
        contentDiv.appendChild(paragraph);
      }
      const dialog = document.querySelector('#student-detail-dialog');
      if (dialog) dialog.showModal();
    });
  });
}

function filteredDirectoryStudents() {
  const mentorIds = new Set(state.mentors.map(mentor => mentor.id));
  const matches = new Map(state.assignments.filter(assignment =>
    window.fyeAcademic.active(assignment) && mentorIds.has(assignment.mentor_id)
  ).map(assignment => [assignment.student_id, assignment.mentor_id]));
  return state.students.filter(student => window.fyeDirectory.matches(student, state.studentFilters, matches.get(student.id)));
}

function renderStudentPagination(total) {
  const paginationDiv = document.querySelector('#student-pagination');
  if (!paginationDiv) return;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  const pageInfo = document.createElement('span');
  pageInfo.textContent = `Page ${state.currentPage} of ${totalPages}`;
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.textContent = 'Prev';
  prevBtn.setAttribute('aria-label', 'Previous page of students');
  prevBtn.disabled = state.currentPage <= 1;
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.textContent = 'Next';
  nextBtn.setAttribute('aria-label', 'Next page of students');
  nextBtn.disabled = state.currentPage >= totalPages;

  const sizeSelect = document.createElement('select');
  sizeSelect.setAttribute('aria-label', 'Students per page');
  [10, 25, 50].forEach((size) => {
    const opt = document.createElement('option');
    opt.value = size;
    opt.textContent = `${size} per page`;
    if (size === state.pageSize) opt.selected = true;
    sizeSelect.appendChild(opt);
  });
  sizeSelect.addEventListener('change', () => {
    state.pageSize = Number(sizeSelect.value);
    state.currentPage = 1;
    renderDirectories();
  });

  prevBtn.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderDirectories();
    }
  });
  nextBtn.addEventListener('click', () => {
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderDirectories();
    }
  });

  paginationDiv.replaceChildren();
  paginationDiv.append(pageInfo, ' ', prevBtn, ' ', nextBtn, ' ', sizeSelect);
}

// Close dialog handler
const dialogCloseBtn = document.querySelector('#student-detail-close');
if (dialogCloseBtn) {
  dialogCloseBtn.addEventListener('click', () => {
    const dialog = document.querySelector('#student-detail-dialog');
    if (dialog) dialog.close();
  });
}

function renderDirectories() {
  const studentsBody = document.querySelector('#students-list');
  const mentorsBody = document.querySelector('#mentors-list');
  const assignmentsBody = document.querySelector('#assignment-list');

  studentsBody.replaceChildren();
  mentorsBody.replaceChildren();
  assignmentsBody.replaceChildren();

  const students = filteredDirectoryStudents().sort((a, b) =>
    `${facultyName(a.faculty_id)} ${programmeName(a.programme_id)} ${profileName(a)}`
      .localeCompare(
        `${facultyName(b.faculty_id)} ${programmeName(b.programme_id)} ${profileName(b)}`
      )
  );

  // Apply pagination
  state.currentPage = Math.min(state.currentPage, Math.max(1, Math.ceil(students.length / state.pageSize)));
  const paginatedStudents = students.slice((state.currentPage - 1) * state.pageSize, state.currentPage * state.pageSize);
  for (const student of paginatedStudents) {
    const row = document.createElement('tr');
    const mentor = activeMentorForStudent(student.id);

    makeCell(row, profileName(student));
    makeCell(row, student.student_number);
    makeCell(row, student.email);
    makeCell(row, facultyName(student.faculty_id));
    makeCell(row, programmeName(student.programme_id));
    makeCell(row, mentor ? profileName(mentor) : 'Unassigned');
    // Actions column with View button
    const actionCell = document.createElement('td');
    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'student-view-btn';
    viewBtn.dataset.id = student.id;
    viewBtn.textContent = 'View';
    actionCell.appendChild(viewBtn);
    row.appendChild(actionCell);

    studentsBody.appendChild(row);
  }

  if (!students.length) {
    studentsBody.innerHTML =
      `<tr><td colspan="7">${state.students.length ? 'No students match these filters.' : 'No student profiles found.'}</td></tr>`;
  }

  const mentors = state.mentors.filter((mentor) =>
    (!state.mentorFilters.facultyId || String(mentor.faculty_id) === state.mentorFilters.facultyId)
    && (!state.mentorFilters.programmeId || String(mentor.programme_id) === state.mentorFilters.programmeId)
  ).sort((a, b) =>
    `${facultyName(a.faculty_id)} ${programmeName(a.programme_id)} ${profileName(a)}`
      .localeCompare(`${facultyName(b.faculty_id)} ${programmeName(b.programme_id)} ${profileName(b)}`)
  );

  // Mentor pagination calculations
  const totalMentors = mentors.length;
  const totalMentorPages = Math.max(1, Math.ceil(totalMentors / state.mentorPageSize));
  state.mentorCurrentPage = Math.min(state.mentorCurrentPage, totalMentorPages);
  const paginatedMentors = mentors.slice((state.mentorCurrentPage - 1) * state.mentorPageSize, state.mentorCurrentPage * state.mentorPageSize);

  for (const mentor of paginatedMentors) {
    const count = activeAssignmentsForMentor(mentor.id);
    const row = document.createElement('tr');
    makeCell(row, profileName(mentor));
    makeCell(row, mentor.email);
    makeCell(row, facultyName(mentor.faculty_id));
    makeCell(row, programmeName(mentor.programme_id));
    makeCell(row, String(count));
    makeCell(row, `${count} / 20`);

    const actions = document.createElement('td');
    if (/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+(?:[/?#]|$)/.test(mentor.whatsapp_group_link || '')) {
      const contact = document.createElement('a');
      contact.href = mentor.whatsapp_group_link;
      contact.target = '_blank';
      contact.rel = 'noopener noreferrer';
      contact.className = 'text-button';
      contact.textContent = 'WhatsApp group';
      actions.appendChild(contact);
    } else {
      actions.textContent = 'No group link';
    }
    row.appendChild(actions);
    mentorsBody.appendChild(row);
  }

  if (!mentors.length) {
    mentorsBody.innerHTML =
      '<tr><td colspan="7">No mentors match these filters.</td></tr>';
  }

  // Render mentor pagination controls
  const mentorPaginationDiv = document.querySelector('#mentor-pagination');
  if (mentorPaginationDiv) {
    const pageInfo = document.createElement('span');
    pageInfo.textContent = `Page ${state.mentorCurrentPage} of ${totalMentorPages}`;
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.textContent = 'Prev';
    prevBtn.setAttribute('aria-label', 'Previous page of mentors');
    prevBtn.disabled = state.mentorCurrentPage <= 1;
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.textContent = 'Next';
    nextBtn.setAttribute('aria-label', 'Next page of mentors');
    nextBtn.disabled = state.mentorCurrentPage >= totalMentorPages;
    const sizeSelect = document.createElement('select');
    [10, 25, 50].forEach((size) => {
      const opt = document.createElement('option');
      opt.value = size;
      opt.textContent = `${size} per page`;
      if (size === state.mentorPageSize) opt.selected = true;
      sizeSelect.appendChild(opt);
    });
    sizeSelect.addEventListener('change', () => {
      state.mentorPageSize = Number(sizeSelect.value);
      state.mentorCurrentPage = 1;
      renderDirectories();
    });
    prevBtn.addEventListener('click', () => {
      if (state.mentorCurrentPage > 1) {
        state.mentorCurrentPage--;
        renderDirectories();
      }
    });
    nextBtn.addEventListener('click', () => {
      if (state.mentorCurrentPage < totalMentorPages) {
        state.mentorCurrentPage++;
        renderDirectories();
      }
    });
    mentorPaginationDiv.replaceChildren();
    mentorPaginationDiv.append(pageInfo, ' ', prevBtn, ' ', nextBtn, ' ', sizeSelect);
  }

  const activeAssignments = state.assignments
    .filter((assignment) => window.fyeAcademic.active(assignment))
    .sort((a, b) =>
      String(b.assigned_at).localeCompare(String(a.assigned_at))
    );

  const matchGroups = document.querySelector('#assignment-mentor-groups');
  const matchSummary = document.querySelector('#assignment-match-summary');
  if (matchGroups && matchSummary) {
    matchGroups.replaceChildren();
    const mentorIds = [...new Set(activeAssignments.map((item) => item.mentor_id))];
    matchSummary.textContent = `${activeAssignments.length} active matches across ${mentorIds.length} mentors. Open a mentor to view their assigned students.`;
    for (const mentorId of mentorIds) {
      const mentor = state.mentors.find((item) => item.id === mentorId);
      const matches = activeAssignments.filter((item) => item.mentor_id === mentorId);
      const group = document.createElement('details');
      group.className = 'match-mentor-card';
      const summary = document.createElement('summary');
      summary.textContent = `${mentor ? profileName(mentor) : 'Mentor unavailable'} · ${matches.length} / 20 students`;
      const info = document.createElement('p');
      info.className = 'summary-text';
      info.textContent = mentor ? `${facultyName(mentor.faculty_id)} · ${programmeName(mentor.programme_id)}` : '';
      const students = document.createElement('ul');
      for (const match of matches) {
        const student = state.students.find((item) => item.id === match.student_id);
        const row = document.createElement('li');
        row.textContent = student ? `${profileName(student)} · ${student.student_number || student.email || ''}` : 'Student profile unavailable';
        students.appendChild(row);
      }
      group.append(summary, info, students);
      matchGroups.appendChild(group);
    }
  }

  for (const assignment of activeAssignments) {
    const student = state.students.find(
      (item) => item.id === assignment.student_id
    );
    const mentor = state.mentors.find(
      (item) => item.id === assignment.mentor_id
    );
    const row = document.createElement('tr');

    makeCell(
      row,
      student ? profileName(student) : 'Student profile unavailable'
    );
    makeCell(
      row,
      student ? facultyName(student.faculty_id) : 'Not set'
    );
    makeCell(
      row,
      student ? programmeName(student.programme_id) : 'Not set'
    );
    makeCell(
      row,
      mentor ? profileName(mentor) : 'Mentor profile unavailable'
    );
    makeCell(
      row,
      assignment.assigned_at
        ? new Date(assignment.assigned_at).toLocaleDateString()
        : 'Not set'
    );

    assignmentsBody.appendChild(row);
  }

  if (!activeAssignments.length) {
    assignmentsBody.innerHTML =
      '<tr><td colspan="5">No active assignments yet.</td></tr>';
  }

  // Update result count display
  const totalFiltered = students.length;
  const startIdx = totalFiltered ? (state.currentPage - 1) * state.pageSize + 1 : 0;
  const endIdx = Math.min(state.currentPage * state.pageSize, totalFiltered);
  const resultCountEl = document.querySelector('#student-result-count');
  if (resultCountEl) {
    resultCountEl.textContent = `Showing ${startIdx}-${endIdx} of ${totalFiltered} results`;
  }
  renderStudentPagination(totalFiltered);
  attachStudentViewListeners();

  document.querySelector('#student-count').textContent =
    String(state.students.length);
  document.querySelector('#mentor-count').textContent =
    String(state.mentors.length);
  document.querySelector('#assignment-count').textContent =
    String(activeAssignments.length);
}

async function loadFaculties() {
  const { data, error } = await db
    .from('faculties')
    .select('id, name')
    .order('name');

  if (error) throw error;

  state.faculties = data || [];
  facultySelect.innerHTML =
    '<option value="">Choose a faculty</option>';

  for (const faculty of state.faculties) {
    const option = document.createElement('option');
    option.value = faculty.id;
    option.textContent = faculty.name;
    facultySelect.appendChild(option);
  }

  facultySelect.disabled = false;
}

async function loadAllData() {
  const [profiles, appointments, faculties, programmes, assignments, mappings] = await Promise.all([
    window.fyeAcademic.all('profiles','*',q=>q.in('role',['student','mentor'])),
    window.fyeAcademic.all('mentor_appointments'), window.fyeAcademic.all('faculties'),
    window.fyeAcademic.all('programmes'), window.fyeAcademic.all('mentor_assignments'),
    (async()=>{const rows=[];for(let start=0;;){const {data,error}=await db.from('mentor_programme_mappings').select('*').order('mentor_id').order('programme_id').range(start,start+499);if(error)throw error;if(!data?.length)return rows;rows.push(...data);start+=data.length;}})()
  ]);
  state.faculties=faculties; state.programmes=programmes;
  const activeAppointments=new Map(appointments.filter(a=>!a.ended_at && Date.parse(a.starts_at)<=Date.now()).map(a=>[a.mentor_id,a]));
  state.assignments=assignments.map(a=>activeAppointments.has(a.student_id)?{...a,ended_at:activeAppointments.get(a.student_id).starts_at}:a);
  state.students=window.fyeDirectory.unique(profiles).filter(p=>p.role==='student' && p.is_active!==false && !activeAppointments.has(p.id));
  state.mentors=profiles.filter(p=>p.is_active!==false && activeAppointments.has(p.id)).map(p=>({...p,appointment:activeAppointments.get(p.id),mappings:mappings.filter(m=>m.mentor_id===p.id)}));
  document.dispatchEvent(new CustomEvent('fye:supervisor-academic-data',{detail:{profiles,appointments,faculties,programmes,assignments,mappings}}));

  updateStudentFilterOptions();
  updateMentorFilterOptions();
  renderDirectories();

  facultySelect.innerHTML =
    '<option value="">Choose a faculty</option>';

  for (const faculty of state.faculties) {
    const option = document.createElement('option');
    option.value = faculty.id;
    option.textContent = faculty.name;
    facultySelect.appendChild(option);
  }

  facultySelect.disabled = false;
}

function updateStudentFilterOptions() {
  const filters = state.studentFilters;
  const fill = (id, label, items, value) => {
    const select = document.querySelector(id);
    select.replaceChildren(new Option(label, ''));
    items.forEach(([text, key]) => select.add(new Option(text, String(key))));
    select.value = value || '';
    if (select.selectedIndex < 0) select.value = '';
    return select.value;
  };
  filters.facultyId = fill('#student-filter-faculty', 'All faculties',
    state.faculties.map(f => [f.name, f.id]), filters.facultyId);
  filters.programmeId = fill('#student-filter-programme', 'All programmes',
    state.programmes.filter(p => !filters.facultyId || String(p.faculty_id) === filters.facultyId)
      .map(p => [p.name, p.id]), filters.programmeId);
  filters.mentorId = fill('#student-filter-mentor', 'All mentors',
    state.mentors.filter(m => !filters.facultyId || String(m.faculty_id) === filters.facultyId)
      .map(m => [`${profileName(m)} · ${m.student_number || m.email || m.id}`, m.id]), filters.mentorId);
  filters.studyYear = fill('#student-filter-year', 'All study years',
    [...new Set(state.students.map(s => s.study_year).filter(Boolean))].sort((a,b) => a-b)
      .map(year => [`Year ${year}`, year]), filters.studyYear);
}

function filteredMentors() {
  return state.mentors.filter(
    (mentor) =>
      String(mentor.faculty_id) === String(facultySelect.value) &&
      !mentor.appointment?.paused && !!mentor.academic_verified_at && (String(mentor.programme_id) === String(programmeSelect.value) || mentor.mappings?.some(m=>String(m.programme_id)===String(programmeSelect.value)))
  );
}

function filteredUnassignedStudents() {
  const activeStudentIds = new Set(
    state.assignments
      .filter((assignment) => window.fyeAcademic.active(assignment)||(!assignment.ended_at&&!assignment.effective_end_at))
      .map((assignment) => assignment.student_id)
  );

  return state.students.filter(
    (student) =>
      window.fyeAcademic.eligible(student,state.programmes.find(p=>String(p.id)===String(student.programme_id))) &&
      String(student.faculty_id) === String(facultySelect.value) &&
      String(student.programme_id) === String(programmeSelect.value) &&
      !activeStudentIds.has(student.id)
  );
}

function updateStudentChoices() {
  studentChoices.replaceChildren();
  assignmentFeedback.textContent = '';

  const mentor = state.mentors.find(
    (item) => item.id === mentorSelect.value
  );

  state.selectedMentor = mentor || null;

  if (!mentor) {
    studentChoices.textContent =
      'Choose a mentor to see eligible students.';
    finishButton.disabled = true;
    remainingCapacity = 0;
    selectAvailableButton.disabled = true;
    document.querySelector('#mentor-capacity').textContent = '';
    return;
  }

  const currentCount = activeAssignmentsForMentor(mentor.id);
  const remaining = Math.max(0, 20 - currentCount);
  remainingCapacity = remaining;

  document.querySelector('#mentor-capacity').textContent =
    `Current students: ${currentCount} of 20. Spaces remaining: ${remaining}.`;

  const students = filteredUnassignedStudents();

  if (!students.length) {
    studentChoices.textContent =
      'There are no unassigned students in this programme.';
    finishButton.disabled = true;
    selectAvailableButton.disabled = true;
    return;
  }

  if (!remaining) {
    studentChoices.textContent =
      'This mentor has reached the 20-student limit.';
    finishButton.disabled = true;
    selectAvailableButton.disabled = true;
    return;
  }

  for (const student of students) {
    const label = document.createElement('label');
    label.className = 'student-choice';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'selected-students';
    checkbox.value = student.id;

    const details = document.createElement('span');
    details.textContent =
      `${profileName(student)} — ${student.email || 'no email'}`;

    label.append(checkbox, details);
    studentChoices.appendChild(label);
  }
  selectAvailableButton.disabled = false;

  studentChoices
    .querySelectorAll('input[type="checkbox"]')
    .forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const checked = [
          ...studentChoices.querySelectorAll('input:checked')
        ];

        if (checked.length > remaining) {
          checkbox.checked = false;
          assignmentFeedback.textContent =
            `This mentor has room for ${remaining} more student(s).`;
        }

        finishButton.disabled =
          studentChoices.querySelectorAll('input:checked').length === 0;
      });
    });

  finishButton.disabled = true;
}

facultySelect.addEventListener('change', () => {
  assignmentFeedback.textContent = '';
  workflow.hidden = true;
  startButton.disabled = true;
  balanceButton.disabled = true;
  programmeSelect.disabled = true;
  programmeSelect.innerHTML =
    '<option value="">Loading programmes…</option>';
  mentorSelect.innerHTML =
    '<option value="">Choose a programme first</option>';
  mentorSelect.disabled = true;
  studentChoices.textContent =
    'Choose a faculty and programme first.';

  if (!facultySelect.value) {
    programmeSelect.innerHTML =
      '<option value="">Choose a faculty first</option>';
    return;
  }

  const programmes = state.programmes.filter(
    (programme) =>
      String(programme.faculty_id) === String(facultySelect.value)
  );

  programmeSelect.innerHTML =
    '<option value="">Choose a programme</option>';

  for (const programme of programmes) {
    const option = document.createElement('option');
    option.value = programme.id;
    option.textContent = programme.name;
    programmeSelect.appendChild(option);
  }

  programmeSelect.disabled = false;

  if (!programmes.length) {
    programmeSelect.innerHTML =
      '<option value="">No programmes listed</option>';
  }
});

programmeSelect.addEventListener('change', () => {
  workflow.hidden = true;
  startButton.disabled = !programmeSelect.value;
  balanceButton.disabled = !programmeSelect.value;
  mentorSelect.innerHTML =
    '<option value="">Choose a programme first</option>';
  mentorSelect.disabled = true;
  assignmentFeedback.textContent = '';
});

startButton.addEventListener('click', () => {
  workflow.hidden = false;
  assignmentFeedback.textContent = '';

  const mentors = filteredMentors().sort((left, right) =>
    activeAssignmentsForMentor(left.id) - activeAssignmentsForMentor(right.id)
  );
  mentorSelect.innerHTML =
    '<option value="">Choose a mentor</option>';

  for (const mentor of mentors) {
    const option = document.createElement('option');
    option.value = mentor.id;
    option.textContent =
      `${profileName(mentor)} (${activeAssignmentsForMentor(mentor.id)}/20 students)`;
    mentorSelect.appendChild(option);
  }

  mentorSelect.disabled = false;
  studentChoices.textContent =
    'Choose a mentor to see eligible students.';

  if (!mentors.length) {
    mentorSelect.innerHTML =
      '<option value="">No mentors in this programme</option>';
    mentorSelect.disabled = true;
    assignmentFeedback.textContent =
      'No mentors have selected this faculty and programme yet.';
  }
});

mentorSelect.addEventListener('change', updateStudentChoices);

selectAvailableButton.addEventListener('click', () => {
  const checkboxes = [...studentChoices.querySelectorAll('input[type="checkbox"]')];
  const selected = checkboxes.filter((checkbox) => checkbox.checked).length;
  let available = Math.max(0, remainingCapacity - selected);
  for (const checkbox of checkboxes) {
    if (available <= 0) break;
    if (!checkbox.checked) {
      checkbox.checked = true;
      available -= 1;
      checkbox.dispatchEvent(new Event('change'));
    }
  }
});

balanceButton.addEventListener('click', async () => {
  assignmentFeedback.textContent = '';
  const students = filteredUnassignedStudents();
  if (!students.length) {
    assignmentFeedback.textContent = 'There are no unassigned students in this programme.';
    return;
  }
  if (!window.confirm(`Distribute ${students.length} unassigned students as evenly as possible across approved mentors, without exceeding capacity?`)) return;

  balanceButton.disabled = true;
  assignmentFeedback.textContent = 'Balancing assignments across eligible mentors…';
  const { error } = await db.rpc('assign_students_evenly', {
    p_faculty_id: Number(facultySelect.value),
    p_programme_id: Number(programmeSelect.value),
    p_student_ids: students.map((student) => student.id)
  });
  if (error) {
    console.error('Could not balance mentor assignments:', error);
    assignmentFeedback.textContent = `Could not balance assignments: ${error.message}`;
    balanceButton.disabled = false;
    return;
  }
  assignmentFeedback.textContent = 'Students were distributed as evenly as capacity allowed.';
  await loadAllData();
  workflow.hidden = true;
  startButton.disabled = false;
  balanceButton.disabled = false;
});

const studentFilterSearch = document.querySelector('#student-filter-search');
const studentFilterNumber = document.querySelector('#student-filter-number');
const studentFilterApply = document.querySelector('#student-filter-apply');
const mentorFacultySelect = document.querySelector('#mentor-filter-faculty');
const mentorProgrammeSelect = document.querySelector('#mentor-filter-programme');

function updateMentorFilterOptions() {
  mentorFacultySelect.replaceChildren(new Option('All faculties', ''));
  for (const faculty of state.faculties) {
    mentorFacultySelect.add(new Option(faculty.name, String(faculty.id)));
  }
  mentorFacultySelect.value = state.mentorFilters.facultyId;
  mentorProgrammeSelect.replaceChildren(new Option('All programmes', ''));
  for (const programme of state.programmes.filter((item) =>
    !state.mentorFilters.facultyId || String(item.faculty_id) === state.mentorFilters.facultyId
  )) {
    mentorProgrammeSelect.add(new Option(programme.name, String(programme.id)));
  }
  mentorProgrammeSelect.value = state.mentorFilters.programmeId;
}

mentorFacultySelect.addEventListener('change', () => {
  state.mentorFilters = { facultyId: mentorFacultySelect.value, programmeId: '' };
  state.mentorCurrentPage = 1;
  updateMentorFilterOptions();
  renderDirectories();
});
mentorProgrammeSelect.addEventListener('change', () => {
  state.mentorFilters.programmeId = mentorProgrammeSelect.value;
  state.mentorCurrentPage = 1;
  renderDirectories();
});
document.querySelector('#mentor-filter-clear').addEventListener('click', () => {
  state.mentorFilters = { facultyId: '', programmeId: '' };
  state.mentorCurrentPage = 1;
  updateMentorFilterOptions();
  renderDirectories();
});

[studentFilterSearch, studentFilterNumber].forEach((input) => {
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      studentFilterApply?.click();
    }
  });
});

function applyStudentFilters() {
  clearTimeout(state._studentFilterDebounce);
  state.currentPage = 1;
  state.studentFilters = {
    search: studentFilterSearch.value.trim(),
    studentNumber: studentFilterNumber.value.trim(),
    facultyId: document.querySelector('#student-filter-faculty').value,
    programmeId: document.querySelector('#student-filter-programme').value,
    mentorId: document.querySelector('#student-filter-mentor').value,
    assignment: document.querySelector('#student-filter-assignment').value,
    entryStatus: document.querySelector('#student-filter-entry').value,
    studyYear: document.querySelector('#student-filter-year').value
  };
  renderDirectories();
}
studentFilterApply.addEventListener('click', applyStudentFilters);
document.querySelector('#student-filter-faculty').addEventListener('change', () => {
  state.studentFilters.facultyId = document.querySelector('#student-filter-faculty').value;
  state.studentFilters.programmeId = '';
  state.studentFilters.mentorId = '';
  updateStudentFilterOptions();
  applyStudentFilters();
});
for (const id of ['programme','mentor','assignment','entry','year']) {
  document.querySelector(`#student-filter-${id}`).addEventListener('change', () => {
    if (id === 'mentor' && document.querySelector('#student-filter-mentor').value) {
      document.querySelector('#student-filter-assignment').value = 'assigned';
    }
    if (id === 'assignment' && document.querySelector('#student-filter-assignment').value === 'unassigned') {
      document.querySelector('#student-filter-mentor').value = '';
    }
    applyStudentFilters();
  });
}
[studentFilterSearch, studentFilterNumber].forEach((input) => {
  input.addEventListener('input', () => {
    clearTimeout(state._studentFilterDebounce);
    state._studentFilterDebounce = setTimeout(applyStudentFilters, 300);
  });
});

document.querySelector('#student-filter-clear').addEventListener('click', () => {
  clearTimeout(state._studentFilterDebounce);
  state.currentPage = 1;
  document.querySelectorAll('.supervisor-student-filters input,.supervisor-student-filters select').forEach(input => { input.value = ''; });
  state.studentFilters = {};
  updateStudentFilterOptions();
  renderDirectories();
});

document.querySelector('#active-mentors-report').addEventListener('click', () => {
  const rows = [
    ['Mentor', 'Email', 'Faculty', 'Programme', 'Active students', 'Capacity'],
    ...state.mentors.map((mentor) => {
      const count = activeAssignmentsForMentor(mentor.id);
      return [
        profileName(mentor),
        mentor.email || '',
        facultyName(mentor.faculty_id),
        programmeName(mentor.programme_id),
        count,
        20
      ];
    })
  ];
  const csv = rows.map((row) => row.map((value) => {
    const cell = String(value).replace(/[\r\n\t]/g, ' ');
    return `"${cell.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const download = document.createElement('a');
  download.href = url;
  download.download = 'fye-active-mentors-report.csv';
  download.click();
  URL.revokeObjectURL(url);
});

function safePdfText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildAssignmentPdf(mentor, students, faculty, programme) {
  const lines = [
    'FYE HUB - MENTOR ASSIGNMENT PROOF',
    '',
    `Faculty: ${faculty}`,
    `Programme: ${programme}`,
    `Mentor: ${profileName(mentor)}`,
    `Students assigned: ${students.length}`,
    `Date: ${new Date().toLocaleDateString()}`,
    '',
    'ASSIGNED STUDENTS',
    ''
  ];

  students.forEach((student, index) => {
    const email = student.email ? ` - ${student.email}` : '';
    lines.push(`${index + 1}. ${profileName(student)}${email}`);
  });

  const linesPerPage = 48;
  const pages = [];

  for (let index = 0; index < lines.length; index += linesPerPage) {
    pages.push(lines.slice(index, index + linesPerPage));
  }

  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  const pageObjectIds = [];

  pages.forEach((pageLines, pageIndex) => {
    const pageObjectId = 4 + pageIndex * 2;
    const contentObjectId = pageObjectId + 1;
    pageObjectIds.push(`${pageObjectId} 0 R`);

    const textCommands = pageLines
      .map((line) => `(${safePdfText(line)}) Tj\nT*`)
      .join('\n');

    const stream =
      `BT\n/F1 11 Tf\n50 790 Td\n15 TL\n${textCommands}\nET`;

    objects[pageObjectId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] ` +
      `/Resources << /Font << /F1 3 0 R >> >> ` +
      `/Contents ${contentObjectId} 0 R >>`;

    objects[contentObjectId] =
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  objects[2] =
    `<< /Type /Pages /Kids [${pageObjectIds.join(' ')}] ` +
    `/Count ${pageObjectIds.length} >>`;

  const objectCount = objects.length - 1;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (let id = 1; id <= objectCount; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objectCount + 1}\n`;
  pdf += '0000000000 65535 f \n';

  for (let id = 1; id <= objectCount; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }

  pdf +=
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF`;

  return pdf;
}

function downloadAssignmentPdf(mentor, students, faculty, programme) {
  const pdf = buildAssignmentPdf(
    mentor,
    students,
    faculty,
    programme
  );

  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  const safeName =
    profileName(mentor)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'mentor';

  link.href = url;
  link.download =
    `fye-assignment-${safeName}-${Date.now()}.pdf`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

finishButton.addEventListener('click', async () => {
  assignmentFeedback.textContent = '';

  const mentor = state.selectedMentor;
  const selectedIds = [
    ...studentChoices.querySelectorAll('input:checked')
  ].map((checkbox) => checkbox.value);

  const students = state.students.filter((student) =>
    selectedIds.includes(student.id)
  );

  if (!mentor || !students.length) {
    assignmentFeedback.textContent =
      'Choose a mentor and at least one student.';
    return;
  }

  finishButton.disabled = true;
  finishButton.textContent = 'Saving assignment…';

  try {
    const { error } = await db.rpc('assign_students_to_mentor', {
      p_mentor_id: mentor.id,
      p_student_ids: selectedIds
    });

    if (error) throw error;

    downloadAssignmentPdf(
      mentor,
      students,
      facultyName(facultySelect.value),
      programmeName(programmeSelect.value)
    );

    assignmentFeedback.textContent =
      'Assignments saved and the PDF has been downloaded.';

    await loadAllData();
    workflow.hidden = true;
    startButton.disabled = false;
  } catch (error) {
    console.error('Could not save mentor assignment:', error);
    assignmentFeedback.textContent =
      `Assignment was not saved: ${error.message || 'Check your Supabase permissions.'}`;
  } finally {
    finishButton.disabled = false;
    finishButton.textContent =
      'Finish assignment & download proof PDF';
  }
});

document
  .querySelector('#signout-link')
  .addEventListener('click', async (event) => {
    event.preventDefault();

    if (db) {
      await db.auth.signOut();
    }

    window.location.href = 'index.html';
  });

async function initSupervisorDashboard() {
  const account = window.fyeAuth ? await window.fyeAuth.ready : null;
  if (window.fyeAuth && !account) return;
  if (!db) {
    dashboardFeedback.textContent =
      'Supabase did not load. Check supabase-config.js and refresh.';
    return;
  }

  const { data: authData, error: authError } =
    account ? {data:{user:account.user}} : await db.auth.getUser();

  if (authError || !authData.user) {
    window.location.href = 'index.html';
    return;
  }

  state.user = authData.user;

  const { data: profile, error: profileError } = account ? {data:account.profile} : await db
    .from('profiles')
    .select('full_name, role')
    .eq('id', state.user.id)
    .single();

  if (profileError || !profile || profile.role !== 'supervisor') {
    dashboardFeedback.textContent =
      'This page is for supervisor accounts. Sign in with a supervisor account.';
    await db.auth.signOut();
    return;
  }

  state.profile = profile;

  const name = profile.full_name || 'Supervisor';
  document.querySelector('#supervisor-name').textContent = name;
  document.querySelector('#welcome-heading').innerHTML =
    `Welcome, ${name.replace(/[&<>"']/g, '')}! <span class="wave">👋</span>`;

  document.querySelector('#supervisor-initials').textContent =
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  try {
    await loadFaculties();
    await loadAllData();
  } catch (error) {
    console.error('Could not load supervisor dashboard:', error);
    dashboardFeedback.textContent =
      `Could not load dashboard data: ${error.message || 'Check the Supabase policies.'}`;
  }
}

window.addEventListener('fye:supervisor-data-refresh', loadAllData);
initSupervisorDashboard();
