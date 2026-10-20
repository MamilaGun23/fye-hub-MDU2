(async () => {
  const account = window.fyeAuth ? await window.fyeAuth.ready : null;
  if (window.fyeAuth && !account) return;
  const db = window.fyeSupabase;
  const navLinks = document.querySelectorAll('.nav-link[data-view]');
  const pages = document.querySelectorAll('.page-view');
  const userList = document.querySelector('#user-list');
  const userFeedback = document.querySelector('#user-feedback');
  const searchInput = document.querySelector('#user-search');
  const roleFilter = document.querySelector('#user-role-filter');
  const facultyFilter = document.querySelector('#user-faculty-filter');
  const programmeFilter = document.querySelector('#user-programme-filter');
  const statusFilter = document.querySelector('#user-status-filter');
  const mentorEditDialog = document.querySelector('#mentor-edit-dialog');
  const mentorEditForm = document.querySelector('#mentor-edit-form');
  const mentorEditFeedback = document.querySelector('#mentor-edit-feedback');
  const editMentorFaculty = document.querySelector('#edit-mentor-faculty');
  const editMentorProgramme = document.querySelector('#edit-mentor-programme');

  let profiles = [];
  let faculties = [];
  let programmes = [];
  let facultyNames = new Map();
  let programmeNames = new Map();
  let editingMentor = null;
  let selectedAnalyticsFaculty = '';
  let userPage = 1;
  let userPageSize = 25;

  function loadEditProgrammes(facultyId, selectedProgrammeId = '') {
    editMentorProgramme.replaceChildren(new Option('Choose a programme', ''));
    for (const programme of programmes.filter((item) => String(item.faculty_id) === String(facultyId))) {
      editMentorProgramme.add(new Option(programme.name, String(programme.id)));
    }
    editMentorProgramme.disabled = !facultyId;
    editMentorProgramme.value = String(selectedProgrammeId || '');
  }

  function openMentorEditor(profile) {
    editingMentor = profile;
    const parts = (profile.full_name || '').trim().split(/\s+/);
    document.querySelector('#edit-mentor-first-name').value = profile.first_name || parts.shift() || '';
    document.querySelector('#edit-mentor-last-name').value = profile.last_name || parts.join(' ');
    document.querySelector('#edit-mentor-school').value = profile.school || '';
    document.querySelector('#edit-mentor-bio').value = profile.bio || '';
    editMentorFaculty.replaceChildren(new Option('Choose a faculty', ''));
    for (const faculty of faculties) editMentorFaculty.add(new Option(faculty.name, String(faculty.id)));
    editMentorFaculty.value = String(profile.faculty_id || '');
    loadEditProgrammes(editMentorFaculty.value, profile.programme_id);
    mentorEditFeedback.textContent = '';
    mentorEditDialog.showModal();
  }

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
    const visibleProfiles = profiles.filter(profile => window.fyeDirectory.matches(profile, {
      search: searchInput.value, role: roleFilter.value, facultyId: facultyFilter.value,
      programmeId: programmeFilter.value, status: statusFilter.value
    }));
    userPage = Math.min(userPage, Math.max(1, Math.ceil(visibleProfiles.length / userPageSize)));
    const start = (userPage - 1) * userPageSize;

    userList.replaceChildren();

    document.querySelector('#user-results-count').textContent =
      `Showing ${visibleProfiles.length ? start + 1 : 0}–${Math.min(start + userPageSize, visibleProfiles.length)} of ${visibleProfiles.length} profiles`;
    renderUserPagination(visibleProfiles.length);

    if (visibleProfiles.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');

      cell.colSpan = 8;
      cell.textContent = profiles.length
        ? 'No profiles match these filters.'
        : 'No profiles were found.';

      row.appendChild(cell);
      userList.appendChild(row);
      return;
    }

    for (const profile of visibleProfiles.slice(start, start + userPageSize)) {
      const row = document.createElement('tr');
      row.dataset.profileId = profile.id;
      const displayRole = profile.role
        ? profile.role[0].toUpperCase() + profile.role.slice(1)
        : 'Unassigned';

      const nameCell = document.createElement('td');
      const account = document.createElement('button');
      account.type = 'button'; account.className = 'text-button';
      account.textContent = profile.full_name || 'Name not provided';
      account.addEventListener('click', () => window.fyeAdminDetails?.openProfile(profile.id));
      nameCell.appendChild(account); row.appendChild(nameCell);
      addCell(row, profile.student_number || 'Not applicable');
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
      actionCell.className = 'admin-account-actions';
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
          renderFacultyBreakdown();
          await loadAnalytics();
        });
        actionCell.appendChild(actionButton);
      } else {
        actionCell.textContent = 'Staff account';
      }
      if (profile.role === 'mentor') {
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'admin-account-edit';
        editButton.textContent = 'Edit';
        editButton.addEventListener('click', () => openMentorEditor(profile));
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'admin-account-delete';
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', async () => {
          const name = profile.full_name || profile.email || 'this mentor';
          if (!window.confirm(`Permanently delete ${name}'s mentor account? Active student assignments must be reassigned first. This cannot be undone.`)) return;
          deleteButton.disabled = true;
          userFeedback.textContent = `Deleting ${name}…`;
          const { error } = await db.rpc('admin_delete_mentor_account', {
            p_mentor_id: profile.id
          });
          if (error) {
            console.error('Could not delete mentor account:', error);
            userFeedback.textContent = `Could not delete mentor account: ${error.message}`;
            deleteButton.disabled = false;
            return;
          }
          profiles = profiles.filter((item) => item.id !== profile.id);
          userFeedback.textContent = `${name}'s mentor account was deleted.`;
          renderProfiles();
          renderFacultyBreakdown();
          await loadAnalytics();
        });
        actionCell.append(editButton, deleteButton);
      }
      row.appendChild(actionCell);

      userList.appendChild(row);
    }
  }

  function renderUserPagination(total) {
    const pagination = document.querySelector('#user-pagination');
    const pages = Math.max(1, Math.ceil(total / userPageSize));
    const info = document.createElement('span'); info.textContent = `Page ${userPage} of ${pages}`;
    const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = 'Prev';
    previous.setAttribute('aria-label', 'Previous page of accounts'); previous.disabled = userPage <= 1;
    previous.addEventListener('click', () => { userPage--; renderProfiles(); });
    const next = document.createElement('button'); next.type = 'button'; next.textContent = 'Next';
    next.setAttribute('aria-label', 'Next page of accounts'); next.disabled = userPage >= pages;
    next.addEventListener('click', () => { userPage++; renderProfiles(); });
    const size = document.createElement('select'); size.setAttribute('aria-label', 'Accounts per page');
    for (const count of [25,50,100]) size.add(new Option(`${count} per page`, String(count)));
    size.value = String(userPageSize);
    size.addEventListener('change', () => { userPageSize = Number(size.value); userPage = 1; renderProfiles(); });
    pagination.replaceChildren(info, previous, next, size);
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

    for (const [id,key] of Object.entries({'analytics-eligible':'eligible_mentees','analytics-unassigned':'unassigned_mentees','analytics-awaiting':'awaiting_results'})) document.querySelector('#'+id).textContent=String(analytics[key]||0);
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

  function renderFacultyBreakdown() {
    const tabsContainer = document.querySelector('#analytics-faculty-tabs');
    const detailContainer = document.querySelector('#analytics-faculty-detail');
    if (!tabsContainer || !detailContainer) return;

    tabsContainer.replaceChildren();
    detailContainer.replaceChildren();

    if (faculties.length === 0) {
      detailContainer.innerHTML = '<p class="summary-text">No faculties available.</p>';
      return;
    }

    function showFacultyDetail(faculty, activeTab) {
      selectedAnalyticsFaculty = faculty ? String(faculty.id) : '';
      tabsContainer.querySelectorAll('.faculty-tab').forEach((tab) => {
        const active = tab === activeTab;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      detailContainer.setAttribute('aria-labelledby', activeTab.id);
      detailContainer.replaceChildren();

      const relevantProgrammes = faculty
        ? programmes.filter((p) => String(p.faculty_id) === String(faculty.id))
        : programmes;

      const relevantProfiles = faculty
        ? profiles.filter((p) => String(p.faculty_id) === String(faculty.id))
        : profiles;

      const students = relevantProfiles.filter((p) => p.role === 'student' && p.is_active !== false);
      const mentors = relevantProfiles.filter((p) => p.role === 'mentor' && p.is_active !== false && p.mentor_available!==false);
      const disabled = relevantProfiles.filter((p) => ['student','mentor'].includes(p.role) && p.is_active === false);

      const summaryGrid = document.createElement('div');
      summaryGrid.className = 'analytics-faculty-summary';

      const stats = [
        { value: students.length, label: 'Students' },
        { value: mentors.length, label: 'Mentors' },
        { value: relevantProgrammes.length, label: 'Programmes' },
        { value: disabled.length, label: 'Disabled' }
      ];

      for (const stat of stats) {
        const cell = document.createElement('div');
        cell.className = 'faculty-stat';
        const strong = document.createElement('strong');
        strong.textContent = String(stat.value);
        const span = document.createElement('span');
        span.textContent = stat.label;
        cell.append(strong, span);
        summaryGrid.appendChild(cell);
      }

      detailContainer.appendChild(summaryGrid);

      if (relevantProgrammes.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'summary-text';
        empty.textContent = faculty
          ? 'No programmes under this faculty.'
          : 'No programmes found.';
        detailContainer.appendChild(empty);
        return;
      }

      const table = document.createElement('table');
      table.className = 'data-table';
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      const headers = faculty
        ? ['Programme', 'Students', 'Mentors', 'Disabled']
        : ['Programme', 'Faculty', 'Students', 'Mentors', 'Disabled'];
      for (const h of headers) {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = h;
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      for (const prog of relevantProgrammes) {
        const row = document.createElement('tr');
        const nameCell = document.createElement('td');
        nameCell.textContent = prog.name;
        row.appendChild(nameCell);
        if (!faculty) {
          const facCell = document.createElement('td');
          facCell.textContent = facultyNames.get(String(prog.faculty_id)) || '—';
          row.appendChild(facCell);
        }
        function accountDropdown(role, disabled = false) {
          const cell = document.createElement('td');
          const accounts = profiles.filter((p) => String(p.programme_id) === String(prog.id)
            && (disabled ? ['student','mentor'].includes(p.role) && p.is_active === false : p.role === role && p.is_active !== false && (role!=='mentor'||p.mentor_available!==false)));
          if (!accounts.length) { cell.textContent = '0'; return cell; }
          const details = document.createElement('details');
          details.className = 'programme-account-list';
          const summary = document.createElement('summary');
          summary.textContent = String(accounts.length);
          summary.setAttribute('aria-label', `${accounts.length} ${disabled ? 'disabled accounts' : role + ' accounts'} in ${prog.name}`);
          details.appendChild(summary);
          for (const profile of accounts) {
            const account = document.createElement('button');
            account.type='button'; account.className='text-button'; account.textContent=profile.full_name || profile.email || 'View account';
            const identity = document.createElement('small');
            identity.className = 'account-identifier'; identity.textContent = profile.student_number || profile.email || profile.id;
            account.appendChild(identity);
            account.dataset.profileId = profile.id;
            account.addEventListener('click',() => window.fyeAdminDetails?.openProfile(profile.id));
            details.appendChild(account);
          }
          cell.appendChild(details); return cell;
        }
        const sCell = accountDropdown('student');
        const mCell = accountDropdown('mentor');
        const dCell = accountDropdown(null,true);
        row.append(sCell, mCell, dCell);
        tbody.appendChild(row);
      }
      table.appendChild(tbody);

      const tableWrap = document.createElement('div');
      tableWrap.className = 'table-wrap';
      tableWrap.appendChild(table);
      detailContainer.appendChild(tableWrap);
    }

    function configureTab(tab, id) {
      tab.id = `analytics-faculty-tab-${id}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', detailContainer.id);
      tab.addEventListener('keydown', (event) => {
        const tabs = [...tabsContainer.querySelectorAll('.faculty-tab')];
        const index = tabs.indexOf(tab);
        const nextIndex = {
          ArrowRight: (index + 1) % tabs.length,
          ArrowLeft: (index - 1 + tabs.length) % tabs.length,
          Home: 0,
          End: tabs.length - 1
        }[event.key];
        if (nextIndex === undefined) return;
        event.preventDefault();
        tabs[nextIndex].click();
        tabs[nextIndex].focus();
      });
    }

    const allTab = document.createElement('button');
    configureTab(allTab, 'all');
    allTab.className = 'faculty-tab active';
    allTab.textContent = 'All faculties';
    allTab.type = 'button';
    allTab.addEventListener('click', () => showFacultyDetail(null, allTab));
    tabsContainer.appendChild(allTab);

    for (const faculty of faculties) {
      const tab = document.createElement('button');
      configureTab(tab, faculty.id);
      tab.className = 'faculty-tab';
      tab.textContent = faculty.name;
      tab.type = 'button';
      tab.addEventListener('click', () => showFacultyDetail(faculty, tab));
      tabsContainer.appendChild(tab);
    }

    const selectedFaculty = faculties.find((faculty) => String(faculty.id) === selectedAnalyticsFaculty);
    const selectedTab = selectedFaculty
      ? document.querySelector(`#analytics-faculty-tab-${selectedFaculty.id}`)
      : allTab;
    showFacultyDetail(selectedFaculty || null, selectedTab);
  }

  async function loadAllProfiles() {
    const allProfiles = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const result = await db.from('profiles')
        .select('id, email, full_name, first_name, last_name, student_number, school, bio, role, faculty_id, programme_id, is_active')
        .order('id')
        .range(offset, offset + pageSize - 1);
      if (result.error) return result;
      allProfiles.push(...(result.data || []));
      if ((result.data || []).length < pageSize) break;
    }
    allProfiles.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    return { data: window.fyeDirectory.unique(allProfiles), error: null };
  }

  async function loadDashboardData() {
    const selectedFaculty = facultyFilter.value;
    const selectedProgramme = programmeFilter.value;
    userFeedback.textContent = 'Loading profiles…';
    userList.innerHTML =
      '<tr><td colspan="8">Loading profiles…</td></tr>';

    const [profileResult, facultyResult, programmeResult] =
      await Promise.all([
        loadAllProfiles(),

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
        '<tr><td colspan="8">Profile list unavailable.</td></tr>';
      document.querySelector('#analytics-faculty-tabs').replaceChildren();
      document.querySelector('#analytics-faculty-detail').textContent =
        'Faculty breakdown unavailable because profiles could not be loaded. Refresh analytics to retry.';
      return;
    }

    if (facultyResult.error || programmeResult.error) {
      const error = facultyResult.error || programmeResult.error;

      console.error('Could not load academic lists:', error);
      document.querySelector('#academic-feedback').textContent =
        `Could not load the academic lists: ${error.message}`;
    }

    profiles = profileResult.data || [];
    try {
      const appointments=await window.fyeAcademic.all('mentor_appointments');
      profiles=profiles.map(p=>{const active=appointments.find(a=>a.mentor_id===p.id&&!a.ended_at&&Date.parse(a.starts_at)<=Date.now());return {...p,mentor_available:!!active&&!active.paused};});
    } catch(error) { userFeedback.textContent='Could not load mentor appointments: '+error.message;return; }
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

    facultyFilter.value = faculties.some((faculty) => String(faculty.id) === selectedFaculty) ? selectedFaculty : '';
    updateProgrammeFilter();
    if (programmes.some((programme) => String(programme.id) === selectedProgramme && String(programme.faculty_id) === facultyFilter.value)) {
      programmeFilter.value = selectedProgramme;
    }
    renderAcademicLists();
    renderOverviewCounts();
    renderProfiles();
    renderFacultyBreakdown();
    document.dispatchEvent(new CustomEvent('fye:admin-data', { detail: { profiles, faculties, programmes } }));
    if (facultyResult.error || programmeResult.error) {
      document.querySelector('#analytics-faculty-tabs').replaceChildren();
      document.querySelector('#analytics-faculty-detail').textContent =
        'Faculty breakdown unavailable because academic lists could not be loaded. Refresh analytics to retry.';
    }

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

    const { data: authData, error: authError } = account ? {data:{user:account.user}} : await db.auth.getUser();

    if (authError || !authData.user) {
      window.location.href = 'index.html';
      return;
    }

    const { data: profile, error: profileError } = account ? {data:account.profile} : await db
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

  function applyUserFilters() { userPage = 1; renderProfiles(); }
  searchInput.addEventListener('input', applyUserFilters);
  roleFilter.addEventListener('change', applyUserFilters);
  statusFilter.addEventListener('change', applyUserFilters);

  facultyFilter.addEventListener('change', () => {
    updateProgrammeFilter();
    applyUserFilters();
  });

  programmeFilter.addEventListener('change', applyUserFilters);
  document.querySelector('#users-clear-filters').addEventListener('click', () => {
    searchInput.value = ''; roleFilter.value = ''; facultyFilter.value = ''; statusFilter.value = '';
    updateProgrammeFilter(); applyUserFilters();
  });

  editMentorFaculty.addEventListener('change', () => {
    loadEditProgrammes(editMentorFaculty.value);
  });

  mentorEditForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editingMentor) return;
    const saveButton = mentorEditForm.querySelector('button[type="submit"]');
    saveButton.disabled = true;
    mentorEditFeedback.textContent = 'Saving mentor account…';
    const { error } = await db.rpc('admin_update_mentor_profile', {
      p_mentor_id: editingMentor.id,
      p_first_name: document.querySelector('#edit-mentor-first-name').value.trim(),
      p_last_name: document.querySelector('#edit-mentor-last-name').value.trim(),
      p_school: document.querySelector('#edit-mentor-school').value.trim(),
      p_faculty_id: Number(editMentorFaculty.value),
      p_programme_id: Number(editMentorProgramme.value),
      p_bio: document.querySelector('#edit-mentor-bio').value.trim()
    });
    saveButton.disabled = false;
    if (error) {
      console.error('Could not update mentor account:', error);
      mentorEditFeedback.textContent = `Could not update mentor account: ${error.message}`;
      return;
    }
    mentorEditDialog.close();
    editingMentor = null;
    userFeedback.textContent = 'Mentor account updated.';
    await loadDashboardData();
  });

  document.querySelector('#mentor-edit-cancel').addEventListener('click', () => {
    mentorEditDialog.close();
    editingMentor = null;
  });

  document
    .querySelector('#users-refresh')
    .addEventListener('click', loadDashboardData);

  document.querySelector('#analytics-period').addEventListener('change', loadAnalytics);
  document.addEventListener('fye:admin-edit-mentor', (event) => {
    const profile = profiles.find((item) => item.id === event.detail?.id);
    if (profile?.role === 'mentor') openMentorEditor(profile);
  });
  document.addEventListener('academic-data-updated', loadDashboardData);
  document.addEventListener('fye:notices-updated', loadAnalytics);
  document.querySelector('#analytics-refresh').addEventListener('click', async () => {
    await loadDashboardData();
    await loadAnalytics();
  });

  const style = document.createElement('style');
  style.textContent = `
    .analytics-faculty-detail .data-table th,
    .analytics-faculty-detail .data-table td {
      display: table-cell;
    }

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
    .admin-account-edit,.admin-account-delete{margin:3px;border:0;border-radius:8px;padding:7px 9px;font:inherit;cursor:pointer}
    .admin-account-edit{background:#eaf0ff;color:#1a2a6c}
    .admin-account-delete{background:#fff0f0;color:#9a2b2b}
    .mentor-edit-dialog{width:min(520px,calc(100% - 32px));max-height:85vh;overflow:auto;border:0;border-radius:16px;padding:24px;box-shadow:0 18px 60px #17203340}
    .mentor-edit-dialog::backdrop{background:#17203380}
    .mentor-edit-actions{display:flex;gap:10px;align-items:center}

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

    .analytics-faculty-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 16px 0 8px;
    }

    .faculty-tab {
      padding: 8px 18px;
      border: 1px solid #cbd5e1;
      border-radius: 20px;
      background: #fff;
      color: #475569;
      font: 600 13px 'DM Sans', sans-serif;
      cursor: pointer;
      transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
    }

    .faculty-tab:hover {
      border-color: #1a2a6c;
      color: #1a2a6c;
    }

    .faculty-tab.active {
      background: #1a2a6c;
      border-color: #1a2a6c;
      color: #fff;
    }

    .analytics-faculty-summary {
      display: flex;
      gap: 24px;
      padding: 16px 0;
      border-bottom: 1px solid #e7edf5;
      margin-bottom: 16px;
    }

    .faculty-stat {
      display: grid;
      gap: 4px;
      text-align: center;
      min-width: 70px;
    }

    .faculty-stat strong {
      color: #1a2a6c;
      font: 800 26px 'Manrope', sans-serif;
    }

    .faculty-stat span {
      color: #64748b;
      font-size: 12px;
      font-weight: 600;
    }

    .analytics-faculty-detail .data-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }

    .analytics-faculty-detail .data-table th {
      text-align: left;
      padding: 10px 12px;
      color: #475569;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border-bottom: 2px solid #e7edf5;
    }

    .analytics-faculty-detail .data-table td {
      padding: 10px 12px;
      font-size: 14px;
      border-bottom: 1px solid #f1f5f9;
    }

    .analytics-faculty-detail .data-table tbody tr:hover {
      background: #f8fafc;
    }

    @media (max-width: 640px) {
      .analytics-faculty-tabs {
        gap: 6px;
      }

      .faculty-tab {
        padding: 6px 12px;
        font-size: 12px;
      }

      .analytics-faculty-summary {
        gap: 16px;
        flex-wrap: wrap;
      }
    }
  `;

  document.head.appendChild(style);

  init();
})();
