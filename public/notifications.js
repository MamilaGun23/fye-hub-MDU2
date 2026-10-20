(async () => {
  if (window.fyeAuth && !(await window.fyeAuth.ready)) return;
  const db = window.fyeSupabase;
  const list = document.querySelector('#notification-list');
  if (!db || !list) return;

  const countBadge = document.querySelector('#notification-count');
  const refreshButton = document.querySelector('#notifications-refresh');

  function textElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function eventAttendanceUrl(token) {
    const url = new URL('event-attendance.html', location.href);
    url.searchParams.set('token', token);
    return url.href;
  }

  async function loadNotifications() {
    list.replaceChildren(textElement('p', 'summary-text', 'Loading notifications…'));
    const feedback = document.querySelector('#notification-feedback');
    if (feedback) feedback.textContent = '';
    if (countBadge) countBadge.hidden = true;

    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData.user) {
      list.replaceChildren(textElement('p', 'summary-text', 'Sign in again to view your notifications.'));
      return;
    }

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('is_active')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (profileError || profile?.is_active === false) {
      await db.auth.signOut();
      list.replaceChildren(textElement('p', 'summary-text', 'This account is disabled. Contact your FYE administrator.'));
      return;
    }

    const now = new Date().toISOString();
    const [eventResult, noticeResult] = await Promise.all([
      db.from('event_notifications')
        .select('id, title, message, notification_type, qr_token, scheduled_for, read_at')
        .eq('recipient_id', authData.user.id)
        .lte('scheduled_for', now)
        .order('scheduled_for', { ascending: false }),
      db.from('system_notice_notifications')
        .select('id, title, message, scheduled_for, read_at')
        .eq('recipient_id', authData.user.id)
        .lte('scheduled_for', now)
        .order('scheduled_for', { ascending: false })
    ]);

    if (eventResult.error || (noticeResult.error && noticeResult.error.code !== 'PGRST205')) {
      const error = eventResult.error || noticeResult.error;
      console.error('Could not load notifications:', error);
      list.replaceChildren(textElement('p', 'summary-text', `Could not load notifications: ${error.message}`));
      return;
    }

    const notifications = [
      ...(eventResult.data || []).map((item) => ({ ...item, source: 'event' })),
      ...(noticeResult.data || []).map((item) => ({
        ...item,
        source: 'system_notice',
        notification_type: 'admin_notice',
        qr_token: null
      }))
    ].sort((left, right) => new Date(right.scheduled_for) - new Date(left.scheduled_for));
    const latestTitle = document.querySelector('#latest-notification-title');
    const latestMessage = document.querySelector('#latest-notification-message');
    if (latestTitle) latestTitle.textContent = notifications[0]?.title || 'You’re all caught up';
    if (latestMessage) {
      latestMessage.textContent = notifications[0]?.message
        || 'Updates, event information, and reminders will appear here.';
    }
    const unreadCount = notifications.filter((item) => !item.read_at).length;
    if (countBadge) {
      countBadge.textContent = String(unreadCount);
      countBadge.hidden = unreadCount === 0;
    }

    list.replaceChildren();
    if (!notifications.length) {
      list.appendChild(textElement('p', 'summary-text', 'You are all caught up. New event updates will appear here.'));
      return;
    }

    for (const notification of notifications) {
      const card = document.createElement('article');
      card.className = `notification-card${notification.read_at ? ' is-read' : ' is-unread'}`;
      const header = document.createElement('div');
      header.className = 'notification-card-header';
      const content = document.createElement('div');
      content.appendChild(textElement('h3', '', notification.title));
      content.appendChild(textElement(
        'p',
        'notification-kind',
        notification.source === 'system_notice'
          ? 'Update'
          : notification.notification_type.replaceAll('_', ' ')
      ));
      header.appendChild(content);
      const readButton = textElement(
        'button',
        'notification-read-button',
        notification.read_at ? 'Mark unread' : 'Mark read'
      );
      readButton.type = 'button';
      readButton.addEventListener('click', async () => {
        readButton.disabled = true;
        const willBeRead = !notification.read_at;
        if (willBeRead) {
          card.classList.add('is-read');
          card.classList.remove('is-unread');
          readButton.textContent = 'Mark unread';
        } else {
          card.classList.remove('is-read');
          card.classList.add('is-unread');
          readButton.textContent = 'Mark read';
        }
        const prefix = notification.source === 'system_notice'
          ? 'system_notice'
          : 'event';
        const action = notification.read_at ? 'unread' : 'read';
        const rpcName = `mark_${prefix}_notification_${action}`;
        let { error: updateError } = await db.rpc(rpcName, {
          p_notification_id: notification.id
        });
        if (updateError && (updateError.code === 'PGRST202' || updateError.message?.includes('schema cache') || updateError.message?.includes('function'))) {
          const tableName = notification.source === 'system_notice'
            ? 'system_notice_notifications'
            : 'event_notifications';
          const { error: tableError } = await db
            .from(tableName)
            .update({ read_at: notification.read_at ? null : new Date().toISOString() })
            .eq('id', notification.id);
          updateError = tableError;
        }
        if (updateError) {
          console.error('Could not update notification read state:', updateError);
          if (willBeRead) {
            card.classList.remove('is-read');
            card.classList.add('is-unread');
            readButton.textContent = 'Mark read';
          } else {
            card.classList.add('is-read');
            card.classList.remove('is-unread');
            readButton.textContent = 'Mark unread';
          }
          const feedback = document.querySelector('#notification-feedback');
          if (feedback) feedback.textContent = `Could not update notification: ${updateError.message}`;
          readButton.disabled = false;
          return;
        }
        await loadNotifications();
      });
      header.appendChild(readButton);

      card.appendChild(header);
      card.appendChild(textElement('p', 'summary-text', notification.message));
      card.appendChild(textElement(
        'small',
        'notification-date',
        new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
          .format(new Date(notification.scheduled_for))
      ));

      if (notification.qr_token) {
        const attendanceUrl = eventAttendanceUrl(notification.qr_token);
        const qrPanel = document.createElement('div');
        qrPanel.className = 'notification-qr-panel';
        const qrCode = document.createElement('div');
        qrCode.className = 'notification-qr-code';
        qrCode.setAttribute('aria-label', 'Approved event attendance QR code');
        const qrDetails = document.createElement('div');
        qrDetails.appendChild(textElement('h4', '', 'Approved event attendance QR'));
        qrDetails.appendChild(textElement('p', 'summary-text', 'Share this code with students so they can record attendance.'));
        if (window.QRCode) {
          new window.QRCode(qrCode, {
            text: attendanceUrl,
            width: 160,
            height: 160,
            colorDark: '#1a2a6c',
            colorLight: '#ffffff',
            correctLevel: window.QRCode.CorrectLevel.M
          });
        } else {
          qrDetails.appendChild(textElement('p', 'summary-text', 'QR rendering is unavailable. Share the attendance link instead.'));
        }
        const link = document.createElement('a');
        link.href = attendanceUrl;
        link.textContent = 'Open attendance page';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        qrDetails.appendChild(link);
        qrPanel.append(qrCode, qrDetails);
        card.appendChild(qrPanel);
      }
      list.appendChild(card);
    }
  }

  refreshButton?.addEventListener('click', loadNotifications);
  window.setInterval(loadNotifications, 60000);
  window.addEventListener('focus', loadNotifications);
  window.addEventListener('fye:notifications-refresh', loadNotifications);
  loadNotifications();
})();
