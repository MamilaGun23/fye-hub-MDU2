const loginDialog = document.querySelector('.login-dialog');
const roleName = document.querySelector('#selected-role');
const dialogTitle = document.querySelector('#dialog-title');
const loginForm = document.querySelector('#login-form');
const signupForm = document.querySelector('#signup-form');
const message = document.querySelector('.form-message');
const signupPrompt = document.querySelector('#signup-prompt');
const signinPrompt = document.querySelector('#signin-prompt');
const studentSignupFields = document.querySelector('#student-signup-fields');
const facultySelect = document.querySelector('#signup-faculty');
const programmeSelect = document.querySelector('#signup-programme');

const loginButton = loginForm.querySelector('button[type="submit"]');
const signupButton = document.querySelector('#signup-button');

const dashboardPages = {
  student: 'student.html',
  mentor: 'mentor.html',
  supervisor: 'supervisor.html',
  admin: 'admin.html'
};

function selectedRole() {
  return roleName.textContent.trim().toLowerCase();
}

function showLoginView() {
  dialogTitle.textContent = 'Sign in';
  loginForm.style.display = 'grid';
  signupForm.style.display = 'none';

  const role = selectedRole();
  signupPrompt.style.display = role === 'student' ? 'block' : 'none';
  document.querySelector('#mentor-signin-help').style.display =
    role === 'mentor' ? 'block' : 'none';

  signinPrompt.style.display = 'none';
  message.textContent = '';
  document.querySelector('#email').focus();
}

function showSignupView() {
  const role = selectedRole();
  if (role !== 'student') return;

  dialogTitle.textContent = 'Create student account';

  loginForm.style.display = 'none';
  signupForm.style.display = 'grid';
  signupPrompt.style.display = 'none';
  signinPrompt.style.display = 'block';
  studentSignupFields.hidden = false;

  document.querySelector('#signup-name').required = true;
  facultySelect.required = true;
  programmeSelect.required = true;
  signupButton.innerHTML = 'Create student account <span aria-hidden="true">→</span>';

  message.textContent = '';

  document.querySelector('#signup-name').focus();
  loadFaculties();
}

document.querySelectorAll('.role-card').forEach((card) => {
  card.addEventListener('click', () => {
    roleName.textContent = card.dataset.role;
    loginForm.reset();
    signupForm.reset();

    studentSignupFields.hidden = false;
    document.querySelector('#signup-name').required = true;
    facultySelect.required = true;
    programmeSelect.required = true;

    facultySelect.innerHTML = '<option value="">Choose your faculty</option>';
    programmeSelect.innerHTML =
      '<option value="">Choose a faculty first</option>';
    programmeSelect.disabled = true;

    showLoginView();
    loginDialog.showModal();
  });
});

document.querySelector('.close-button').addEventListener('click', () => {
  loginDialog.close();
});

loginDialog.addEventListener('click', (event) => {
  if (event.target === loginDialog) {
    loginDialog.close();
  }
});

document.querySelector('#show-signup').addEventListener('click', showSignupView);
document.querySelector('#show-signin').addEventListener('click', showLoginView);

async function loadFaculties() {
  if (!window.fyeSupabase) {
    message.textContent =
      'Supabase did not load. Check supabase-config.js and refresh.';
    return;
  }

  facultySelect.innerHTML = '<option value="">Loading faculties…</option>';
  facultySelect.disabled = true;
  programmeSelect.innerHTML =
    '<option value="">Choose a faculty first</option>';
  programmeSelect.disabled = true;

  const { data: faculties, error } = await window.fyeSupabase
    .from('faculties')
    .select('id, name')
    .order('name');

  if (error) {
    console.error('Could not load faculties:', error);
    facultySelect.innerHTML =
      '<option value="">Could not load faculties</option>';
    message.textContent =
      'Could not load faculties. Please refresh and try again.';
    return;
  }

  facultySelect.innerHTML = '<option value="">Choose your faculty</option>';

  for (const faculty of faculties ?? []) {
    const option = document.createElement('option');
    option.value = faculty.id;
    option.textContent = faculty.name;
    facultySelect.appendChild(option);
  }

  facultySelect.disabled = false;
}

facultySelect.addEventListener('change', async () => {
  const facultyId = facultySelect.value;

  programmeSelect.innerHTML =
    '<option value="">Loading programmes…</option>';
  programmeSelect.disabled = true;
  message.textContent = '';

  if (!facultyId) {
    programmeSelect.innerHTML =
      '<option value="">Choose a faculty first</option>';
    return;
  }

  const { data: programmes, error } = await window.fyeSupabase
    .from('programmes')
    .select('id, name')
    .eq('faculty_id', facultyId)
    .order('name');

  if (error) {
    console.error('Could not load programmes:', error);
    programmeSelect.innerHTML =
      '<option value="">Could not load programmes</option>';
    message.textContent = 'Could not load programmes for that faculty.';
    return;
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

  if (!programmes?.length) {
    message.textContent = 'No programmes are listed for this faculty yet.';
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';

  if (!window.fyeSupabase) {
    message.textContent =
      'Supabase did not load. Check supabase-config.js and refresh.';
    return;
  }

  const email = document.querySelector('#email').value.trim();
  const password = document.querySelector('#password').value;
  const role = selectedRole();

  loginButton.disabled = true;
  loginButton.textContent = 'Signing in…';

  try {
    const { data: signInData, error: signInError } =
      await window.fyeSupabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      message.textContent = 'Sign-in failed. Check your email and password.';
      return;
    }

    const { data: profile, error: profileError } = await window.fyeSupabase
      .from('profiles')
      .select('role, mentor_approval_status, is_active')
      .eq('id', signInData.user.id)
      .single();

    if (profileError || !profile) {
      await window.fyeSupabase.auth.signOut();
      message.textContent = 'We could not find a profile for this account.';
      return;
    }

    if (profile.is_active === false) {
      await window.fyeSupabase.auth.signOut();
      message.textContent = 'This account is disabled. Contact your FYE administrator for assistance.';
      return;
    }

    if (role === 'mentor') {
      if (profile.role === 'mentor' && profile.mentor_approval_status === 'approved') {
        window.location.replace(dashboardPages.mentor);
        return;
      }

      if (profile.role === 'student' || profile.role === 'mentor') {
        const { data: application, error: applicationError } = await window.fyeSupabase
          .from('mentor_applications')
          .select('status')
          .eq('applicant_id', signInData.user.id)
          .maybeSingle();

        if (applicationError) {
          if (profile.role === 'mentor') {
            window.location.replace(dashboardPages.student);
            return;
          }
          await window.fyeSupabase.auth.signOut();
          message.textContent = 'Mentor application access is not available yet. Please contact your FYE coordinator.';
          return;
        }

        window.location.replace(application?.status === 'approved'
          || profile.mentor_approval_status === 'approved'
          ? dashboardPages.mentor
          : dashboardPages.student);
        return;
      }
    }

    if (role === 'student' && profile.role === 'mentor') {
      window.location.replace(dashboardPages.student);
      return;
    }

    if (profile.role !== role) {
      await window.fyeSupabase.auth.signOut();
      message.textContent =
        `This account is registered as ${profile.role}. Choose that role and try again.`;
      return;
    }

    window.location.replace(dashboardPages[profile.role]);
  } catch (error) {
    console.error('Sign-in error:', error);
    message.textContent =
      'Something went wrong while signing in. Please try again.';
  } finally {
    loginButton.disabled = false;
    loginButton.innerHTML = 'Sign in <span aria-hidden="true">→</span>';
  }
});

signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';

  if (!window.fyeSupabase) {
    message.textContent =
      'Supabase did not load. Check supabase-config.js and refresh.';
    return;
  }

  const role = selectedRole();

  if (role !== 'student') {
    message.textContent = 'Create a student account first, then apply to become a mentor from your dashboard.';
    return;
  }

  const email = document.querySelector('#signup-email').value.trim();
  const password = document.querySelector('#signup-password').value;

  const metadata = {
    role: 'student',
    full_name: document.querySelector('#signup-name').value.trim()
  };

  const facultyId = facultySelect.value;
  const programmeId = programmeSelect.value;

  if (!facultyId || !programmeId) {
    message.textContent = 'Please choose both your faculty and programme.';
    return;
  }

  metadata.faculty_id = Number(facultyId);
  metadata.programme_id = Number(programmeId);

  signupButton.disabled = true;
  signupButton.textContent = 'Creating account…';

  try {
    const { data, error } = await window.fyeSupabase.auth.signUp({
      email,
      password,
      options: { data: metadata }
    });

    if (error) {
      console.error('Account registration error:', error);
      message.textContent = `Could not create account: ${error.message}`;
      return;
    }

    if (data.session) {
      window.location.replace(dashboardPages[role]);
      return;
    }

    message.textContent =
      'Account created. Check your email to confirm it, then return here to sign in.';

    signupForm.reset();
    programmeSelect.innerHTML =
      '<option value="">Choose a faculty first</option>';
    programmeSelect.disabled = true;
  } catch (error) {
    console.error('Account registration error:', error);
    message.textContent =
      'Something went wrong while creating your account.';
  } finally {
    signupButton.disabled = false;
    signupButton.innerHTML = 'Create student account <span aria-hidden="true">→</span>';
  }
});