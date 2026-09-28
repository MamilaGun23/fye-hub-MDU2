(() => {
  const db = window.fyeSupabase;
  const main = document.querySelector('.main-content');
  if (!db || !main) return;

  const style = document.createElement('style');
  style.textContent = `
    .fye-system-notices{display:grid;gap:10px;margin:16px 0 20px}
    .fye-system-notice{padding:16px 18px;border:1px solid #e6bd60;border-left:5px solid #d89b28;border-radius:12px;background:#fff8e6;color:#533d13}
    .fye-system-notice h2{margin:0 0 6px;font-size:1rem;color:#533d13}
    .fye-system-notice p{margin:0;line-height:1.5}
    .fye-system-notice small{display:block;margin-top:8px;color:#786642}
  `;
  document.head.appendChild(style);

  function formatDate(value) {
    return new Intl.DateTimeFormat('en-ZA', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  async function loadNotices() {
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

    if (!currentNotices.length) return;

    const container = document.createElement('section');
    container.className = 'fye-system-notices';
    container.setAttribute('aria-label', 'System notices');

    for (const notice of currentNotices) {
      const card = document.createElement('article');
      card.className = 'fye-system-notice';

      const heading = document.createElement('h2');
      heading.textContent = notice.title;

      const message = document.createElement('p');
      message.textContent = notice.message;

      const period = document.createElement('small');
      period.textContent = notice.ends_at
        ? `Notice period: ${formatDate(notice.starts_at)} to ${formatDate(notice.ends_at)}`
        : `Notice starts: ${formatDate(notice.starts_at)}`;

      card.append(heading, message, period);
      container.appendChild(card);
    }

    const topbar = main.querySelector('.topbar');
    if (topbar) topbar.insertAdjacentElement('afterend', container);
    else main.prepend(container);
  }

  loadNotices();
})();
