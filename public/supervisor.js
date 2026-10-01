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

const state = {
  user: null,
  profile: null,
  faculties: [],
  programmes: [],
  students: [],
  mentors: [],
  assignments: [],
  selectedMentor: null
};

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
  button.addEventListener('click', () => showPage(button.dataset.go));
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
      assignment.ended_at === null
  ).length;
}

function activeMentorForStudent(studentId) {
  const assignment = state.assignments.find(
    (item) =>
      item.student_id === studentId &&
      item.ended_at === null
  );

  return state.mentors.find(
    (mentor) => mentor.id === assignment?.mentor_id
  );
}

function renderDirectories() {
  const studentsBody = document.querySelector('#students-list');
  const mentorsBody = document.querySelector('#mentors-list');
  const assignmentsBody = document.querySelector('#assignment-list');

  studentsBody.replaceChildren();
  mentorsBody.replaceChildren();
  assignmentsBody.replaceChildren();

  const students = [...state.students].sort((a, b) =>
    `${facultyName(a.faculty_id)} ${programmeName(a.programme_id)} ${profileName(a)}`
      .localeCompare(
        `${facultyName(b.faculty_id)} ${programmeName(b.programme_id)} ${profileName(b)}`
      )
  );

  for (const student of students) {
    const row = document.createElement('tr');
    const mentor = activeMentorForStudent(student.id);

    makeCell(row, profileName(student));
    makeCell(row, student.email);
    makeCell(row, facultyName(student.faculty_id));
    makeCell(row, programmeName(student.programme_id));
    makeCell(row, mentor ? profileName(mentor) : 'Unassigned');

    studentsBody.appendChild(row);
  }

  if (!students.length) {
    studentsBody.innerHTML =
      '<tr><td colspan="5">No student profiles found.</td></tr>';
  }

  const mentors = [...state.mentors].sort((a, b) =>
    `${facultyName(a.faculty_id)} ${programmeName(a.programme_id)} ${profileName(a)}`
      .localeCompare(
        `${facultyName(b.faculty_id)} ${programmeName(b.programme_id)} ${profileName(b)}`
      )
  );

  for (const mentor of mentors) {
    const count = activeAssignmentsForMentor(mentor.id);
    const row = document.createElement('tr');

    makeCell(row, profileName(mentor));
    makeCell(row, mentor.email);
    makeCell(row, facultyName(mentor.faculty_id));
    makeCell(row, programmeName(mentor.programme_id));
    makeCell(row, String(count));
    makeCell(row, `${count} / 20`);

    mentorsBody.appendChild(row);
  }

  if (!mentors.length) {
    mentorsBody.innerHTML =
      '<tr><td colspan="6">No mentor profiles found.</td></tr>';
  }

  const activeAssignments = state.assignments
    .filter((assignment) => assignment.ended_at === null)
    .sort((a, b) =>
      String(b.assigned_at).localeCompare(String(a.assigned_at))
    );

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
  const [
    profilesResult,
    approvedApplicationsResult,
    facultiesResult,
    programmesResult,
    assignmentsResult
  ] = await Promise.all([
    db
      .from('profiles')
      .select('id, email, full_name, role, mentor_approval_status, faculty_id, programme_id')
      .in('role', ['student', 'mentor']),

    db
      .from('mentor_applications')
      .select('applicant_id')
      .eq('status', 'approved'),

    db
      .from('faculties')
      .select('id, name')
      .order('name'),

    db
      .from('programmes')
      .select('id, name, faculty_id')
      .order('name'),

    db
      .from('mentor_assignments')
      .select('student_id, mentor_id, assigned_at, ended_at')
  ]);

  const approvalTableError = approvedApplicationsResult.error?.code === 'PGRST205'
    ? null
    : approvedApplicationsResult.error;
  const error = [
    profilesResult.error,
    approvalTableError,
    facultiesResult.error,
    programmesResult.error,
    assignmentsResult.error
  ].find(Boolean);

  if (error) throw error;

  state.faculties = facultiesResult.data || [];
  state.programmes = programmesResult.data || [];

  const profiles = profilesResult.data || [];
  const approvedMentorIds = new Set(
    (approvedApplicationsResult.data || []).map((application) => application.applicant_id)
  );
  state.students = profiles.filter((profile) =>
    profile.role === 'student' || profile.role === 'mentor'
  );
  state.mentors = profiles.filter((profile) =>
    approvedMentorIds.has(profile.id)
    || (profile.role === 'mentor' && profile.mentor_approval_status === 'approved')
  );
  state.assignments = assignmentsResult.data || [];

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

function filteredMentors() {
  return state.mentors.filter(
    (mentor) =>
      String(mentor.faculty_id) === String(facultySelect.value) &&
      String(mentor.programme_id) === String(programmeSelect.value)
  );
}

function filteredUnassignedStudents() {
  const activeStudentIds = new Set(
    state.assignments
      .filter((assignment) => assignment.ended_at === null)
      .map((assignment) => assignment.student_id)
  );

  return state.students.filter(
    (student) =>
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
    document.querySelector('#mentor-capacity').textContent = '';
    return;
  }

  const currentCount = activeAssignmentsForMentor(mentor.id);
  const remaining = Math.max(0, 20 - currentCount);

  document.querySelector('#mentor-capacity').textContent =
    `Current students: ${currentCount} of 20. Spaces remaining: ${remaining}.`;

  const students = filteredUnassignedStudents();

  if (!students.length) {
    studentChoices.textContent =
      'There are no unassigned students in this programme.';
    finishButton.disabled = true;
    return;
  }

  if (!remaining) {
    studentChoices.textContent =
      'This mentor has reached the 20-student limit.';
    finishButton.disabled = true;
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
  mentorSelect.innerHTML =
    '<option value="">Choose a programme first</option>';
  mentorSelect.disabled = true;
  assignmentFeedback.textContent = '';
});

startButton.addEventListener('click', () => {
  workflow.hidden = false;
  assignmentFeedback.textContent = '';

  const mentors = filteredMentors();
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
  if (!db) {
    dashboardFeedback.textContent =
      'Supabase did not load. Check supabase-config.js and refresh.';
    return;
  }

  const { data: authData, error: authError } =
    await db.auth.getUser();

  if (authError || !authData.user) {
    window.location.href = 'index.html';
    return;
  }

  state.user = authData.user;

  const { data: profile, error: profileError } = await db
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

initSupervisorDashboard();