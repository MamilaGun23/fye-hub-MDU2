const fyeClient = window.fyeSupabase;
const navLinks = document.querySelectorAll('.nav-link[data-view]');
const pages = document.querySelectorAll('.page-view');
const profileForm = document.querySelector('#mentor-profile-form');
const photoInput = document.querySelector('#profile-photo');
const photoPreview = document.querySelector('#profile-preview');
const initials = document.querySelector('#profile-initials');
const feedback = document.querySelector('#profile-feedback');
const facultySelect = document.querySelector('#profile-faculty');
const programmeSelect = document.querySelector('#profile-programme');
const studentList = document.querySelector('#mentor-student-list');
const studentCount = document.querySelector('#mentor-student-count');

let currentUser = null;
let currentProfile = null;

function showPage(pageName) {
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

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

navLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    showPage(link.dataset.view);
  });
});

document.querySelectorAll('[data-go]').forEach((button) => {
  button.addEventListener('click', () => showPage(button.dataset.go));
});

function showPhoto(url) {
  if (url) {
    photoPreview.src = url;
    photoPreview.hidden = false;
    initials.hidden = true;
  } else {
    photoPreview.removeAttribute('src');
    photoPreview.hidden = true;
    initials.hidden = false;
  }
}

function getInitials(name) {
  return (name || 'Student')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function updateMentorName(fullName) {
  const name = fullName?.trim() || 'Mentor';
  const firstName = name.split(/\s+/)[0];
  const nameDisplay = document.querySelector('.profile-chip .profile-name');
  const headerAvatar = document.querySelector('.profile-chip .small-avatar');
  const greetingName = document.querySelector('#mentor-greeting-name');

  if (nameDisplay) {
    nameDisplay.textContent = name;
  }

  if (headerAvatar) {
    headerAvatar.textContent = getInitials(name);
  }

  if (greetingName) {
    greetingName.textContent = firstName;
  }

  if (initials) {
    initials.textContent = getInitials(name);
  }
}

function renderAssignedStudents(students, faculties, programmes) {
  studentList.replaceChildren();

  const count = students.length;
  studentCount.textContent = `${count} ${count === 1 ? 'student' : 'students'}`;

  if (count === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'summary-text';
    emptyMessage.textContent =
      'You do not have any students assigned to you yet.';
    studentList.appendChild(emptyMessage);
    return;
  }

  for (const student of students) {
    const row = document.createElement('div');
    row.className = 'student-row';

    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = getInitials(student.full_name);

    const details = document.createElement('div');

    const name = document.createElement('h3');
    name.textContent = student.full_name || 'Student';

    const academicDetails = document.createElement('p');
    const facultyName = faculties.get(String(student.faculty_id));
    const programmeName = programmes.get(String(student.programme_id));
    academicDetails.textContent = [facultyName, programmeName]
      .filter(Boolean)
      .join(' · ') || 'Faculty and programme not provided';

    details.append(name, academicDetails);
    row.append(avatar, details);

    if (student.email) {
      const emailLink = document.createElement('a');
      emailLink.href = `mailto:${student.email}`;
      emailLink.textContent = 'Email';
      row.appendChild(emailLink);
    }

    studentList.appendChild(row);
  }
}

async function loadAssignedStudents() {
  studentCount.textContent = 'Loading…';
  studentList.replaceChildren();

  const loadingMessage = document.createElement('p');
  loadingMessage.className = 'summary-text';
  loadingMessage.textContent = 'Loading your assigned students…';
  studentList.appendChild(loadingMessage);

  const { data: assignments, error: assignmentsError } = await fyeClient
    .from('mentor_assignments')
    .select('student_id')
    .eq('mentor_id', currentUser.id)
    .is('ended_at', null);

  if (assignmentsError) {
    console.error('Could not load mentor assignments:', assignmentsError);
    studentCount.textContent = '—';
    studentList.replaceChildren();

    const errorMessage = document.createElement('p');
    errorMessage.className = 'summary-text';
    errorMessage.textContent =
      'Could not load your assigned students. Please refresh the page.';
    studentList.appendChild(errorMessage);
    return;
  }

  const studentIds = [
    ...new Set((assignments || []).map((assignment) => assignment.student_id))
  ];

  if (studentIds.length === 0) {
    renderAssignedStudents([], new Map(), new Map());
    return;
  }

  const { data: students, error: studentsError } = await fyeClient
    .from('profiles')
    .select('id, full_name, email, faculty_id, programme_id')
    .in('id', studentIds)
    .eq('role', 'student')
    .order('full_name');

  if (studentsError) {
    console.error('Could not load assigned student profiles:', studentsError);
    studentCount.textContent = '—';
    studentList.replaceChildren();

    const errorMessage = document.createElement('p');
    errorMessage.className = 'summary-text';
    errorMessage.textContent =
      'Assignments were found, but the student profiles could not be loaded.';
    studentList.appendChild(errorMessage);
    return;
  }

  const facultyIds = [
    ...new Set((students || []).map((student) => student.faculty_id).filter(Boolean))
  ];
  const programmeIds = [
    ...new Set((students || []).map((student) => student.programme_id).filter(Boolean))
  ];

  const [facultyResult, programmeResult] = await Promise.all([
    facultyIds.length
      ? fyeClient.from('faculties').select('id, name').in('id', facultyIds)
      : Promise.resolve({ data: [], error: null }),
    programmeIds.length
      ? fyeClient.from('programmes').select('id, name').in('id', programmeIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (facultyResult.error) {
    console.error('Could not load student faculties:', facultyResult.error);
  }

  if (programmeResult.error) {
    console.error('Could not load student programmes:', programmeResult.error);
  }

  const faculties = new Map(
    (facultyResult.data || []).map((faculty) => [
      String(faculty.id),
      faculty.name
    ])
  );

  const programmes = new Map(
    (programmeResult.data || []).map((programme) => [
      String(programme.id),
      programme.name
    ])
  );

  renderAssignedStudents(students || [], faculties, programmes);
}

async function loadFaculties(selectedFacultyId = '') {
  facultySelect.innerHTML = '<option value="">Loading faculties…</option>';
  facultySelect.disabled = true;

  const { data: faculties, error } = await fyeClient
    .from('faculties')
    .select('id, name')
    .order('name');

  if (error) {
    console.error('Could not load faculties:', error);
    facultySelect.innerHTML =
      '<option value="">Could not load faculties</option>';
    feedback.textContent = 'Could not load the faculty list.';
    return false;
  }

  facultySelect.innerHTML =
    '<option value="">Choose your faculty</option>';

  for (const faculty of faculties ?? []) {
    const option = document.createElement('option');
    option.value = faculty.id;
    option.textContent = faculty.name;
    facultySelect.appendChild(option);
  }

  facultySelect.disabled = false;

  if (selectedFacultyId) {
    facultySelect.value = String(selectedFacultyId);
  }

  return true;
}

async function loadProgrammes(facultyId, selectedProgrammeId = '') {
  programmeSelect.innerHTML =
    '<option value="">Loading programmes…</option>';
  programmeSelect.disabled = true;

  if (!facultyId) {
    programmeSelect.innerHTML =
      '<option value="">Choose a faculty first</option>';
    return false;
  }

  const { data: programmes, error } = await fyeClient
    .from('programmes')
    .select('id, name')
    .eq('faculty_id', facultyId)
    .order('name');

  if (error) {
    console.error('Could not load programmes:', error);
    programmeSelect.innerHTML =
      '<option value="">Could not load programmes</option>';
    feedback.textContent = 'Could not load programmes for that faculty.';
    return false;
  }

  programmeSelect.innerHTML =
    '<option value="">Choose your programme</option>';

  for (const programme of programmes ?? []) {
    const option = document.createElement('option');
    option.value = programme.id;
    option.textContent = programme.name;
    programmeSelect.appendChild(option);
  }

  programmeSelect.disabled = false;

  if (selectedProgrammeId) {
    programmeSelect.value = String(selectedProgrammeId);
  }

  if (!programmes?.length) {
    feedback.textContent =
      'No programmes are listed for this faculty yet.';
  }

  return true;
}

facultySelect.addEventListener('change', async () => {
  feedback.textContent = '';
  await loadProgrammes(facultySelect.value);
});

async function loadProfile() {
  if (!fyeClient) {
    feedback.textContent =
      'Supabase did not load. Check supabase-config.js and refresh.';
    return;
  }

  const { data: authData, error: authError } = await fyeClient.auth.getUser();

  if (authError || !authData.user) {
    window.location.href = 'index.html';
    return;
  }

  currentUser = authData.user;

  const { data: profile, error: profileError } = await fyeClient
    .from('profiles')
    .select(
      'full_name, role, faculty_id, programme_id, bio, avatar_path, whatsapp_group_link'
    )
    .eq('id', currentUser.id)
    .single();

  if (profileError || !profile) {
    console.error('Could not load mentor profile:', profileError);
    feedback.textContent =
      'Could not load your profile. Check your Supabase profile policies.';
    return;
  }

  if (profile.role !== 'mentor') {
    feedback.textContent = 'This account does not have the Mentor role.';
    return;
  }

  currentProfile = profile;
  updateMentorName(profile.full_name);

  document.querySelector('#profile-name').value = profile.full_name || '';
  document.querySelector('#profile-intro').value = profile.bio || '';
  document.querySelector('#whatsapp-link').value =
    profile.whatsapp_group_link || '';

  const facultiesLoaded = await loadFaculties(profile.faculty_id);

  if (facultiesLoaded && profile.faculty_id) {
    await loadProgrammes(profile.faculty_id, profile.programme_id);
  }

  if (profile.avatar_path) {
    const { data: photoData, error: photoError } = await fyeClient.storage
      .from('mentor-photos')
      .createSignedUrl(profile.avatar_path, 3600);

    if (!photoError && photoData?.signedUrl) {
      showPhoto(photoData.signedUrl);
    }
  }

  await loadAssignedStudents();
}

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];

  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    feedback.textContent = 'Please choose an image smaller than 2 MB.';
    photoInput.value = '';
    return;
  }

  showPhoto(URL.createObjectURL(file));
  feedback.textContent = '';
});

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  feedback.textContent = '';

  if (!currentUser || !currentProfile) {
    feedback.textContent =
      'Your profile has not loaded yet. Refresh and try again.';
    return;
  }

  const name = document.querySelector('#profile-name').value.trim();
  const facultyId = facultySelect.value;
  const programmeId = programmeSelect.value;
  const intro = document.querySelector('#profile-intro').value.trim();
  const whatsappLink = document.querySelector('#whatsapp-link').value.trim();
  const file = photoInput.files[0];
  const saveButton = profileForm.querySelector('button[type="submit"]');

  if (!facultyId || !programmeId) {
    feedback.textContent = 'Please choose both your faculty and programme.';
    return;
  }

  if (
    whatsappLink &&
    !whatsappLink.startsWith('https://chat.whatsapp.com/')
  ) {
    feedback.textContent =
      'Use a WhatsApp group invite link beginning with https://chat.whatsapp.com/';
    return;
  }

  feedback.textContent = 'Saving profile…';
  saveButton.disabled = true;

  try {
    let avatarPath = currentProfile.avatar_path;

    if (file) {
      const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      avatarPath = `${currentUser.id}/${Date.now()}_${safeFileName}`;

      const { error: uploadError } = await fyeClient.storage
        .from('mentor-photos')
        .upload(avatarPath, file, {
          upsert: false,
          contentType: file.type
        });

      if (uploadError) {
        feedback.textContent =
          `Photo upload failed: ${uploadError.message}`;
        return;
      }
    }

    const { data: savedProfile, error: saveError } = await fyeClient
      .from('profiles')
      .update({
        full_name: name,
        faculty_id: Number(facultyId),
        programme_id: Number(programmeId),
        bio: intro || null,
        avatar_path: avatarPath || null,
        whatsapp_group_link: whatsappLink || null
      })
      .eq('id', currentUser.id)
      .select('full_name, faculty_id, programme_id')
      .single();

    if (saveError) {
      feedback.textContent = `Profile save failed: ${saveError.message}`;
      return;
    }

    currentProfile = {
      ...currentProfile,
      full_name: name,
      faculty_id: Number(facultyId),
      programme_id: Number(programmeId),
      bio: intro,
      avatar_path: avatarPath,
      whatsapp_group_link: whatsappLink
    };

    updateMentorName(name);

    if (avatarPath) {
      const { data: photoData } = await fyeClient.storage
        .from('mentor-photos')
        .createSignedUrl(avatarPath, 3600);

      if (photoData?.signedUrl) {
        showPhoto(photoData.signedUrl);
      }
    }

    photoInput.value = '';
    feedback.textContent = `Profile saved: ${savedProfile.full_name}`;
  } catch (error) {
    console.error('Profile save error:', error);
    feedback.textContent =
      'Something went wrong while saving your profile.';
  } finally {
    saveButton.disabled = false;
  }
});

loadProfile();