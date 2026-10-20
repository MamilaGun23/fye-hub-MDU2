(async () => {
  if (window.fyeAuth && !(await window.fyeAuth.ready)) return;
  const db = window.fyeSupabase;
  const list = document.querySelector('#supervisor-notification-list');
  const badge = document.querySelector('#supervisor-notification-count');
  const feedback = document.querySelector('#supervisor-notifications-feedback');
  const refreshButton = document.querySelector('#supervisor-notifications-refresh');
  const readAllButton = document.querySelector('#supervisor-notifications-read-all');
  if (!db || !list) return;
  let markingAll = false;
  let loadVersion = 0;

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
    if (markingAll) return;
    const version = ++loadVersion;
    if (readAllButton) readAllButton.disabled = true;
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
      .select('role, is_active')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (profileError || profile?.role !== 'supervisor' || profile.is_active === false) {
      list.replaceChildren(textElement('p', 'summary-text', 'Only supervisors can view this inbox.'));
      return;
    }

    const { error: alertError } = await db.rpc('refresh_mentor_contact_alerts');
    if (alertError) {
      console.error('Could not refresh overdue mentor contact alerts:', alertError);
      feedback.textContent = `Could not refresh mentor contact alerts: ${alertError.message}`;
    }

    const [inboxResult, countResult] = await Promise.all([
      db.from('supervisor_notifications')
        .select('id, notification_type, subject_id, title, message, created_at, read_at')
        .eq('recipient_id', authData.user.id)
        .order('created_at', { ascending: false })
        .limit(100),
      db.from('supervisor_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', authData.user.id)
        .is('read_at', null)
    ]);
    if (version !== loadVersion) return;
    const { data: notifications, error } = inboxResult;

    if (error) {
      console.error('Could not load supervisor notifications:', error);
      list.replaceChildren(textElement('p', 'summary-text', 'Supervisor notifications are unavailable.'));
      feedback.textContent = error.code === 'PGRST205'
        ? 'Apply database/20261004000000_supervisor_notifications.sql in Supabase, then refresh the schema cache.'
        : `Could not load notifications: ${error.message}`;
      return;
    }

    const items = notifications || [];
    const unreadCount = countResult.error ? items.filter((item) => !item.read_at).length : countResult.count || 0;
    if (countResult.error) feedback.textContent = `Unread total unavailable: ${countResult.error.message}`;
    if (readAllButton) readAllButton.disabled = !countResult.error && unreadCount === 0;
    if (badge) {
      badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      badge.setAttribute('aria-label', `${unreadCount} unread notifications${countResult.error ? ' in the latest 100 notifications' : ''}`);
      badge.hidden = unreadCount === 0;
    }
    if (items.length === 100 && !feedback.textContent) {
      feedback.textContent = 'Showing the latest 100 notifications. Mark all as read includes older notifications.';
    }

    list.replaceChildren();
    if (!items.length) {
      const emptyState = document.createElement('article');
      emptyState.className = 'content-panel';
      emptyState.appendChild(textElement('p', 'summary-text', 'You are all caught up. New event requests, mentor applications, updates, and overdue contact alerts will appear here.'));
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
        notification.notification_type === 'admin_notice'
          ? 'Update'
          : notification.notification_type.replaceAll('_', ' ')
      ));
      header.appendChild(heading);

      const markReadButton = textElement(
        'button',
        'notification-read-button',
        notification.read_at ? 'Mark unread' : 'Mark read'
      );
      markReadButton.type = 'button';
      markReadButton.addEventListener('click', async () => {
        markReadButton.disabled = true;
        const willBeRead = !notification.read_at;
        if (willBeRead) {
          card.classList.add('is-read');
          card.classList.remove('is-unread');
          markReadButton.textContent = 'Mark unread';
        } else {
          card.classList.remove('is-read');
          card.classList.add('is-unread');
          markReadButton.textContent = 'Mark read';
        }
        const rpcName = notification.read_at
          ? 'mark_supervisor_notification_unread'
          : 'mark_supervisor_notification_read';
        let { error: updateError } = await db.rpc(rpcName, {
          p_notification_id: notification.id
        });
        if (updateError && (updateError.code === 'PGRST202' || updateError.message?.includes('schema cache') || updateError.message?.includes('function'))) {
          const { error: tableError } = await db
            .from('supervisor_notifications')
            .update({ read_at: notification.read_at ? null : new Date().toISOString() })
            .eq('id', notification.id);
          updateError = tableError;
        }
        if (updateError) {
          if (willBeRead) {
            card.classList.remove('is-read');
            card.classList.add('is-unread');
            markReadButton.textContent = 'Mark read';
          } else {
            card.classList.add('is-read');
            card.classList.remove('is-unread');
            markReadButton.textContent = 'Mark unread';
          }
          feedback.textContent = `Could not update notification: ${updateError.message}`;
          markReadButton.disabled = false;
          return;
        }
        await loadNotifications();
      });
      header.appendChild(markReadButton);

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
          : notification.notification_type === 'mentor_contact_overdue'
            ? 'students'
          : null;
      if (targetView) {
        const action = textElement('button', 'text-button', targetView === 'mentor-applications'
          ? 'Review application'
          : targetView === 'students' ? 'View students' : 'Review event request');
        action.type = 'button';
        action.appendChild(textElement('span', 'button-arrow', '→'));
        action.lastElementChild.setAttribute('aria-hidden', 'true');
        action.addEventListener('click', () => openRelatedView(targetView));
        card.appendChild(action);
      }

      list.appendChild(card);
    }
  }

  readAllButton?.addEventListener('click', async () => {
    if (markingAll || readAllButton.disabled) return;
    markingAll = true;
    ++loadVersion;
    readAllButton.disabled = true;
    refreshButton.disabled = true;
    list.querySelectorAll('.notification-read-button').forEach((button) => { button.disabled = true; });
    feedback.textContent = 'Marking all notifications as read…';
    try {
      const { error } = await db.rpc('mark_all_supervisor_notifications_read');
      if (error) throw error;
      markingAll = false;
      await loadNotifications();
    } catch (error) {
      feedback.textContent = error.code === 'PGRST202'
        ? 'Mark all as read is not enabled yet. Ask your administrator to enable it, then refresh.'
        : `Could not mark all notifications as read: ${error.message}`;
      readAllButton.disabled = false;
      list.querySelectorAll('.notification-read-button').forEach((button) => { button.disabled = false; });
    } finally {
      markingAll = false;
      refreshButton.disabled = false;
    }
  });

  refreshButton?.addEventListener('click', loadNotifications);
  document.querySelector('.nav-link[data-view="supervisor-notifications"]')
    ?.addEventListener('click', loadNotifications);
  window.addEventListener('fye:supervisor-notifications-refresh', loadNotifications);
  window.setInterval(loadNotifications, 60000);
  loadNotifications();
})();
