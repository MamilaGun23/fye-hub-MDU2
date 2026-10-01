(() => {
  const db = window.fyeSupabase;
  const main = document.querySelector('.main-content');
  if (!db || !main) return;

  const style = document.createElement('style');
  style.textContent = `
    .fye-system-notices{display:grid;gap:10px;margin:16px 0 20px}
    .fye-system-notice{position:relative;padding:16px 56px 16px 18px;border:1px solid #e6bd60;border-left:5px solid #d89b28;border-radius:12px;background:#fff8e6;color:#533d13}
    .fye-system-notice h2{margin:0 0 6px;font-size:1rem;color:#533d13}
    .fye-system-notice p{margin:0;line-height:1.5}
    .fye-system-notice small{display:block;margin-top:8px;color:#786642}
    .fye-system-notice-dismiss{position:absolute;top:10px;right:10px;display:grid;width:36px;height:36px;place-items:center;border:1px solid #dfc784;border-radius:10px;background:#fffdf5;color:#533d13;font:700 20px 'DM Sans',sans-serif;cursor:pointer}
    .fye-system-notice-dismiss:hover{background:#fff1c2}
  `;
  document.head.appendChild(style);

  function formatDate(value) {
    return new Intl.DateTimeFormat('en-ZA', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  async function loadNotices() {
    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData.user) return;

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('role, is_active')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (profileError || profile?.is_active === false || !['student', 'mentor'].includes(profile?.role)) return;

    const now = new Date().toISOString();
    const { data, error } = await db
      .from('system_notices')
      .select('id, title, message, starts_at, ends_at')
      .eq('is_active', true)
      .lte('starts_at', now)
      .order('starts_at', { ascending: true });

    if (error) {
      console.error('Could not load system notices:', error);
      return;
    }

    const currentNotices = (data || []).filter((notice) =>
      !notice.ends_at || new Date(notice.ends_at).getTime() > Date.now()
    );

    const dismissalKey = `fye:dismissed-system-notices:${authData.user.id}`;
    let dismissedIds = new Set();
    try {
      dismissedIds = new Set(JSON.parse(localStorage.getItem(dismissalKey) || '[]'));
    } catch (storageError) {
      console.warn('Could not read dismissed notices:', storageError);
    }
    const visibleNotices = currentNotices.filter((notice) => !dismissedIds.has(notice.id));
    main.querySelector('.fye-system-notices')?.remove();
    if (!visibleNotices.length) return;

    const container = document.createElement('section');
    container.className = 'fye-system-notices';
    container.setAttribute('aria-label', 'System notices');

    for (const notice of visibleNotices) {
      const card = document.createElement('article');
      card.className = 'fye-system-notice';

      const dismissButton = document.createElement('button');
      dismissButton.type = 'button';
      dismissButton.className = 'fye-system-notice-dismiss';
      dismissButton.setAttribute('aria-label', `Dismiss notice: ${notice.title}`);
      dismissButton.textContent = '×';
      dismissButton.addEventListener('click', () => {
        dismissedIds.add(notice.id);
        try {
          localStorage.setItem(dismissalKey, JSON.stringify([...dismissedIds]));
        } catch (storageError) {
          console.warn('Could not save dismissed notice:', storageError);
        }
        card.remove();
        if (!container.children.length) container.remove();
      });

      const heading = document.createElement('h2');
      heading.textContent = notice.title;

      const message = document.createElement('p');
      message.textContent = notice.message;

      const period = document.createElement('small');
      period.textContent = notice.ends_at
        ? `Notice period: ${formatDate(notice.starts_at)} to ${formatDate(notice.ends_at)}`
        : `Notice starts: ${formatDate(notice.starts_at)}`;

      card.append(heading, message, period, dismissButton);
      container.appendChild(card);
    }

    const topbar = main.querySelector('.topbar');
    if (topbar) topbar.insertAdjacentElement('afterend', container);
    else main.prepend(container);
  }

  loadNotices();
})();
