(async () => {
  if (window.fyeAuth && !(await window.fyeAuth.ready)) return;
  const db = window.fyeSupabase;
  const list = document.querySelector('#mentor-approval-list');
  const shortlist = document.querySelector('#mentor-shortlisted-list');
  if (!db || !list) return;

  const feedback = document.querySelector('#approval-feedback');
  const filters = document.querySelector('#application-filters');
  let loadedApplications = [];
  let renderedRows = [];
  let loadVersion = 0;
  let loading = false;
  let loadFailed = false;
  const normalize = window.fyeDirectory.normalize;

  function applyFilters() {
    if (loading || loadFailed) return;
    const terms = normalize(document.querySelector('#application-search').value).split(/\s+/).filter(Boolean);
    const values = Object.fromEntries(['status', 'school', 'programme', 'study-year', 'target-year']
      .map(key => [key, document.querySelector(`#application-${key}`).value]));
    let visible = 0, shortlisted = 0;
    for (const item of renderedRows) {
      const matches = terms.every(term => item.search.includes(term))
        && Object.entries(values).every(([key, value]) => !value || item[key] === value);
      item.row.hidden = !matches;
      if (matches) { visible++; if (item.status === 'shortlisted') shortlisted++; }
    }
    for (const [body, count] of [[list, visible - shortlisted], [shortlist, shortlisted]]) {
      if (!body) continue;
      body.querySelector('[data-filter-empty]')?.remove();
      if (!count) {
        const row = document.createElement('tr');
        row.dataset.filterEmpty = '';
        const cell = document.createElement('td'); cell.colSpan = 9;
        cell.textContent = body === shortlist ? 'No candidates match the filters in the shortlist.' : 'No mentor applications match the filters.';
        row.appendChild(cell); body.appendChild(row);
      }
    }
    document.querySelector('#applications-count').textContent = String(visible - shortlisted);
    document.querySelector('#shortlisted-count').textContent = String(shortlisted);
    document.querySelector('#application-filter-summary').textContent = `Showing ${visible} of ${loadedApplications.length} applications across both lists.`;
  }

  function populateFilters() {
    for (const key of ['school', 'programme', 'study-year', 'target-year']) {
      const select = document.querySelector(`#application-${key}`), previous = select.value;
      while (select.options.length > 1) select.remove(1);
      const values = [...new Set(renderedRows.map(item => item[key]).filter(Boolean))].sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
      for (const value of values) select.add(new Option(value, value));
      select.value = values.includes(previous) ? previous : '';
    }
  }

  filters.addEventListener('submit', event => event.preventDefault());
  filters.addEventListener('input', applyFilters);
  filters.addEventListener('change', applyFilters);
  filters.addEventListener('reset', () => window.setTimeout(applyFilters, 0));

  function appendCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.appendChild(cell);
  }

  async function verifySupervisor() {
    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData.user) {
      feedback.textContent = 'Please sign in with a supervisor account.';
      return false;
    }

    const { data: profile, error } = await db
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (error || profile?.role !== 'supervisor') {
      feedback.textContent = error
        ? `Could not verify supervisor access: ${error.message}`
        : 'Only a supervisor account can review mentors.';
      return false;
    }
    return true;
  }

  async function reviewApplication(application, applicant, decision, button) {
    let reason = '';
    if (decision === 'declined') {
      reason = window.prompt(
        `Why are you declining ${applicant.full_name || applicant.email}'s application?`
      );
      if (reason === null) return;
      if (!reason.trim()) {
        feedback.textContent = 'Enter a reason before declining the application.';
        return;
      }
    }

    button.disabled = true;
    feedback.textContent = decision === 'approved'
      ? 'Approving shortlisted application…'
      : decision === 'shortlisted'
        ? 'Shortlisting application…'
        : 'Declining application…';

    let error;
    try {
      ({ error } = await db.rpc('review_mentor_application', {
        p_application_id: application.id,
        p_decision: decision,
        p_reason: reason
      }));
    } catch (requestError) {
      error = requestError;
    }

    if (error) {
      console.error('Could not update mentor application:', error);
      feedback.textContent = `Could not update application: ${error.message}`;
      button.disabled = false;
      return;
    }

    feedback.textContent = decision === 'approved'
      ? 'Application approved. Mentor access starts when the appointment takes effect in the target academic year.'
      : decision === 'shortlisted'
        ? 'Application shortlisted. Approve or decline it after the next review.'
        : 'Application declined. The student can review the reason and resubmit.';
    await loadMentorApplications();
    if (decision === 'approved') window.dispatchEvent(new CustomEvent('fye:supervisor-data-refresh'));
  }

  async function loadMentorApplications() {
    const version = ++loadVersion;
    loading = true;
    if (loadFailed) feedback.textContent = '';
    loadFailed = false;
    renderedRows = [];
    loadedApplications = [];
    document.querySelector('#applications-count').textContent = '0';
    document.querySelector('#shortlisted-count').textContent = '0';
    document.querySelector('#application-filter-summary').textContent = 'Loading mentor applications…';
    list.setAttribute('aria-busy', 'true');
    shortlist?.setAttribute('aria-busy', 'true');
    list.innerHTML = '<tr><td colspan="9">Loading mentor applications…</td></tr>';
    if (shortlist) shortlist.innerHTML = '<tr><td colspan="9">Loading shortlisted candidates…</td></tr>';

    let applications=[],applicationError;
    try { applications=(await window.fyeAcademic.all('mentor_applications','*',q=>q.in('status',['pending','shortlisted','declined','closed','approved'])))
      .filter(a=>a.status!=='approved'||a.replacement_review_required).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)); }
    catch(error){applicationError=error;}
    if (version !== loadVersion) return;

    if (applicationError) {
      console.error('Could not load mentor applications:', applicationError);
      list.innerHTML = '<tr><td colspan="9">Mentor applications are unavailable.</td></tr>';
      if (shortlist) shortlist.innerHTML = '<tr><td colspan="9">Shortlisted candidates are unavailable.</td></tr>';
      feedback.textContent = applicationError.code === 'PGRST205'
        ? 'Apply database/20261002000000_mentor_application_workflow.sql in Supabase, then refresh the schema cache.'
        : `Could not load mentor applications: ${applicationError.message}`;
      finishLoading('Mentor applications are unavailable. Refresh the list to try again.');
      return;
    }

    const [profilesResult, programmeResult] = await Promise.all([
      window.fyeAcademic.all('profiles','id, full_name, first_name, last_name, email, student_number, programme_id, school')
        .then(data=>({data,error:null}),error=>({data:[],error})),
      window.fyeAcademic.all('programmes','id, name')
        .then(data=>({data,error:null}),error=>({data:[],error}))
    ]);
    if (version !== loadVersion) return;

    const error = profilesResult.error || programmeResult.error;
    if (error) {
      console.error('Could not load mentor application details:', error);
      list.innerHTML = '<tr><td colspan="9">Mentor application details are unavailable.</td></tr>';
      if (shortlist) shortlist.innerHTML = '<tr><td colspan="9">Shortlisted candidate details are unavailable.</td></tr>';
      feedback.textContent = `Could not load application details: ${error.message}`;
      finishLoading('Mentor application details are unavailable. Refresh the list to try again.');
      return;
    }

    const programmeNames = new Map((programmeResult.data || []).map((item) => [String(item.id), item.name]));
    const applicants = new Map((profilesResult.data || []).map((item) => [item.id, item]));
    const nextRows = [];

    for (const application of applications) {
      const applicant = applicants.get(application.applicant_id) || {};
      const row = document.createElement('tr');
      const fullName = applicant.full_name || [applicant.first_name, applicant.last_name].filter(Boolean).join(' ') || 'Name not provided';
      appendCell(row, [fullName, applicant.email || 'Email not provided'].join(' · '));
      appendCell(row, application.student_number || applicant.student_number || (application.is_legacy ? 'Legacy record' : 'Not provided'));
      appendCell(row, application.school || applicant.school || 'Not provided');
      appendCell(row, programmeNames.get(String(applicant.programme_id)) || 'Not selected');
      appendCell(row, application.study_year ? `Year ${application.study_year}` : 'Not provided');
      appendCell(row, application.previous_academic_year || 'Not provided');
      appendCell(row, application.status === 'declined'
        ? `Declined${application.review_reason ? ` · ${application.review_reason}` : ''}`
        : application.status === 'shortlisted' ? 'Shortlisted'
        : application.status === 'closed' ? 'Closed'
        : application.status === 'approved' ? 'Approved — replacement review' : 'Pending');

      const recordCell = document.createElement('td');
      if (application.academic_record_path) {
        let signedRecord, signedError;
        try {
          ({ data: signedRecord, error: signedError } = await db.storage
            .from('mentor-academic-records')
            .createSignedUrl(application.academic_record_path, 300));
        } catch (error) {
          signedError = error;
        }
        if (version !== loadVersion) return;

        if (!signedError && signedRecord?.signedUrl) {
          const link = document.createElement('a');
          link.href = signedRecord.signedUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'View PDF';
          recordCell.appendChild(link);
        } else {
          recordCell.textContent = 'Record unavailable';
        }
      } else {
        recordCell.textContent = application.is_legacy
          ? 'Legacy application; verify record manually'
          : 'Not provided';
      }
      row.appendChild(recordCell);

      const actions = document.createElement('td');
      actions.className = 'mentor-approval-actions';
      const evidenceButton=document.createElement('button');evidenceButton.type='button';evidenceButton.textContent='Evidence and history';
      evidenceButton.onclick=()=>window.fyeMentorEvidence.open(application,applicant,loadMentorApplications);
      actions.appendChild(evidenceButton);

      if (application.status === 'pending' || application.status === 'shortlisted') {
        if (application.status === 'pending') {
          const shortlistButton = document.createElement('button');
          shortlistButton.type = 'button';
          shortlistButton.className = 'mentor-shortlist-button';
          shortlistButton.textContent = 'Shortlist';
          shortlistButton.addEventListener('click', () => reviewApplication(application, applicant, 'shortlisted', shortlistButton));
          actions.appendChild(shortlistButton);
        } else {
          const approveButton = document.createElement('button');
          approveButton.type = 'button';
          approveButton.className = 'mentor-approve-button';
          approveButton.textContent = 'Approve';
          approveButton.addEventListener('click', () => reviewApplication(application, applicant, 'approved', approveButton));
          actions.appendChild(approveButton);
        }
        const declineButton = document.createElement('button');
        declineButton.type = 'button';
        declineButton.className = 'mentor-reject-button';
        declineButton.textContent = 'Decline';
        declineButton.addEventListener('click', () => reviewApplication(application, applicant, 'declined', declineButton));

        actions.appendChild(declineButton);
      } else {
        appendCellMessage(actions, application.status === 'declined' ? 'Awaiting resubmission' : 'Review evidence and history');
      }
      row.appendChild(actions);
      nextRows.push({row, status: application.status,
        search: normalize([fullName, applicant.email, application.student_number, applicant.student_number].filter(Boolean).join(' ')),
        school: application.school || applicant.school || '',
        programme: programmeNames.get(String(applicant.programme_id)) || '',
        'study-year': application.study_year ? String(application.study_year) : '',
        'target-year': application.cycle_year ? String(Number(application.cycle_year) + 1) : ''});
    }
    loadedApplications = applications;
    renderedRows = nextRows;
    list.replaceChildren();
    shortlist?.replaceChildren();
    for (const item of renderedRows) (item.status === 'shortlisted' && shortlist ? shortlist : list).appendChild(item.row);
    window.fyeNavCounts?.set('mentor-applications', applications.length, 'applications in the review workspace');
    finishLoading();
    populateFilters();
    applyFilters();
  }

  function finishLoading(message) {
    loading = false;
    loadFailed = Boolean(message);
    list.setAttribute('aria-busy', 'false');
    shortlist?.setAttribute('aria-busy', 'false');
    if (message) document.querySelector('#application-filter-summary').textContent = message;
  }

  function appendCellMessage(cell, message) {
    const text = document.createElement('span'); text.textContent = message; cell.appendChild(text);
  }

  document.querySelector('#approvals-refresh')
    .addEventListener('click', loadMentorApplications);

  const style = document.createElement('style');
  style.textContent = `
    .mentor-approval-actions{display:flex;gap:8px;white-space:nowrap}
    .mentor-approval-actions button{border:0;border-radius:8px;padding:8px 10px;font:inherit;cursor:pointer}
    .mentor-approve-button{background:#f9a825;color:#172033;font-weight:700}
    .mentor-approve-button:hover{background:#ffc107}
    .mentor-shortlist-button{background:#eaf0ff;color:#1a2a6c;font-weight:700}
    .mentor-reject-button{border:1px solid #fecaca!important;background:#fff7f7;color:#991b1b}
    .mentor-reject-button:hover{background:#fee2e2}
    .mentor-approval-actions button:disabled{opacity:.6;cursor:wait}
  `;
  document.head.appendChild(style);

  async function init() {
    if (await verifySupervisor()) await loadMentorApplications();
  }

  init();
})();
