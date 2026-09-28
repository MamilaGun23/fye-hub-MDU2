(() => {
  const db = window.fyeSupabase;
  if (!db) return;

  const pageName = location.pathname.split('/').pop().toLowerCase();
  const isSupervisorPage = pageName === 'supervisor.html';
  const isMentorPage = pageName === 'mentor.html';
  if (!isSupervisorPage && !isMentorPage) return;

  function makeTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function formatEventTime(request) {
    return `${request.event_date} · ${String(request.event_time).slice(0, 5)} · ${request.venue}`;
  }

  async function getCurrentUser() {
    const { data, error } = await db.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error('Please sign in again to view event requests.');
    return data.user;
  }

  if (isSupervisorPage) {
    const requestList = document.querySelector('#event-request-list');
    const feedback = document.querySelector('#event-request-feedback');
    const refreshButton = document.querySelector('#event-requests-refresh');
    if (!requestList || !feedback || !refreshButton) return;

    async function loadRequests() {
      requestList.replaceChildren(makeTextElement('p', 'summary-text', 'Loading event requests…'));
      feedback.textContent = '';

      const { data: requests, error } = await db
        .from('event_requests')
        .select('id, mentor_id, title, purpose, event_date, event_time, venue, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (error) {
        requestList.replaceChildren(makeTextElement('p', 'summary-text', 'Could not load event requests.'));
        feedback.textContent = `Could not load requests: ${error.message}`;
        return;
      }

      requestList.replaceChildren();
      if (!requests?.length) {
        requestList.appendChild(makeTextElement('article', 'content-panel summary-text', 'No event requests are waiting for review.'));
        return;
      }

      const mentorIds = [...new Set(requests.map((request) => request.mentor_id))];
      const { data: mentors, error: mentorError } = await db
        .from('profiles')
        .select('id, full_name, email')
        .in('id', mentorIds);
      const mentorById = new Map((mentors || []).map((mentor) => [mentor.id, mentor]));
      if (mentorError) console.error('Could not load event request mentors:', mentorError);

      for (const request of requests) {
        const mentor = mentorById.get(request.mentor_id);
        const card = document.createElement('article');
        card.className = 'content-panel event-request-card';
        card.appendChild(makeTextElement('p', 'card-kicker', `REQUESTED BY ${mentor?.full_name || mentor?.email || 'MENTOR'}`));
        card.appendChild(makeTextElement('h3', '', request.title));
        card.appendChild(makeTextElement('p', 'summary-text', formatEventTime(request)));
        card.appendChild(makeTextElement('p', 'event-request-purpose', request.purpose));

        const form = document.createElement('form');
        form.className = 'event-review-form';
        const reasonLabel = makeTextElement('label', '', 'Reason or note for the mentor');
        const reason = document.createElement('textarea');
        reason.rows = 3;
        reason.maxLength = 1000;
        reason.placeholder = 'Required when declining this request';
        reasonLabel.appendChild(reason);
        const actions = document.createElement('div');
        actions.className = 'event-review-actions';

        for (const [decision, label] of [['approved', 'Approve'], ['rejected', 'Decline']]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = decision === 'approved' ? 'form-action' : 'event-decline-button';
          button.textContent = label;
          button.addEventListener('click', () => reviewRequest(request, decision, reason, actions));
          actions.appendChild(button);
        }

        form.append(reasonLabel, actions);
        card.appendChild(form);
        requestList.appendChild(card);
      }
    }

    async function reviewRequest(request, decision, reasonField, actions) {
      const reason = reasonField.value.trim();
      if (decision === 'rejected' && !reason) {
        reasonField.setCustomValidity('Enter a reason so the mentor knows why this event was declined.');
        reasonField.reportValidity();
        return;
      }
      reasonField.setCustomValidity('');
      actions.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      feedback.textContent = decision === 'approved' ? 'Approving event…' : 'Declining event…';

      const { error } = await db.rpc('review_event_request', {
        p_event_id: request.id,
        p_decision: decision,
        p_reason: reason || null
      });

      if (error) {
        console.error('Could not review event request:', error);
        feedback.textContent = `Could not update this request: ${error.message}`;
        actions.querySelectorAll('button').forEach((button) => { button.disabled = false; });
        return;
      }

      feedback.textContent = decision === 'approved'
        ? 'Event approved and added to the shared calendar. Notifications have been sent.'
        : 'Event declined. The mentor has been sent your reason.';
      window.dispatchEvent(new CustomEvent('fye:calendar-refresh'));
      await loadRequests();
    }

    refreshButton.addEventListener('click', loadRequests);
    getCurrentUser()
      .then(() => loadRequests())
      .catch((error) => { feedback.textContent = error.message; });
    return;
  }

  const calendarPage = document.querySelector('.page-view[data-page="calendar"]');
  if (!calendarPage) return;

  const requestPanel = document.createElement('article');
  requestPanel.className = 'content-panel';
  requestPanel.appendChild(makeTextElement('p', 'section-kicker', 'SUPERVISOR REVIEW'));
  requestPanel.appendChild(makeTextElement('h3', '', 'My event requests'));
  const mentorRequestList = document.createElement('div');
  mentorRequestList.id = 'mentor-event-requests';
  mentorRequestList.setAttribute('aria-live', 'polite');
  mentorRequestList.appendChild(makeTextElement('p', 'summary-text', 'Loading your event requests…'));
  requestPanel.appendChild(mentorRequestList);
  const calendarPanel = calendarPage.querySelector('.content-panel');
  if (calendarPanel) calendarPanel.insertAdjacentElement('afterend', requestPanel);
  else calendarPage.appendChild(requestPanel);

  async function loadMentorRequests() {
    mentorRequestList.replaceChildren(makeTextElement('p', 'summary-text', 'Loading your event requests…'));
    try {
      const user = await getCurrentUser();
      const { data: requests, error } = await db
        .from('event_requests')
        .select('id, title, purpose, event_date, event_time, venue, status, supervisor_note, created_at')
        .eq('mentor_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      mentorRequestList.replaceChildren();
      if (!requests?.length) {
        mentorRequestList.appendChild(makeTextElement('p', 'summary-text', 'You have not submitted any event requests yet.'));
        return;
      }

      for (const request of requests) {
        const card = document.createElement('article');
        card.className = 'mentor-event-request';
        card.appendChild(makeTextElement('h4', '', request.title));
        card.appendChild(makeTextElement('p', 'summary-text', formatEventTime(request)));
        card.appendChild(makeTextElement('p', 'summary-text', request.purpose));
        const status = makeTextElement('span', `event-request-status status-${request.status}`, request.status);
        card.appendChild(status);
        if (request.supervisor_note) {
          card.appendChild(makeTextElement(
            'p',
            request.status === 'rejected' ? 'event-decline-reason' : 'summary-text',
            request.status === 'rejected'
              ? `Reason from supervisor: ${request.supervisor_note}`
              : `Supervisor note: ${request.supervisor_note}`
          ));
        }
        if (request.status === 'approved') {
          card.appendChild(makeTextElement('p', 'summary-text', 'Your QR code has been sent to your notifications.'));
        }
        mentorRequestList.appendChild(card);
      }
    } catch (error) {
      console.error('Could not load mentor event requests:', error);
      mentorRequestList.replaceChildren(makeTextElement('p', 'summary-text', `Could not load your event requests: ${error.message}`));
    }
  }

  window.addEventListener('fye:event-request-created', loadMentorRequests);
  loadMentorRequests();
})();
