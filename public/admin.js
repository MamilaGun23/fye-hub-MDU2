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

      cell.colSpan = 7;
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

      const isActive = profile.is_active !== false;
      addCell(row, isActive ? 'Active' : 'Disabled');

      const actionCell = document.createElement('td');
      if (['student', 'mentor'].includes(profile.role)) {
        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.className = isActive ? 'admin-account-disable' : 'admin-account-enable';
        actionButton.textContent = isActive ? 'Disable' : 'Reactivate';
        actionButton.addEventListener('click', async () => {
          const nextState = !isActive;
          const actionLabel = nextState ? 'reactivate' : 'disable';
          if (!window.confirm(`Are you sure you want to ${actionLabel} ${profile.full_name || profile.email}?`)) return;

          actionButton.disabled = true;
          userFeedback.textContent = `${nextState ? 'Reactivating' : 'Disabling'} account…`;
          const { error } = await db.rpc('set_profile_active', {
            p_profile_id: profile.id,
            p_is_active: nextState
          });

          if (error) {
            console.error('Could not update account status:', error);
            userFeedback.textContent = `Could not update account status: ${error.message}`;
            actionButton.disabled = false;
            return;
          }

          profile.is_active = nextState;
          userFeedback.textContent = `${profile.full_name || profile.email} ${nextState ? 'reactivated' : 'disabled'}.`;
          renderProfiles();
          await loadAnalytics();
        });
        actionCell.appendChild(actionButton);
      } else {
        actionCell.textContent = 'Staff account';
      }
      row.appendChild(actionCell);

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

  function renderEventChart(monthlyEvents, periodValue) {
    const chart = document.querySelector('#analytics-event-chart');
    chart.replaceChildren();

    const now = new Date();
    const months = [];
    const monthCount = periodValue === 'all'
      ? 12
      : Math.max(1, Math.ceil(Number(periodValue) / 30));
    for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
      months.push(new Date(now.getFullYear(), now.getMonth() - offset, 1));
    }

    const countsByMonth = new Map(months.map((month) => [
      `${month.getFullYear()}-${month.getMonth()}`,
      0
    ]));
    for (const eventMonth of monthlyEvents) {
      const date = new Date(eventMonth.month);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      if (countsByMonth.has(key)) countsByMonth.set(key, Number(eventMonth.count) || 0);
    }

    const maxCount = Math.max(1, ...countsByMonth.values());
    for (const [key, count] of countsByMonth) {
      const [year, month] = key.split('-').map(Number);
      const column = document.createElement('div');
      column.className = 'admin-event-chart-column';
      column.setAttribute('aria-label', `${count} events in ${new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(year, month, 1))}`);
      const value = document.createElement('span');
      value.className = 'admin-event-chart-value';
      value.textContent = String(count);
      const track = document.createElement('div');
      track.className = 'admin-event-chart-track';
      const bar = document.createElement('span');
      bar.className = 'admin-event-chart-bar';
      bar.style.height = `${Math.max(5, (count / maxCount) * 100)}%`;
      track.appendChild(bar);
      const label = document.createElement('small');
      label.textContent = new Intl.DateTimeFormat('en', { month: 'short' })
        .format(new Date(year, month, 1));
      column.append(value, track, label);
      chart.appendChild(column);
    }
  }

  async function loadAnalytics() {
    const feedback = document.querySelector('#analytics-feedback');
    feedback.textContent = 'Loading platform analytics…';
    const period = document.querySelector('#analytics-period').value;
    const { data: analytics, error } = await db.rpc('get_admin_analytics', {
      p_period_days: period === 'all' ? 0 : Number(period)
    });

    if (error || !analytics) {
      console.error('Could not load analytics:', error);
      feedback.textContent = error
        ? `Could not load analytics: ${error.message}`
        : 'Analytics are unavailable right now.';
      return;
    }

    document.querySelector('#analytics-students').textContent = String(analytics.active_students || 0);
    document.querySelector('#analytics-mentors').textContent = String(analytics.active_mentors || 0);
    document.querySelector('#analytics-events').textContent = String(analytics.events_in_period || 0);
    document.querySelector('#analytics-upcoming').textContent = String(analytics.upcoming_events || 0);
    document.querySelector('#analytics-assignments').textContent = String(analytics.active_assignments || 0);
    document.querySelector('#analytics-disabled').textContent = String(analytics.disabled_profiles || 0);
    document.querySelector('#analytics-notices').textContent = String(analytics.active_notices || 0);
    document.querySelector('#analytics-event-total').textContent = `${analytics.events_in_period || 0} events in selected period`;
    renderEventChart(analytics.events_by_month || [], period);
    feedback.textContent = '';
  }

  async function loadDashboardData() {
    userFeedback.textContent = 'Loading profiles…';
    userList.innerHTML =
      '<tr><td colspan="7">Loading profiles…</td></tr>';

    const [profileResult, facultyResult, programmeResult] =
      await Promise.all([
        db
          .from('profiles')
          .select('id, email, full_name, role, faculty_id, programme_id, is_active')
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
        '<tr><td colspan="7">Profile list unavailable.</td></tr>';
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
      .select('full_name, role, is_active')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (profileError || !profile || profile.role !== 'admin' || profile.is_active === false) {
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
    await loadAnalytics();
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

  document.querySelector('#analytics-period').addEventListener('change', loadAnalytics);
  document.querySelector('#analytics-refresh').addEventListener('click', async () => {
    await loadDashboardData();
    await loadAnalytics();
  });

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