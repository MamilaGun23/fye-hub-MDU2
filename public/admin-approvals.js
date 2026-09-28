(() => {
  const db = window.fyeSupabase;
  const list = document.querySelector('#mentor-approval-list');
  if (!db || !list) return;

  const feedback = document.querySelector('#approval-feedback');
  let facultyNames = new Map();
  let programmeNames = new Map();

  function appendCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.appendChild(cell);
  }

  async function verifyAdmin() {
    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData.user) {
      feedback.textContent = 'Please sign in with an admin account.';
      return false;
    }

    const { data: profile, error } = await db
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (error || profile?.role !== 'admin') {
      feedback.textContent = error
        ? `Could not verify admin access: ${error.message}`
        : 'Only an admin account can review mentors.';
      return false;
    }
    return true;
  }

  async function reviewMentor(mentor, decision, button) {
    if (decision === 'rejected' && !window.confirm(
      `Reject mentor registration for ${mentor.full_name || mentor.email}?`
    )) return;

    button.disabled = true;
    feedback.textContent = decision === 'approved'
      ? 'Approving mentor…'
      : 'Rejecting mentor…';

    const { error } = await db.rpc('review_mentor_approval', {
      p_mentor_id: mentor.id,
      p_decision: decision
    });

    if (error) {
      console.error('Could not update mentor approval:', error);
      feedback.textContent = `Could not update approval: ${error.message}`;
      button.disabled = false;
      return;
    }

    feedback.textContent = decision === 'approved'
      ? 'Mentor approved. They can now receive student assignments.'
      : 'Mentor registration rejected. They cannot receive assignments.';
    await loadPendingMentors();
  }

  async function loadPendingMentors() {
    list.innerHTML = '<tr><td colspan="6">Loading mentor profiles…</td></tr>';

    const [facultyResult, programmeResult, mentorResult] = await Promise.all([
      db.from('faculties').select('id, name'),
      db.from('programmes').select('id, name'),
      db.from('profiles')
        .select('id, full_name, email, faculty_id, programme_id, mentor_approval_status')
        .eq('role', 'mentor')
        .in('mentor_approval_status', ['pending', 'rejected'])
        .order('full_name')
    ]);

    const error = facultyResult.error || programmeResult.error || mentorResult.error;
    if (error) {
      console.error('Could not load mentor approvals:', error);
      list.innerHTML = '<tr><td colspan="6">Mentor approval list unavailable.</td></tr>';
      feedback.textContent = `Could not load mentor approvals: ${error.message}`;
      return;
    }

    facultyNames = new Map((facultyResult.data || []).map((item) => [String(item.id), item.name]));
    programmeNames = new Map((programmeResult.data || []).map((item) => [String(item.id), item.name]));
    const mentors = mentorResult.data || [];
    list.replaceChildren();

    if (!mentors.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = 'No mentors are waiting for review.';
      row.appendChild(cell);
      list.appendChild(row);
      return;
    }

    for (const mentor of mentors) {
      const row = document.createElement('tr');
      appendCell(row, mentor.full_name || 'Name not provided');
      appendCell(row, mentor.email || 'Email not provided');
      appendCell(row, facultyNames.get(String(mentor.faculty_id)) || 'Not selected');
      appendCell(row, programmeNames.get(String(mentor.programme_id)) || 'Not selected');
      appendCell(row, mentor.mentor_approval_status === 'rejected' ? 'Rejected' : 'Pending');

      const actions = document.createElement('td');
      actions.className = 'mentor-approval-actions';

      const approveButton = document.createElement('button');
      approveButton.type = 'button';
      approveButton.className = 'mentor-approve-button';
      approveButton.textContent = 'Approve';
      approveButton.addEventListener('click', () => reviewMentor(mentor, 'approved', approveButton));

      const rejectButton = document.createElement('button');
      rejectButton.type = 'button';
      rejectButton.className = 'mentor-reject-button';
      rejectButton.textContent = 'Reject';
      rejectButton.addEventListener('click', () => reviewMentor(mentor, 'rejected', rejectButton));

      actions.append(approveButton, rejectButton);
      row.appendChild(actions);
      list.appendChild(row);
    }
  }

  document.querySelector('#approvals-refresh')
    .addEventListener('click', loadPendingMentors);

  const style = document.createElement('style');
  style.textContent = `
    .mentor-approval-actions{display:flex;gap:8px;white-space:nowrap}
    .mentor-approval-actions button{border:0;border-radius:8px;padding:8px 10px;font:inherit;cursor:pointer}
    .mentor-approve-button{background:#e5f5e9;color:#24643a}
    .mentor-reject-button{background:#fbeaea;color:#8e3838}
    .mentor-approval-actions button:disabled{opacity:.6;cursor:wait}
  `;
  document.head.appendChild(style);

  async function init() {
    if (await verifyAdmin()) await loadPendingMentors();
  }

  init();
})();
