(() => {
  const db = window.fyeSupabase;
  const navLinks = document.querySelectorAll('.nav-link[data-view]');
  const pages = document.querySelectorAll('.page-view');
  const userList = document.querySelector('#user-list');
  const userFeedback = document.querySelector('#user-feedback');
  const searchInput = document.querySelector('#user-search');
  const roleFilter = document.querySelector('#user-role-filter');
  const facultyFilter = document.querySelector('#user-faculty-filter');
  const programmeFilter = document.querySelector('#user-programme-filter');

  let profiles = [];
  let faculties = [];
  let programmes = [];
  let facultyNames = new Map();
  let programmeNames = new Map();

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

  document
    .querySelector('#admin-signout')
    ?.addEventListener('click', async (event) => {
      event.preventDefault();

      if (db) {
        await db.auth.signOut();
      }

      window.location.href = 'index.html';
    });

  function addCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.appendChild(cell);
  }

  function renderProfiles() {
    const search = searchInput.value.trim().toLowerCase();
    const role = roleFilter.value;
    const facultyId = facultyFilter.value;
    const programmeId = programmeFilter.value;

    const visibleProfiles = profiles.filter((profile) => {
      const name = (profile.full_name || '').toLowerCase();
      const email = (profile.email || '').toLowerCase();

      return (
        (!search || name.includes(search) || email.includes(search)) &&
        (!role || profile.role === role) &&
        (!facultyId || String(profile.faculty_id || '') === facultyId) &&
        (!programmeId || String(profile.programme_id || '') === programmeId)
      );
    });

    userList.replaceChildren();

    document.querySelector('#user-results-count').textContent =
      `${visibleProfiles.length} profile${visibleProfiles.length === 1 ? '' : 's'} shown`;

    if (visibleProfiles.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');

      cell.colSpan = 5;
      cell.textContent = profiles.length
        ? 'No profiles match these filters.'
        : 'No profiles were found.';

      row.appendChild(cell);
      userList.appendChild(row);
      return;
    }

    for (const profile of visibleProfiles) {
      const row = document.createElement('tr');
      const displayRole = profile.role
        ? profile.role[0].toUpperCase() + profile.role.slice(1)
        : 'Unassigned';

      addCell(row, profile.full_name || 'Name not provided');
      addCell(row, profile.email || 'No email on profile');
      addCell(row, displayRole);
      addCell(
        row,
        facultyNames.get(String(profile.faculty_id)) || 'Not selected'
      );
      addCell(
        row,
        programmeNames.get(String(profile.programme_id)) || 'Not selected'
      );

      userList.appendChild(row);
    }
  }

  function updateProgrammeFilter() {
    const facultyId = facultyFilter.value;

    programmeFilter.replaceChildren();

    const firstOption = document.createElement('option');
    firstOption.value = '';
    firstOption.textContent = facultyId
      ? 'All programmes'
      : 'Choose a faculty first';

    programmeFilter.appendChild(firstOption);
    programmeFilter.disabled = !facultyId;

    if (!facultyId) return;

    const facultyProgrammes = programmes.filter(
      (programme) => String(programme.faculty_id) === facultyId
    );

    for (const programme of facultyProgrammes) {
      const option = document.createElement('option');
      option.value = String(programme.id);
      option.textContent = programme.name;
      programmeFilter.appendChild(option);
    }
  }

  function renderAcademicLists() {
    const facultyList = document.querySelector('#admin-faculty-list');
    const programmeList = document.querySelector('#admin-programme-list');

    facultyList.replaceChildren();
    programmeList.replaceChildren();

    if (faculties.length === 0) {
      const item = document.createElement('li');
      item.textContent = 'No faculties found.';
      facultyList.appendChild(item);
    } else {
      for (const faculty of faculties) {
        const item = document.createElement('li');
        item.textContent = faculty.name;
        facultyList.appendChild(item);
      }
    }

    if (programmes.length === 0) {
      const item = document.createElement('li');
      item.textContent = 'No programmes found.';
      programmeList.appendChild(item);
    } else {
      for (const programme of programmes) {
        const item = document.createElement('li');
        const facultyName =
          facultyNames.get(String(programme.faculty_id)) ||
          'Faculty not found';

        item.textContent = `${programme.name} · ${facultyName}`;
        programmeList.appendChild(item);
      }
    }

    document.querySelector('#admin-academic-summary').textContent =
      `${faculties.length} faculties · ${programmes.length} programmes`;
  }

  function renderOverviewCounts() {
    document.querySelector('#admin-total-users').textContent =
      `${profiles.length} profile${profiles.length === 1 ? '' : 's'}`;

    const counts = profiles.reduce((result, profile) => {
      const role = (profile.role || 'unassigned').toLowerCase();
      result[role] = (result[role] || 0) + 1;
      return result;
    }, {});

    document.querySelector('#admin-role-counts').textContent =
      `${counts.student || 0} students · ` +
      `${counts.mentor || 0} mentors · ` +
      `${counts.supervisor || 0} supervisors · ` +
      `${counts.admin || 0} admins`;
  }

  async function loadDashboardData() {
    userFeedback.textContent = 'Loading profiles…';
    userList.innerHTML =
      '<tr><td colspan="5">Loading profiles…</td></tr>';

    const [profileResult, facultyResult, programmeResult] =
      await Promise.all([
        db
          .from('profiles')
          .select('id, email, full_name, role, faculty_id, programme_id')
          .order('full_name')
          .range(0, 1999),

        db
          .from('faculties')
          .select('id, name')
          .order('name'),

        db
          .from('programmes')
          .select('id, name, faculty_id')
          .order('name')
      ]);

    if (profileResult.error) {
      console.error('Could not load profiles:', profileResult.error);
      userFeedback.textContent =
        `Could not load profiles: ${profileResult.error.message}`;
      userList.innerHTML =
        '<tr><td colspan="5">Profile list unavailable.</td></tr>';
      return;
    }

    if (facultyResult.error || programmeResult.error) {
      const error = facultyResult.error || programmeResult.error;

      console.error('Could not load academic lists:', error);
      document.querySelector('#academic-feedback').textContent =
        `Could not load the academic lists: ${error.message}`;
    }

    profiles = profileResult.data || [];
    faculties = facultyResult.data || [];
    programmes = programmeResult.data || [];

    facultyNames = new Map(
      faculties.map((item) => [String(item.id), item.name])
    );

    programmeNames = new Map(
      programmes.map((item) => [String(item.id), item.name])
    );

    facultyFilter.replaceChildren();

    const allFaculties = document.createElement('option');
    allFaculties.value = '';
    allFaculties.textContent = 'All faculties';
    facultyFilter.appendChild(allFaculties);

    for (const faculty of faculties) {
      const option = document.createElement('option');
      option.value = String(faculty.id);
      option.textContent = faculty.name;
      facultyFilter.appendChild(option);
    }

    updateProgrammeFilter();
    renderAcademicLists();
    renderOverviewCounts();
    renderProfiles();

    if (!userFeedback.textContent.startsWith('Could not')) {
      userFeedback.textContent = '';
    }
  }

  async function init() {
    if (!db) {
      userFeedback.textContent =
        'Supabase did not load. Check supabase-config.js and refresh.';
      return;
    }

    const { data: authData, error: authError } = await db.auth.getUser();

    if (authError || !authData.user) {
      window.location.href = 'index.html';
      return;
    }

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('full_name, role')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (profileError || !profile || profile.role !== 'admin') {
      document.querySelector('#admin-profile-name').textContent =
        'Access not available';

      userFeedback.textContent = profileError
        ? `Could not verify your admin profile: ${profileError.message}`
        : 'This account does not have the Admin role.';

      return;
    }

    const fullName =
      profile.full_name || authData.user.email || 'Admin';

    document.querySelector('#admin-profile-name').textContent = fullName;
    document.querySelector('#admin-welcome-name').textContent =
      fullName.split(' ')[0];

    document.querySelector('#admin-avatar').textContent =
      fullName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('') || 'A';

    await loadDashboardData();
  }

  searchInput.addEventListener('input', renderProfiles);
  roleFilter.addEventListener('change', renderProfiles);

  facultyFilter.addEventListener('change', () => {
    updateProgrammeFilter();
    renderProfiles();
  });

  programmeFilter.addEventListener('change', renderProfiles);

  document
    .querySelector('#users-refresh')
    .addEventListener('click', loadDashboardData);

  const style = document.createElement('style');
  style.textContent = `
    .admin-filter-grid {
      display: grid;
      grid-template-columns: minmax(150px, 1fr) minmax(180px, 2fr);
      gap: 12px 16px;
      align-items: center;
      margin-top: 16px;
    }

    .admin-filter-grid label {
      font-weight: 600;
      color: #405a77;
    }

    .admin-filter-grid input,
    .admin-filter-grid select {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
    }

    #users-refresh {
      align-self: center;
    }

    @media (max-width: 640px) {
      .admin-filter-grid {
        grid-template-columns: 1fr;
        gap: 8px;
      }

      .admin-filter-grid label:not(:first-child) {
        margin-top: 8px;
      }
    }
  `;

  document.head.appendChild(style);

  init();
})();