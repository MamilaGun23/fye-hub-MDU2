(async () => {
  if (window.fyeAuth && !(await window.fyeAuth.ready)) return;
  const db = window.fyeSupabase;
  const facultyForm = document.querySelector('#faculty-form');
  const programmeForm = document.querySelector('#programme-form');
  if (!db || !facultyForm || !programmeForm) return;

  const facultyList = document.querySelector('#faculty-manage-list');
  const programmeList = document.querySelector('#programme-manage-list');
  const facultyFeedback = document.querySelector('#faculty-feedback');
  const programmeFeedback = document.querySelector('#programme-feedback');
  const facultySelect = document.querySelector('#programme-faculty');

  let faculties = [];
  let programmes = [];

  async function verifyAdmin() {
    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData.user) return false;

    const { data: profile, error } = await db
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (error || profile?.role !== 'admin') {
      facultyFeedback.textContent = error
        ? `Could not verify admin access: ${error.message}`
        : 'Only an admin account can manage faculties and programmes.';
      return false;
    }
    return true;
  }

  function renderFaculties() {
    const selectedFaculty = facultySelect.value;
    facultyList.replaceChildren();
    facultySelect.replaceChildren();

    const chooseFaculty = document.createElement('option');
    chooseFaculty.value = '';
    chooseFaculty.textContent = 'Choose a faculty';
    facultySelect.appendChild(chooseFaculty);

    if (!faculties.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No faculties found.';
      facultyList.appendChild(empty);
      return;
    }

    for (const faculty of faculties) {
      const option = document.createElement('option');
      option.value = String(faculty.id);
      option.textContent = faculty.name;
      facultySelect.appendChild(option);

      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = faculty.name;
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'academic-edit-button';
      editButton.textContent = 'Rename';
      editButton.addEventListener('click', () => renameFaculty(faculty));
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'academic-delete-button';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => deleteFaculty(faculty, deleteButton));
      const actions = document.createElement('span');
      actions.className = 'academic-row-actions';
      actions.append(editButton, deleteButton);
      row.append(name, actions);
      facultyList.appendChild(row);
    }
    if (faculties.some((faculty) => String(faculty.id) === selectedFaculty)) {
      facultySelect.value = selectedFaculty;
    }
  }

  function renderProgrammes() {
    const openGroups = new Set([...programmeList.querySelectorAll('details[open]')].map(group => group.dataset.facultyId));
    const search = window.fyeDirectory.normalize(document.querySelector('#programme-manage-search').value);
    programmeList.replaceChildren();

    if (!programmes.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No programmes found.';
      programmeList.appendChild(empty);
      return;
    }

    const grouped = new Map();
    for (const programme of programmes) {
      const facultyId = String(programme.faculty_id);
      const facultyName = faculties.find(faculty => String(faculty.id) === facultyId)?.name || 'Unknown faculty';
      const text = window.fyeDirectory.normalize(`${programme.name} ${facultyName}`);
      if (!search.split(/\s+/).filter(Boolean).every(term => text.includes(term))) continue;
      if (!grouped.has(facultyId)) grouped.set(facultyId, []);
      grouped.get(facultyId).push(programme);
    }

    const groups = [...grouped].sort(([a], [b]) => {
      const nameFor = (id) => faculties.find((faculty) => String(faculty.id) === id)?.name || 'Unknown faculty';
      return nameFor(a).localeCompare(nameFor(b));
    });
    for (const [facultyId, progs] of groups) {
      const faculty = faculties.find((f) => String(f.id) === facultyId);
      const groupRow = document.createElement('li');
      groupRow.className = 'academic-programme-group';
      const group = document.createElement('details'); group.dataset.facultyId = facultyId;
      group.open = !!search || openGroups.has(facultyId);
      const summary = document.createElement('summary'); summary.textContent = faculty?.name || 'Unknown faculty';
      const list = document.createElement('ul'); list.className = 'academic-manage-list academic-programme-rows';
      list.tabIndex = 0; list.setAttribute('aria-label', `Programmes in ${faculty?.name || 'unknown faculty'}`);
      group.append(summary, list); groupRow.appendChild(group); programmeList.appendChild(groupRow);

      for (const programme of progs) {
        const row = document.createElement('li');
        row.className = 'academic-programme-item';
        const name = document.createElement('span');
        name.textContent = programme.name;
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'academic-edit-button';
        editButton.textContent = 'Rename';
        editButton.addEventListener('click', () => renameProgramme(programme));
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'academic-delete-button';
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', () => deleteProgramme(programme, deleteButton));
        const actions = document.createElement('span');
        actions.className = 'academic-row-actions';
        const qualificationButton=document.createElement('button');qualificationButton.type='button';qualificationButton.textContent='Qualification';
        qualificationButton.onclick=()=>window.fyeProgrammeQualification.open(programme,()=>loadAcademicData(true));
        actions.append(editButton, deleteButton,qualificationButton);
        row.append(name, actions);
        list.appendChild(row);
      }
    }
    if (!grouped.size) {
      const empty = document.createElement('li'); empty.textContent = 'No programmes match your search.'; programmeList.appendChild(empty);
    }
  }
  document.querySelector('#programme-manage-search').addEventListener('input', renderProgrammes);

  async function loadAcademicData(notify = false) {
    facultyList.innerHTML = '<li>Loading faculties…</li>';
    programmeList.innerHTML = '<li>Loading programmes…</li>';

    const [facultyResult, programmeResult] = await Promise.all([
      db.from('faculties').select('id, name').order('name'),
      db.from('programmes').select('*').order('name')
    ]);

    if (facultyResult.error || programmeResult.error) {
      const error = facultyResult.error || programmeResult.error;
      console.error('Could not load academic setup:', error);
      facultyFeedback.textContent = `Could not load faculties or programmes: ${error.message}`;
      facultyList.innerHTML = '<li>Faculty list unavailable. Refresh the page to retry.</li>';
      programmeList.innerHTML = '<li>Programme list unavailable. Refresh the page to retry.</li>';
      return;
    }

    faculties = facultyResult.data || [];
    programmes = programmeResult.data || [];
    renderFaculties();
    renderProgrammes();
    if (notify) document.dispatchEvent(new CustomEvent('academic-data-updated'));
  }

  async function renameFaculty(faculty) {
    const newName = window.prompt('Enter the corrected faculty name:', faculty.name);
    if (newName === null) return;
    const name = newName.trim();
    if (!name) {
      facultyFeedback.textContent = 'Faculty name cannot be empty.';
      return;
    }
    if (faculties.some((item) => item.id !== faculty.id && item.name.toLowerCase() === name.toLowerCase())) {
      facultyFeedback.textContent = 'A faculty with that name already exists.';
      return;
    }

    facultyFeedback.textContent = 'Saving faculty name…';
    const { error } = await db.from('faculties').update({ name }).eq('id', faculty.id);
    if (error) {
      console.error('Could not rename faculty:', error);
      facultyFeedback.textContent = `Could not rename faculty: ${error.message}`;
      return;
    }
    facultyFeedback.textContent = 'Faculty name updated.';
    await loadAcademicData(true);
  }

  async function deleteFaculty(faculty, button) {
    const confirmed = window.confirm(
      `Delete “${faculty.name}” and all programmes under it? This is permanent. The database will block deletion if any profile uses this faculty or one of its programmes.`
    );
    if (!confirmed) return;

    button.disabled = true;
    facultyFeedback.textContent = 'Deleting faculty and its programmes…';

    const { error } = await db.rpc('delete_faculty_and_programmes', {
      p_faculty_id: faculty.id
    });

    if (error) {
      console.error('Could not delete faculty:', error);
      facultyFeedback.textContent = `Could not delete faculty: ${error.message}`;
      button.disabled = false;
      return;
    }

    facultyFeedback.textContent = 'Faculty and its programmes deleted.';
    await loadAcademicData(true);
  }

  async function renameProgramme(programme) {
    const newName = window.prompt('Enter the corrected programme name:', programme.name);
    if (newName === null) return;
    const name = newName.trim();
    if (!name) {
      programmeFeedback.textContent = 'Programme name cannot be empty.';
      return;
    }
    if (programmes.some((item) =>
      item.id !== programme.id &&
      item.faculty_id === programme.faculty_id &&
      item.name.toLowerCase() === name.toLowerCase()
    )) {
      programmeFeedback.textContent = 'That programme already exists under this faculty.';
      return;
    }

    programmeFeedback.textContent = 'Saving programme name…';
    const { error } = await db.from('programmes').update({ name }).eq('id', programme.id);
    if (error) {
      console.error('Could not rename programme:', error);
      programmeFeedback.textContent = `Could not rename programme: ${error.message}`;
      return;
    }
    programmeFeedback.textContent = 'Programme name updated.';
    await loadAcademicData(true);
  }

  async function deleteProgramme(programme, button) {
    const faculty = faculties.find((f) => String(f.id) === String(programme.faculty_id));
    const confirmed = window.confirm(
      `Delete "${programme.name}" from ${faculty?.name || 'this faculty'}? The database will block deletion if any profile uses this programme.`
    );
    if (!confirmed) return;

    button.disabled = true;
    programmeFeedback.textContent = 'Deleting programme…';

    const { error } = await db.from('programmes').delete().eq('id', programme.id);

    if (error) {
      console.error('Could not delete programme:', error);
      programmeFeedback.textContent = `Could not delete programme: ${error.message}`;
      button.disabled = false;
      return;
    }

    programmeFeedback.textContent = 'Programme deleted.';
    await loadAcademicData(true);
  }

  facultyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    facultyFeedback.textContent = '';
    const input = document.querySelector('#new-faculty-name');
    const name = input.value.trim();
    const button = facultyForm.querySelector('button[type="submit"]');

    if (faculties.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      facultyFeedback.textContent = 'A faculty with that name already exists.';
      return;
    }

    button.disabled = true;
    button.textContent = 'Adding…';
    const { error } = await db.from('faculties').insert({ name });
    if (error) {
      console.error('Could not add faculty:', error);
      facultyFeedback.textContent = `Could not add faculty: ${error.message}`;
    } else {
      facultyFeedback.textContent = 'Faculty added.';
      facultyForm.reset();
      await loadAcademicData(true);
    }
    button.disabled = false;
    button.textContent = 'Add faculty';
  });

  programmeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    programmeFeedback.textContent = '';
    const facultyId = facultySelect.value;
    const input = document.querySelector('#new-programme-name');
    const name = input.value.trim();
    const button = programmeForm.querySelector('button[type="submit"]');

    if (!facultyId) {
      programmeFeedback.textContent = 'Choose a faculty first.';
      return;
    }
    if (programmes.some((item) =>
      String(item.faculty_id) === facultyId &&
      item.name.toLowerCase() === name.toLowerCase()
    )) {
      programmeFeedback.textContent = 'That programme already exists under this faculty.';
      return;
    }

    button.disabled = true;
    button.textContent = 'Adding…';
    const { error } = await db.from('programmes').insert({
      name,
      faculty_id: Number(facultyId)
    });
    if (error) {
      console.error('Could not add programme:', error);
      programmeFeedback.textContent = `Could not add programme: ${error.message}`;
    } else {
      programmeFeedback.textContent = 'Programme added.';
      programmeForm.reset();
      await loadAcademicData(true);
    }
    button.disabled = false;
    button.textContent = 'Add programme';
  });

  const style = document.createElement('style');
  style.textContent = `
    .academic-manage-list {
      padding-left: 0;
      list-style: none;
    }

    .academic-manage-list li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid #e4ebf3;
    }

    .academic-manage-list li span {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .academic-group-header {
      margin-top: 16px;
      padding: 10px 0 8px !important;
      color: #1a2a6c;
      font: 700 13px 'Manrope', sans-serif;
      letter-spacing: 0.03em;
      border-bottom: 2px solid #d0daf0 !important;
      pointer-events: none;
    }

    .academic-group-header:first-child {
      margin-top: 0;
    }

    .academic-programme-item {
      padding-left: 12px !important;
    }

    .academic-edit-button {
      flex: 0 0 auto;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 7px 12px;
      color: #1a2a6c;
      background: #fff;
      font: 600 13px 'DM Sans', sans-serif;
      cursor: pointer;
      transition: border-color 0.15s ease, background 0.15s ease;
    }

    .academic-edit-button:hover {
      border-color: #1a2a6c;
      background: #edf1ff;
    }

    .academic-delete-button {
      flex: 0 0 auto;
      border: 0;
      border-radius: 10px;
      padding: 7px 12px;
      color: #8e3838;
      background: #fbeaea;
      font: 600 13px 'DM Sans', sans-serif;
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .academic-delete-button:hover {
      background: #f5d0d0;
    }

    .academic-row-actions {
      display: flex;
      flex: 0 0 auto;
      gap: 6px;
    }

    .academic-row-actions button:disabled {
      opacity: 0.6;
      cursor: wait;
    }

    .admin-academic-grid {
      align-items: start;
      gap: 20px;
    }

    .admin-academic-grid .content-panel {
      padding: 24px;
    }

    .admin-academic-grid h3 {
      margin: 18px 0 12px;
    }

    .admin-academic-grid .section-kicker {
      margin-bottom: 4px;
    }

    .data-form label {
      display: block;
      margin-top: 12px;
      margin-bottom: 4px;
      font-weight: 600;
      font-size: 13px;
      color: #405a77;
    }

    .data-form input,
    .data-form select {
      box-sizing: border-box;
      width: 100%;
    }

    .data-form .form-action {
      margin-top: 14px;
    }

    #programme-form textarea {
      box-sizing: border-box;
      width: 100%;
    }

    @media (max-width: 760px) {
      .admin-academic-grid {
        grid-template-columns: 1fr !important;
      }

      .academic-row-actions {
        flex-wrap: wrap;
      }

      .academic-manage-list li:not(.academic-group-header) {
        align-items: flex-start;
        flex-direction: column;
      }
    }
  `;
  document.head.appendChild(style);

  async function init() {
    if (await verifyAdmin()) await loadAcademicData();
  }

  init();
})();
