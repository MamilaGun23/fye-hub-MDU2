(() => {
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
      row.append(name, editButton);
      row.append(name, actions);
      facultyList.appendChild(row);
    }
  }

  function renderProgrammes() {
    programmeList.replaceChildren();

    if (!programmes.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No programmes found.';
      programmeList.appendChild(empty);
      return;
    }

    for (const programme of programmes) {
      const row = document.createElement('li');
      const faculty = faculties.find(
        (item) => String(item.id) === String(programme.faculty_id)
      );
      const name = document.createElement('span');
      name.textContent = `${programme.name} · ${faculty?.name || 'Faculty not found'}`;
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'academic-edit-button';
      editButton.textContent = 'Rename';
      editButton.addEventListener('click', () => renameProgramme(programme));
      row.append(name, editButton);
      programmeList.appendChild(row);
    }
  }

  async function loadAcademicData() {
    facultyList.innerHTML = '<li>Loading faculties…</li>';
    programmeList.innerHTML = '<li>Loading programmes…</li>';

    const [facultyResult, programmeResult] = await Promise.all([
      db.from('faculties').select('id, name').order('name'),
      db.from('programmes').select('id, name, faculty_id').order('name')
    ]);

    if (facultyResult.error || programmeResult.error) {
      const error = facultyResult.error || programmeResult.error;
      console.error('Could not load academic setup:', error);
      facultyFeedback.textContent = `Could not load faculties or programmes: ${error.message}`;
      return;
    }

    faculties = facultyResult.data || [];
    programmes = programmeResult.data || [];
    renderFaculties();
    renderProgrammes();
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
    await loadAcademicData();
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
    await loadAcademicData();
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
    await loadAcademicData();
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
      await loadAcademicData();
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
      await loadAcademicData();
    }
    button.disabled = false;
    button.textContent = 'Add programme';
  });

  const style = document.createElement('style');
  style.textContent = `
    .academic-manage-list{padding-left:0;list-style:none}
    .academic-manage-list li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #e4ebf3}
    .academic-manage-list li span{min-width:0;overflow-wrap:anywhere}
    .academic-edit-button{flex:0 0 auto;border:0;border-radius:8px;padding:7px 10px;color:#245c96;background:#edf3fa;font:inherit;cursor:pointer}
    .academic-row-actions{display:flex;flex:0 0 auto;gap:6px}
    .academic-delete-button{border:0;border-radius:8px;padding:7px 10px;color:#8e3838;background:#fbeaea;font:inherit;cursor:pointer}
    .academic-row-actions button:disabled{opacity:.6;cursor:wait}
    .admin-academic-grid{align-items:start}
    #programme-form textarea{box-sizing:border-box;width:100%}
  `;
  document.head.appendChild(style);

  async function init() {
    if (await verifyAdmin()) await loadAcademicData();
  }

  init();
})();