(() => {
  const db = window.fyeSupabase;
  const main = document.querySelector('.main-content');
  if (!db || !main) return;

  async function showApprovalStatus() {
    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData.user) return;

    const { data: profile, error } = await db
      .from('profiles')
      .select('role, mentor_approval_status')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (error) {
      console.error('Could not load mentor approval status:', error);
      return;
    }
    if (profile?.role !== 'mentor' || profile.mentor_approval_status === 'approved') return;

    const rejected = profile.mentor_approval_status === 'rejected';
    const notice = document.createElement('section');
    notice.className = 'mentor-approval-notice';
    notice.setAttribute('role', 'status');

    const heading = document.createElement('h2');
    heading.textContent = rejected ? 'Mentor registration needs review' : 'Mentor account awaiting approval';

    const message = document.createElement('p');
    message.textContent = rejected
      ? 'Your mentor registration has not been approved. Please contact the FYE administrator for guidance.'
      : 'Your profile is waiting for admin review. You can complete your profile, but supervisors cannot assign students to you until it is approved.';

    notice.append(heading, message);
    const topbar = main.querySelector('.topbar');
    if (topbar) topbar.insertAdjacentElement('afterend', notice);
    else main.prepend(notice);

    const style = document.createElement('style');
    style.textContent = `
      .mentor-approval-notice{margin:16px 0;padding:16px 18px;border:1px solid #e6bd60;border-left:5px solid #d89b28;border-radius:12px;background:#fff8e6;color:#533d13}
      .mentor-approval-notice h2{margin:0 0 6px;font-size:1rem;color:#533d13}
      .mentor-approval-notice p{margin:0;line-height:1.5}
    `;
    document.head.appendChild(style);
  }

  showApprovalStatus();
})();
