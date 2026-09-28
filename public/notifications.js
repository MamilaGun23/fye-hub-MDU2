(() => {
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
    if (countBadge) countBadge.hidden = true;

    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData.user) {
      list.replaceChildren(textElement('p', 'summary-text', 'Sign in again to view your notifications.'));
      return;
    }

    const { data, error } = await db
      .from('event_notifications')
      .select('id, title, message, notification_type, qr_token, scheduled_for, read_at')
      .eq('recipient_id', authData.user.id)
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for', { ascending: false });

    if (error) {
      console.error('Could not load event notifications:', error);
      list.replaceChildren(textElement('p', 'summary-text', `Could not load notifications: ${error.message}`));
      return;
    }

    const notifications = data || [];
    const latestTitle = document.querySelector('#latest-notification-title');
    const latestMessage = document.querySelector('#latest-notification-message');
    if (latestTitle) latestTitle.textContent = notifications[0]?.title || 'You’re all caught up';
    if (latestMessage) {
      latestMessage.textContent = notifications[0]?.message
        || 'Approved event notices and reminders will appear here.';
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
        notification.notification_type.replaceAll('_', ' ')
      ));
      header.appendChild(content);
      if (!notification.read_at) {
        const readButton = textElement('button', 'notification-read-button', 'Mark read');
        readButton.type = 'button';
        readButton.addEventListener('click', async () => {
          readButton.disabled = true;
          const { error: updateError } = await db.rpc('mark_event_notification_read', {
            p_notification_id: notification.id
          });
          if (updateError) {
            console.error('Could not mark notification as read:', updateError);
            readButton.disabled = false;
            return;
          }
          await loadNotifications();
        });
        header.appendChild(readButton);
      }

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
  loadNotifications();
})();
