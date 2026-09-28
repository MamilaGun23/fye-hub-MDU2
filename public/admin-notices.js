(() => {
  const db = window.fyeSupabase;
  const form = document.querySelector('#notice-form');
  if (!db || !form) return;

  const feedback = document.querySelector('#notice-feedback');
  const noticeList = document.querySelector('#notice-list');

  function localDateTimeValue(date) {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 16);
  }

  function displayDate(value) {
    if (!value) return 'No end date';
    return new Intl.DateTimeFormat('en-ZA', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  function noticeStatus(notice) {
    const now = Date.now();
    if (!notice.is_active) return 'Stopped';
    if (new Date(notice.starts_at).getTime() > now) return 'Scheduled';
    if (notice.ends_at && new Date(notice.ends_at).getTime() <= now) return 'Expired';
    return 'Showing';
  }

  async function loadNotices() {
    noticeList.innerHTML = '<tr><td colspan="4">Loading notices…</td></tr>';

    const { data, error } = await db
      .from('system_notices')
      .select('id, title, starts_at, ends_at, is_active')
      .order('starts_at', { ascending: false });

    if (error) {
      console.error('Could not load notices:', error);
      noticeList.innerHTML = '<tr><td colspan="4">Notice list unavailable.</td></tr>';
      feedback.textContent = `Could not load notices: ${error.message}`;
      return;
    }

    noticeList.replaceChildren();
    if (!data?.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.textContent = 'No notices have been published yet.';
      row.appendChild(cell);
      noticeList.appendChild(row);
      return;
    }

    for (const notice of data) {
      const row = document.createElement('tr');
      const titleCell = document.createElement('td');
      titleCell.textContent = notice.title;
      row.appendChild(titleCell);

      const periodCell = document.createElement('td');
      periodCell.textContent = `${displayDate(notice.starts_at)} – ${displayDate(notice.ends_at)}`;
      row.appendChild(periodCell);

      const statusCell = document.createElement('td');
      statusCell.textContent = noticeStatus(notice);
      row.appendChild(statusCell);

      const actionCell = document.createElement('td');
      if (notice.is_active) {
        const stopButton = document.createElement('button');
        stopButton.type = 'button';
        stopButton.className = 'notice-stop-button';
        stopButton.textContent = 'Stop notice';
        stopButton.addEventListener('click', () => stopNotice(notice.id, stopButton));
        actionCell.appendChild(stopButton);
      } else {
        actionCell.textContent = '—';
      }

      row.appendChild(actionCell);
      noticeList.appendChild(row);
    }
  }

  async function stopNotice(id, button) {
    button.disabled = true;
    feedback.textContent = 'Stopping notice…';

    const { error } = await db
      .from('system_notices')
      .update({ is_active: false })
      .eq('id', id);

    if (error) {
      console.error('Could not stop notice:', error);
      feedback.textContent = `Could not stop notice: ${error.message}`;
      button.disabled = false;
      return;
    }

    feedback.textContent = 'Notice stopped.';
    await loadNotices();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.textContent = '';

    const title = document.querySelector('#notice-title').value.trim();
    const message = document.querySelector('#notice-message').value.trim();
    const startsValue = document.querySelector('#notice-starts-at').value;
    const endsValue = document.querySelector('#notice-ends-at').value;
    const button = form.querySelector('button[type="submit"]');

    const startsAt = startsValue ? new Date(startsValue) : null;
    const endsAt = endsValue ? new Date(endsValue) : null;
    if (!startsAt || Number.isNaN(startsAt.getTime())) {
      feedback.textContent = 'Choose when the notice should start.';
      return;
    }
    if (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt)) {
      feedback.textContent = 'The stop time must be later than the start time.';
      return;
    }

    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData.user) {
      feedback.textContent = 'Your session has ended. Please sign in again.';
      return;
    }

    button.disabled = true;
    button.textContent = 'Publishing…';
    feedback.textContent = 'Publishing notice…';

    const { error } = await db.from('system_notices').insert({
      title,
      message,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt ? endsAt.toISOString() : null,
      is_active: true,
      created_by: authData.user.id
    });

    if (error) {
      console.error('Could not publish notice:', error);
      feedback.textContent = `Could not publish notice: ${error.message}`;
    } else {
      feedback.textContent = 'Notice published or scheduled successfully.';
      form.reset();
      document.querySelector('#notice-starts-at').value = localDateTimeValue(new Date());
      await loadNotices();
    }

    button.disabled = false;
    button.textContent = 'Publish notice';
  });

  document.querySelector('#notices-refresh').addEventListener('click', loadNotices);

  const style = document.createElement('style');
  style.textContent = `
    #notice-form textarea{box-sizing:border-box;width:100%;resize:vertical}
    .notice-stop-button{border:0;border-radius:8px;padding:8px 10px;color:#8e3838;background:#fbeaea;font:inherit;cursor:pointer}
    .notice-stop-button:disabled{opacity:.6;cursor:wait}
  `;
  document.head.appendChild(style);

  async function init() {
    document.querySelector('#notice-starts-at').value = localDateTimeValue(new Date());
    await loadNotices();
  }

  init();
})();
