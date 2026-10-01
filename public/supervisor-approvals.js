(() => {
  const db = window.fyeSupabase;
  const list = document.querySelector('#mentor-approval-list');
  if (!db || !list) return;

  const feedback = document.querySelector('#approval-feedback');

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
      ? 'Approving application…'
      : 'Declining application…';

    const { error } = await db.rpc('review_mentor_application', {
      p_application_id: application.id,
      p_decision: decision,
      p_reason: reason
    });

    if (error) {
      console.error('Could not update mentor application:', error);
      feedback.textContent = `Could not update application: ${error.message}`;
      button.disabled = false;
      return;
    }

    feedback.textContent = decision === 'approved'
      ? 'Application approved. The student can now use mentor features and receive assignments.'
      : 'Application declined. The student can review the reason and resubmit.';
    await loadMentorApplications();
  }

  async function loadMentorApplications() {
    list.innerHTML = '<tr><td colspan="8">Loading mentor applications…</td></tr>';

    const { data: applications, error: applicationError } = await db
      .from('mentor_applications')
      .select('id, applicant_id, student_number, study_year, previous_academic_year, academic_record_path, status, is_legacy, created_at')
      .in('status', ['pending', 'declined'])
      .order('created_at', { ascending: false });

    if (applicationError) {
      console.error('Could not load mentor applications:', applicationError);
      list.innerHTML = '<tr><td colspan="8">Mentor applications are unavailable.</td></tr>';
      feedback.textContent = applicationError.code === 'PGRST205'
        ? 'Apply database/20261002000000_mentor_application_workflow.sql in Supabase, then refresh the schema cache.'
        : `Could not load mentor applications: ${applicationError.message}`;
      return;
    }

    const applicantIds = [...new Set((applications || []).map((item) => item.applicant_id))];
    const [profilesResult, programmeResult] = await Promise.all([
      applicantIds.length
        ? db.from('profiles').select('id, full_name, email, programme_id').in('id', applicantIds)
        : Promise.resolve({ data: [], error: null }),
      db.from('programmes').select('id, name')
    ]);

    const error = profilesResult.error || programmeResult.error;
    if (error) {
      console.error('Could not load mentor application details:', error);
      list.innerHTML = '<tr><td colspan="8">Mentor application details are unavailable.</td></tr>';
      feedback.textContent = `Could not load application details: ${error.message}`;
      return;
    }

    const programmeNames = new Map((programmeResult.data || []).map((item) => [String(item.id), item.name]));
    const applicants = new Map((profilesResult.data || []).map((item) => [item.id, item]));
    list.replaceChildren();

    if (!applications?.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 8;
      cell.textContent = 'No mentor applications are waiting for review.';
      row.appendChild(cell);
      list.appendChild(row);
      return;
    }

    for (const application of applications) {
      const applicant = applicants.get(application.applicant_id) || {};
      const row = document.createElement('tr');
      appendCell(row, [applicant.full_name || 'Name not provided', applicant.email || 'Email not provided'].join(' · '));
      appendCell(row, application.student_number || (application.is_legacy ? 'Legacy record' : 'Not provided'));
      appendCell(row, programmeNames.get(String(applicant.programme_id)) || 'Not selected');
      appendCell(row, application.study_year ? `Year ${application.study_year}` : 'Not provided');
      appendCell(row, application.previous_academic_year || 'Not provided');
      appendCell(row, application.status === 'declined' ? 'Declined' : 'Pending');

      const recordCell = document.createElement('td');
      if (application.academic_record_path) {
        const { data: signedRecord, error: signedError } = await db.storage
          .from('mentor-academic-records')
          .createSignedUrl(application.academic_record_path, 300);

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

      if (application.status === 'pending') {
        const approveButton = document.createElement('button');
        approveButton.type = 'button';
        approveButton.className = 'mentor-approve-button';
        approveButton.textContent = 'Approve';
        approveButton.addEventListener('click', () => reviewApplication(application, applicant, 'approved', approveButton));

        const declineButton = document.createElement('button');
        declineButton.type = 'button';
        declineButton.className = 'mentor-reject-button';
        declineButton.textContent = 'Decline';
        declineButton.addEventListener('click', () => reviewApplication(application, applicant, 'declined', declineButton));

        actions.append(approveButton, declineButton);
      } else {
        actions.textContent = 'Awaiting resubmission';
      }
      row.appendChild(actions);
      list.appendChild(row);
    }
  }

  document.querySelector('#approvals-refresh')
    .addEventListener('click', loadMentorApplications);

  const style = document.createElement('style');
  style.textContent = `
    .mentor-approval-actions{display:flex;gap:8px;white-space:nowrap}
    .mentor-approval-actions button{border:0;border-radius:8px;padding:8px 10px;font:inherit;cursor:pointer}
    .mentor-approve-button{background:#f9a825;color:#172033;font-weight:700}
    .mentor-approve-button:hover{background:#ffc107}
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
