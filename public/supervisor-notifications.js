(() => {
  const db = window.fyeSupabase;
  const list = document.querySelector('#supervisor-notification-list');
  const badge = document.querySelector('#supervisor-notification-count');
  const feedback = document.querySelector('#supervisor-notifications-feedback');
  const refreshButton = document.querySelector('#supervisor-notifications-refresh');
  if (!db || !list) return;

  function textElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function openRelatedView(view) {
    document.querySelector(`.nav-link[data-view="${view}"]`)?.click();
  }

  async function loadNotifications() {
    list.replaceChildren(textElement('p', 'summary-text', 'Loading notifications…'));
    feedback.textContent = '';
    if (badge) badge.hidden = true;

    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData.user) {
      list.replaceChildren(textElement('p', 'summary-text', 'Sign in again to view supervisor notifications.'));
      return;
    }

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (profileError || profile?.role !== 'supervisor') {
      list.replaceChildren(textElement('p', 'summary-text', 'Only supervisors can view this inbox.'));
      return;
    }

    const { data: notifications, error } = await db
      .from('supervisor_notifications')
      .select('id, notification_type, subject_id, title, message, created_at, read_at')
      .eq('recipient_id', authData.user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Could not load supervisor notifications:', error);
      list.replaceChildren(textElement('p', 'summary-text', 'Supervisor notifications are unavailable.'));
      feedback.textContent = error.code === 'PGRST205'
        ? 'Apply database/20261004000000_supervisor_notifications.sql in Supabase, then refresh the schema cache.'
        : `Could not load notifications: ${error.message}`;
      return;
    }

    const items = notifications || [];
    const unreadCount = items.filter((item) => !item.read_at).length;
    if (badge) {
      badge.textContent = String(unreadCount);
      badge.hidden = unreadCount === 0;
    }

    list.replaceChildren();
    if (!items.length) {
      const emptyState = document.createElement('article');
      emptyState.className = 'content-panel';
      emptyState.appendChild(textElement('p', 'summary-text', 'You are all caught up. New event requests, mentor applications, and admin notices will appear here.'));
      list.appendChild(emptyState);
      return;
    }

    for (const notification of items) {
      const card = document.createElement('article');
      card.className = `content-panel supervisor-notification${notification.read_at ? ' is-read' : ' is-unread'}`;
      const header = document.createElement('div');
      header.className = 'notification-card-header';
      const heading = document.createElement('div');
      heading.appendChild(textElement('h3', '', notification.title));
      heading.appendChild(textElement(
        'p',
        'notification-kind',
        notification.notification_type.replaceAll('_', ' ')
      ));
      header.appendChild(heading);

      if (!notification.read_at) {
        const markReadButton = textElement('button', 'notification-read-button', 'Mark read');
        markReadButton.type = 'button';
        markReadButton.addEventListener('click', async () => {
          markReadButton.disabled = true;
          const { error: updateError } = await db.rpc('mark_supervisor_notification_read', {
            p_notification_id: notification.id
          });
          if (updateError) {
            feedback.textContent = `Could not mark notification as read: ${updateError.message}`;
            markReadButton.disabled = false;
            return;
          }
          await loadNotifications();
        });
        header.appendChild(markReadButton);
      }

      card.appendChild(header);
      card.appendChild(textElement('p', 'summary-text', notification.message));
      card.appendChild(textElement(
        'small',
        'notification-date',
        new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
          .format(new Date(notification.created_at))
      ));

      const targetView = notification.notification_type === 'mentor_application'
        ? 'mentor-applications'
        : notification.notification_type === 'event_request'
          ? 'event-requests'
          : null;
      if (targetView) {
        const action = textElement('button', 'text-button', targetView === 'mentor-applications'
          ? 'Review application'
          : 'Review event request');
        action.type = 'button';
        action.appendChild(textElement('span', 'button-arrow', '→'));
        action.lastElementChild.setAttribute('aria-hidden', 'true');
        action.addEventListener('click', () => openRelatedView(targetView));
        card.appendChild(action);
      }

      list.appendChild(card);
    }
  }

  refreshButton?.addEventListener('click', loadNotifications);
  document.querySelector('.nav-link[data-view="supervisor-notifications"]')
    ?.addEventListener('click', loadNotifications);
  window.addEventListener('fye:supervisor-notifications-refresh', loadNotifications);
  window.setInterval(loadNotifications, 60000);
  loadNotifications();
})();