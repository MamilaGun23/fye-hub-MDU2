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

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('is_active')
      .eq('id', data.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (profile?.is_active === false) {
      await db.auth.signOut();
      window.location.replace('index.html');
      throw new Error('This account is disabled. Contact your FYE administrator.');
    }

    return data.user;
  }

  if (isSupervisorPage) {
    const requestList = document.querySelector('#event-request-list');
    const feedback = document.querySelector('#event-request-feedback');
    const refreshButton = document.querySelector('#event-requests-refresh');
    const eventList = document.querySelector('#supervisor-event-list');
    const statusFilter = document.querySelector('#event-status-filter');
    if (!requestList || !feedback || !refreshButton || !eventList || !statusFilter) return;

    let publishedEvents = [];

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

    function inputLabel(text, input) {
      const label = makeTextElement('label', '', text);
      label.appendChild(input);
      return label;
    }

    function localDateTime(value) {
      const date = new Date(value);
      const pad = (part) => String(part).padStart(2, '0');
      return {
        date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        time: `${pad(date.getHours())}:${pad(date.getMinutes())}`
      };
    }

    function renderPublishedEvents(attendanceByEvent, profilesById, activityByEvent) {
      eventList.replaceChildren();
      const selectedStatus = statusFilter.value;
      const visibleEvents = publishedEvents.filter((event) =>
        selectedStatus === 'all' || event.event_status === selectedStatus
      );
      if (!visibleEvents.length) {
        eventList.appendChild(makeTextElement('article', 'content-panel summary-text', 'No events match this status.'));
        return;
      }

      for (const event of visibleEvents) {
        const attendance = attendanceByEvent.get(event.id) || [];
        const validAttendance = attendance.filter((record) => record.is_valid);
        const organizer = profilesById.get(event.organizer_id);
        const card = document.createElement('article');
        card.className = 'content-panel event-request-card';

        const heading = document.createElement('div');
        heading.className = 'event-management-heading';
        heading.append(
          makeTextElement('h3', '', event.title),
          makeTextElement('span', `event-request-status status-${event.event_status}`, event.event_status)
        );
        card.appendChild(heading);
        card.appendChild(makeTextElement('p', 'summary-text', `${new Date(event.starts_at).toLocaleString('en-ZA')} · ${event.location || 'Venue not set'}`));
        card.appendChild(makeTextElement('p', 'event-request-purpose', event.description || 'No event purpose provided.'));
        card.appendChild(makeTextElement('p', 'summary-text', `Organiser: ${organizer?.full_name || organizer?.email || 'Supervisor'} · ${validAttendance.length} checked in`));
        card.appendChild(makeTextElement('p', 'card-kicker', event.organizer_id && event.organizer_id !== event.created_by ? 'MENTOR REQUEST' : 'SUPERVISOR-CREATED'));

        if (event.completion_note) {
          card.appendChild(makeTextElement('p', 'summary-text', `Supervisor close-out: ${event.completion_note}`));
        }
        if (event.mentor_outcome) {
          card.appendChild(makeTextElement('p', 'summary-text', `Mentor outcome: ${event.mentor_outcome}`));
        }
        if (event.cancellation_reason) {
          card.appendChild(makeTextElement('p', 'event-decline-reason', `Cancellation reason: ${event.cancellation_reason}`));
        }

        if (event.attendance_token && event.event_status === 'scheduled') {
          const attendanceUrl = new URL('event-attendance.html', location.href);
          attendanceUrl.searchParams.set('token', event.attendance_token);
          const link = document.createElement('a');
          link.href = attendanceUrl.href;
          link.textContent = 'Open attendance check-in';
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          card.appendChild(link);
          if (window.QRCode) {
            const qrPanel = document.createElement('div');
            qrPanel.className = 'notification-qr-panel';
            const qr = document.createElement('div');
            qr.className = 'notification-qr-code';
            new window.QRCode(qr, {
              text: attendanceUrl.href,
              width: 144,
              height: 144,
              colorDark: '#1a2a6c',
              colorLight: '#ffffff',
              correctLevel: window.QRCode.CorrectLevel.M
            });
            qrPanel.appendChild(qr);
            qrPanel.appendChild(makeTextElement('p', 'summary-text', 'Attendance QR code'));
            card.appendChild(qrPanel);
          }
        }

        const actionRow = document.createElement('div');
        actionRow.className = 'event-review-actions';
        if (event.event_status === 'scheduled') {
          const editDetails = document.createElement('details');
          editDetails.className = 'event-edit-details';
          const editSummary = document.createElement('summary');
          editSummary.textContent = 'Edit event details';
          editDetails.appendChild(editSummary);

          const completeButton = makeTextElement('button', 'form-action', 'Mark complete');
          completeButton.type = 'button';
          actionRow.appendChild(completeButton);
          const cancelButton = makeTextElement('button', 'event-decline-button', 'Cancel event');
          cancelButton.type = 'button';
          actionRow.appendChild(cancelButton);

          const editForm = document.createElement('form');
          editForm.className = 'event-review-form event-edit-form';
          const start = localDateTime(event.starts_at);
          const end = localDateTime(event.ends_at);
          const titleInput = document.createElement('input');
          titleInput.required = true;
          titleInput.maxLength = 200;
          titleInput.value = event.title;
          const descriptionInput = document.createElement('textarea');
          descriptionInput.required = true;
          descriptionInput.rows = 3;
          descriptionInput.value = event.description || '';
          const dateInput = document.createElement('input');
          dateInput.type = 'date';
          dateInput.required = true;
          dateInput.value = start.date;
          const startInput = document.createElement('input');
          startInput.type = 'time';
          startInput.required = true;
          startInput.value = start.time;
          const endInput = document.createElement('input');
          endInput.type = 'time';
          endInput.value = end.time;
          const venueInput = document.createElement('input');
          venueInput.required = true;
          venueInput.maxLength = 200;
          venueInput.value = event.location || '';
          const changeReasonInput = document.createElement('textarea');
          changeReasonInput.required = true;
          changeReasonInput.maxLength = 1000;
          changeReasonInput.rows = 2;
          changeReasonInput.placeholder = 'Reason for changing this event';
          const saveButton = makeTextElement('button', 'form-action', 'Save event changes');
          saveButton.type = 'submit';
          editForm.append(
            inputLabel('Title', titleInput),
            inputLabel('Purpose', descriptionInput),
            inputLabel('Date', dateInput),
            inputLabel('Start time', startInput),
            inputLabel('End time', endInput),
            inputLabel('Venue', venueInput),
            inputLabel('Change reason', changeReasonInput),
            saveButton
          );
          editDetails.appendChild(editForm);
          editForm.addEventListener('submit', async (submitEvent) => {
            submitEvent.preventDefault();
            saveButton.disabled = true;
            const startsAt = new Date(`${dateInput.value}T${startInput.value}`).toISOString();
            const endsAt = endInput.value
              ? new Date(`${dateInput.value}T${endInput.value}`).toISOString()
              : null;
            const { error } = await db.rpc('update_supervisor_event', {
              p_event_id: event.id,
              p_title: titleInput.value.trim(),
              p_description: descriptionInput.value.trim(),
              p_starts_at: startsAt,
              p_ends_at: endsAt,
              p_venue: venueInput.value.trim(),
              p_change_reason: changeReasonInput.value.trim()
            });
            saveButton.disabled = false;
            if (error) {
              feedback.textContent = `Could not update this event: ${error.message}`;
              return;
            }
            feedback.textContent = 'Event updated. Students and the mentor have been notified.';
            await loadPublishedEvents();
          });
          actionRow.appendChild(editDetails);

          cancelButton.addEventListener('click', async () => {
            const reason = window.prompt('Why is this event being cancelled?');
            if (!reason?.trim()) return;
            cancelButton.disabled = true;
            const { error } = await db.rpc('cancel_supervisor_event', {
              p_event_id: event.id,
              p_reason: reason.trim()
            });
            if (error) {
              feedback.textContent = `Could not cancel this event: ${error.message}`;
              cancelButton.disabled = false;
              return;
            }
            feedback.textContent = 'Event cancelled. Students and the mentor have been notified.';
            await loadPublishedEvents();
          });

          completeButton.addEventListener('click', async () => {
            const note = window.prompt('Optional event outcome or follow-up note:') || '';
            completeButton.disabled = true;
            const { error } = await db.rpc('complete_supervisor_event', {
              p_event_id: event.id,
              p_note: note.trim() || null
            });
            if (error) {
              feedback.textContent = `Could not complete this event: ${error.message}`;
              completeButton.disabled = false;
              return;
            }
            feedback.textContent = 'Event marked complete.';
            await loadPublishedEvents();
          });
        }

        card.appendChild(actionRow);
        const attendanceSection = document.createElement('section');
        attendanceSection.className = 'event-attendance-section';
        attendanceSection.appendChild(makeTextElement('h4', '', `Attendance (${validAttendance.length})`));
        const exportButton = makeTextElement('button', 'form-action', 'Export attendance CSV');
        exportButton.type = 'button';
        exportButton.disabled = validAttendance.length === 0;
        exportButton.addEventListener('click', () => {
          const rows = [
            ['Name', 'Email', 'Checked in at', 'Method'],
            ...validAttendance.map((record) => {
              const student = profilesById.get(record.attendee_id);
              return [
                student?.full_name || '',
                student?.email || '',
                record.checked_in_at,
                record.attendance_method
              ];
            })
          ];
          const csv = rows.map((row) => row
            .map((value) => {
              const cell = String(value).replace(/[\r\n\t]/g, ' ');
              const safeCell = /^[=+\-@]/.test(cell) ? `'${cell}` : cell;
              return `"${safeCell.replaceAll('"', '""')}"`;
            })
            .join(',')).join('\r\n');
          const file = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const downloadUrl = URL.createObjectURL(file);
          const download = document.createElement('a');
          download.href = downloadUrl;
          download.download = `${event.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'event'}-attendance.csv`;
          download.click();
          URL.revokeObjectURL(downloadUrl);
        });
        attendanceSection.appendChild(exportButton);
        const attendeeList = document.createElement('div');
        attendeeList.className = 'event-attendee-list';
        if (!attendance.length) {
          attendeeList.appendChild(makeTextElement('p', 'summary-text', 'No check-ins recorded yet.'));
        }
        for (const record of attendance) {
          const attendee = profilesById.get(record.attendee_id);
          const row = document.createElement('div');
          row.className = `event-attendee-row${record.is_valid ? '' : ' is-invalid'}`;
          const name = attendee?.full_name || attendee?.email || 'Student';
          const checkedAt = new Date(record.checked_in_at).toLocaleString('en-ZA');
          row.appendChild(makeTextElement('span', '', `${name} · ${checkedAt} · ${record.attendance_method}`));
          if (record.correction_reason) {
            row.appendChild(makeTextElement('span', 'summary-text', `Reason: ${record.correction_reason}`));
          }
          if (!record.is_valid) {
            row.appendChild(makeTextElement('span', 'event-decline-reason', `Removed: ${record.invalidation_reason || 'No reason recorded'}`));
          } else {
            const correctButton = makeTextElement('button', 'event-decline-button', 'Correct record');
            correctButton.type = 'button';
            correctButton.addEventListener('click', async () => {
              const reason = window.prompt(`Why should ${name}'s attendance be removed?`);
              if (!reason?.trim()) return;
              correctButton.disabled = true;
              const { error } = await db.rpc('invalidate_event_attendance', {
                p_event_id: event.id,
                p_attendee_id: record.attendee_id,
                p_reason: reason.trim()
              });
              if (error) {
                feedback.textContent = `Could not correct attendance: ${error.message}`;
                correctButton.disabled = false;
                return;
              }
              feedback.textContent = 'Attendance corrected with an audit reason.';
              await loadPublishedEvents();
            });
            row.appendChild(correctButton);
          }
          attendeeList.appendChild(row);
        }
        attendanceSection.appendChild(attendeeList);

        card.appendChild(attendanceSection);

        const history = activityByEvent.get(event.id) || [];
        if (history.length) {
          const historySection = document.createElement('section');
          historySection.className = 'event-activity-history';
          historySection.appendChild(makeTextElement('h4', '', 'Recent activity'));
          for (const activity of history.slice(0, 5)) {
            const actor = profilesById.get(activity.actor_id);
            const reason = activity.details?.reason || activity.details?.note;
            const summary = `${activity.action_type.replaceAll('_', ' ')} · ${actor?.full_name || actor?.email || 'System'} · ${new Date(activity.created_at).toLocaleString('en-ZA')}`;
            historySection.appendChild(makeTextElement('p', 'summary-text', reason ? `${summary} · ${reason}` : summary));
          }
          card.appendChild(historySection);
        }
        eventList.appendChild(card);
      }
    }

    async function loadPublishedEvents() {
      eventList.replaceChildren(makeTextElement('p', 'summary-text', 'Loading published events…'));
      const eventsResult = await db.from('calendar_events')
          .select('id, title, description, starts_at, ends_at, location, event_status, attendance_token, organizer_id, created_by, completion_note, mentor_outcome, cancellation_reason')
          .eq('event_type', 'event')
          .order('starts_at', { ascending: false });
      if (eventsResult.error) {
        const error = eventsResult.error;
        eventList.replaceChildren(makeTextElement('p', 'summary-text', `Could not load events: ${error.message}`));
        return;
      }
      publishedEvents = eventsResult.data || [];
      const eventIds = publishedEvents.map((event) => event.id);
      if (!eventIds.length) {
        renderPublishedEvents(new Map(), new Map(), new Map());
        return;
      }
      const [attendanceResult, activityResult] = await Promise.all([
        db.from('event_attendance')
          .select('id, calendar_event_id, attendee_id, checked_in_at, attendance_method, correction_reason, is_valid, invalidation_reason')
          .in('calendar_event_id', eventIds)
          .order('checked_in_at', { ascending: false }),
        db.from('event_activity_log')
          .select('calendar_event_id, actor_id, action_type, details, created_at')
          .in('calendar_event_id', eventIds)
          .order('created_at', { ascending: false })
      ]);
      if (attendanceResult.error || activityResult.error) {
        const error = attendanceResult.error || activityResult.error;
        eventList.replaceChildren(makeTextElement('p', 'summary-text', `Could not load event history: ${error.message}`));
        return;
      }
      const attendance = attendanceResult.data || [];
      const activities = activityResult.data || [];
      const attendanceByEvent = new Map();
      for (const record of attendance || []) {
        const records = attendanceByEvent.get(record.calendar_event_id) || [];
        records.push(record);
        attendanceByEvent.set(record.calendar_event_id, records);
      }
      const activityByEvent = new Map();
      for (const activity of activities) {
        const records = activityByEvent.get(activity.calendar_event_id) || [];
        records.push(activity);
        activityByEvent.set(activity.calendar_event_id, records);
      }
      const profileIds = [...new Set([
        ...publishedEvents.map((event) => event.organizer_id).filter(Boolean),
        ...attendance.map((record) => record.attendee_id),
        ...activities.map((activity) => activity.actor_id).filter(Boolean)
      ])];
      const { data: profiles, error: profilesError } = profileIds.length
        ? await db.from('profiles').select('id, full_name, email').in('id', profileIds)
        : { data: [], error: null };
      if (profilesError) {
        eventList.replaceChildren(makeTextElement('p', 'summary-text', `Could not load event people: ${profilesError.message}`));
        return;
      }
      renderPublishedEvents(
        attendanceByEvent,
        new Map((profiles || []).map((profile) => [profile.id, profile])),
        activityByEvent
      );
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
      await Promise.all([loadRequests(), loadPublishedEvents()]);
    }

    refreshButton.addEventListener('click', async () => {
      await Promise.all([loadRequests(), loadPublishedEvents()]);
    });
    statusFilter.addEventListener('change', loadPublishedEvents);
    window.addEventListener('fye:calendar-refresh', loadPublishedEvents);
    getCurrentUser()
      .then(async () => Promise.all([loadRequests(), loadPublishedEvents()]))
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
        .select('id, title, purpose, event_date, event_time, venue, status, supervisor_note, calendar_event_id, created_at')
        .eq('mentor_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const calendarEventIds = [...new Set((requests || []).map((request) => request.calendar_event_id).filter(Boolean))];
      const publishedResult = calendarEventIds.length
        ? await db.from('calendar_events')
          .select('id, ends_at, mentor_outcome, event_status, cancellation_reason')
          .in('id', calendarEventIds)
        : { data: [], error: null };
      if (publishedResult.error) throw publishedResult.error;
      const publishedById = new Map((publishedResult.data || []).map((event) => [event.id, event]));

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
          const published = publishedById.get(request.calendar_event_id);
          if (published?.event_status === 'cancelled') {
            card.appendChild(makeTextElement('p', 'event-decline-reason', `This event was cancelled${published.cancellation_reason ? `: ${published.cancellation_reason}` : '.'}`));
          } else if (published?.event_status === 'completed') {
            card.appendChild(makeTextElement('p', 'summary-text', 'This event is complete.'));
          } else {
            card.appendChild(makeTextElement('p', 'summary-text', 'Your QR code has been sent to your notifications.'));
          }
          if (published?.mentor_outcome) {
            card.appendChild(makeTextElement('p', 'summary-text', `Your event outcome: ${published.mentor_outcome}`));
          } else if (published?.ends_at
            && published.event_status !== 'cancelled'
            && new Date(published.ends_at) < new Date()) {
            const outcomeForm = document.createElement('form');
            outcomeForm.className = 'event-review-form';
            const outcome = document.createElement('textarea');
            outcome.required = true;
            outcome.maxLength = 2000;
            outcome.rows = 3;
            outcome.placeholder = 'Share a brief outcome or follow-up need';
            const submit = makeTextElement('button', 'form-action', 'Submit event outcome');
            submit.type = 'submit';
            outcomeForm.append(outcome, submit);
            outcomeForm.addEventListener('submit', async (submitEvent) => {
              submitEvent.preventDefault();
              submit.disabled = true;
              const { error: outcomeError } = await db.rpc('submit_event_outcome', {
                p_event_id: request.calendar_event_id,
                p_note: outcome.value.trim()
              });
              if (outcomeError) {
                submit.disabled = false;
                outcomeForm.appendChild(makeTextElement('p', 'form-feedback', outcomeError.message));
                return;
              }
              await loadMentorRequests();
            });
            card.appendChild(outcomeForm);
          }
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
