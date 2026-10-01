(() => {
  const db = window.fyeSupabase;
  if (!db) return;

  const fileName = location.pathname.split('/').pop().toLowerCase();
  const isSupervisorPage = fileName === 'supervisor.html';
  const isMentorDashboard = fileName === 'mentor.html';
  const eventManagementLabel = isSupervisorPage ? 'Event calendar' : 'Calendar';

  function installCalendarPage() {
    const nav = document.querySelector('.main-nav');
    const main = document.querySelector('.main-content');
    if (!nav || !main) return null;

    let calendarLink = nav.querySelector('[data-view="calendar"]');
    if (!calendarLink) {
      calendarLink = document.createElement('a');
      calendarLink.className = 'nav-link';
      calendarLink.href = '#calendar';
      calendarLink.dataset.view = 'calendar';
      const icon = document.createElement('span');
      icon.textContent = '▦';
      calendarLink.append(icon, document.createTextNode(` ${eventManagementLabel}`));
      nav.appendChild(calendarLink);
    } else if (isSupervisorPage) {
      calendarLink.innerHTML = '<span>▦</span> Event management';
    }

    let page = main.querySelector('.page-view[data-page="calendar"]');
    if (!page) {
      page = document.createElement('section');
      page.className = 'page-view';
      page.dataset.page = 'calendar';
      const footer = main.querySelector('.dashboard-footer');
      main.insertBefore(page, footer || null);
    }

    page.innerHTML = `
      <div class="section-heading page-title">
        <div>
          <p class="section-kicker">EVENTS &amp; IMPORTANT DATES</p>
          <h2>${eventManagementLabel}</h2>
        </div>
      </div>
      <article class="content-panel">
        <div id="fye-calendar">
          <div class="fye-calendar-toolbar">
            <button type="button" id="calendar-previous" aria-label="Previous month">←</button>
            <h3 id="calendar-month-label"></h3>
            <button type="button" id="calendar-next" aria-label="Next month">→</button>
            <button type="button" id="calendar-refresh">Refresh</button>
          </div>
          <div class="fye-calendar-weekdays" aria-hidden="true">
            <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span>
            <span>Fri</span><span>Sat</span><span>Sun</span>
          </div>
          <div class="fye-calendar-legend"><span class="fye-calendar-legend-swatch" aria-hidden="true"></span> Event scheduled</div>
          <div id="calendar-days" class="fye-calendar-days"></div>
          <div class="fye-calendar-day-panel">
            <h3 id="calendar-selected-date">Select a day to view its events.</h3>
            <button id="calendar-add-event" class="form-action" type="button" hidden>Add event</button>
            <form id="calendar-event-form" class="data-form" hidden>
              <label for="calendar-event-title">Event title</label>
              <input id="calendar-event-title" type="text" maxlength="120"
                placeholder="For example, Database Test 2" required>
              <label for="calendar-event-description">Purpose</label>
              <textarea id="calendar-event-description" rows="3" maxlength="500"
                placeholder="What should attendees learn or achieve?" required></textarea>
              <label for="calendar-event-time">Start time</label>
              <input id="calendar-event-time" type="time" required>
              <label for="calendar-event-end-time" hidden>End time (optional)</label>
              <input id="calendar-event-end-time" type="time" hidden>
              <label for="calendar-event-venue">Venue</label>
              <input id="calendar-event-venue" type="text" maxlength="200"
                placeholder="Lecture Hall A" required>
              <button class="form-action" type="submit">Save event</button>
            </form>
            <p id="calendar-feedback" class="form-feedback" role="status" aria-live="polite"></p>
            <div id="calendar-day-events"></div>
          </div>
        </div>
      </article>`;

    return page;
  }

  function installStyles() {
    if (document.querySelector('#fye-calendar-styles')) return;
    const style = document.createElement('style');
    style.id = 'fye-calendar-styles';
    style.textContent = `
      .fye-calendar-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:18px;flex-wrap:wrap}
      .fye-calendar-toolbar h3{margin:0 auto;text-align:center;flex:1}
        .fye-calendar-toolbar button{display:flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;border:1px solid #cbd5e1;border-radius:12px;padding:8px;color:#1a2a6c;background:#fff;font:800 18px 'DM Sans',sans-serif;cursor:pointer;transition:border-color .16s ease,background .16s ease,transform .12s ease}
      .fye-calendar-weekdays,.fye-calendar-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;text-align:center}
      .fye-calendar-weekdays{margin-bottom:8px;color:#65809f;font-size:.82rem;font-weight:700}
      .fye-calendar-legend{display:flex;align-items:center;gap:8px;margin:0 0 10px;color:#65809f;font-size:.82rem}
      .fye-calendar-legend-swatch{width:14px;height:14px;border:2px solid #d89b28;border-radius:4px;background:#fff1cc;box-sizing:border-box}
      .fye-calendar-date,.fye-calendar-empty{min-height:46px}
      .fye-calendar-date{position:relative;border:1px solid #e0e8f1;border-radius:10px;background:white;color:#1e3652;font:inherit;cursor:pointer}
      .fye-calendar-date:hover{background:#edf4fc}
      .fye-calendar-date.is-today{border-color:#1a2a6c;font-weight:700}
      .fye-calendar-date.is-selected{background:#1a2a6c;color:white}
      .fye-calendar-date.has-events:after{position:absolute;bottom:5px;left:50%;width:5px;height:5px;border-radius:50%;background:#e4a93b;content:"";transform:translateX(-50%)}
      .fye-calendar-date.is-selected.has-events:after{background:white}
      .fye-calendar-date.has-events{border:2px solid #d89b28;background:#fff1cc;color:#704b00;font-weight:700;box-shadow:inset 0 0 0 1px rgba(216,155,40,.12)}
      .fye-calendar-date.has-events:hover{background:#ffe6a6}
      .fye-calendar-date.is-selected.has-events{border:2px solid #d89b28;background:#1a2a6c;color:white;box-shadow:inset 0 0 0 2px rgba(255,255,255,.2)}
      .fye-calendar-day-panel{margin-top:24px;padding-top:18px;border-top:1px solid #e4ebf3}
      .fye-calendar-day-panel h3{margin-top:0}
      .fye-calendar-event{margin-top:12px;padding:14px;border:1px solid #e0e8f1;border-radius:12px;background:#f8fafd}
      .fye-calendar-event h4,.fye-calendar-event p{margin:6px 0}
      .fye-calendar-event-type{color:#1a2a6c;font-size:.82rem;font-weight:700;text-transform:uppercase}
      #calendar-event-form{margin-top:16px}
      #calendar-event-form[hidden],#calendar-add-event[hidden]{display:none!important}
      #calendar-event-form textarea{box-sizing:border-box;width:100%;resize:vertical}
      #calendar-event-form input,#calendar-event-form textarea{grid-column:1/-1}
      @media(max-width:520px){.fye-calendar-weekdays,.fye-calendar-days{gap:4px}.fye-calendar-date,.fye-calendar-empty{min-height:38px}}
    `;
    document.head.appendChild(style);
  }

  const calendarPage = installCalendarPage();
  if (!calendarPage) return;
  installStyles();

  const monthLabel = document.querySelector('#calendar-month-label');
  const daysGrid = document.querySelector('#calendar-days');
  const selectedDateLabel = document.querySelector('#calendar-selected-date');
  const addEventButton = document.querySelector('#calendar-add-event');
  const eventForm = document.querySelector('#calendar-event-form');
  const endTimeInput = document.querySelector('#calendar-event-end-time');
  const endTimeLabel = document.querySelector('label[for="calendar-event-end-time"]');
  const eventList = document.querySelector('#calendar-day-events');
  const feedback = document.querySelector('#calendar-feedback');

  let user = null;
  let role = null;
  let currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedDate = null;
  let monthEvents = [];

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function displayDate(date) {
    return new Intl.DateTimeFormat('en-ZA', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(date);
  }

  function renderDayEvents() {
    eventList.replaceChildren();
    if (!selectedDate) return;

    const events = monthEvents.filter(
      (item) => dateKey(new Date(item.starts_at)) === dateKey(selectedDate)
    );

    if (!events.length) {
      const empty = document.createElement('p');
      empty.className = 'summary-text';
      empty.textContent = 'No events on this day.';
      eventList.appendChild(empty);
      return;
    }

    for (const item of events) {
      const card = document.createElement('article');
      card.className = 'fye-calendar-event';
      card.dataset.eventId = String(item.id);
      const type = document.createElement('p');
      type.className = 'fye-calendar-event-type';
      type.textContent = item.audience === 'mentor_group' ? 'Mentor educational event' : 'UMP event';
      const title = document.createElement('h4');
      title.textContent = item.title;
      const description = document.createElement('p');
      description.className = 'summary-text';
      description.textContent = item.description || '';
      const details = document.createElement('p');
      details.className = 'summary-text';
      const startsAt = new Date(item.starts_at);
      details.textContent = `${startsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${item.location ? ` · ${item.location}` : ''}`;
      card.append(type, title, details, description);
      eventList.appendChild(card);
    }
  }

  function selectDate(date) {
    selectedDate = date;
    selectedDateLabel.textContent = displayDate(date);
    addEventButton.hidden = !['supervisor', 'mentor'].includes(role);
    addEventButton.textContent = role === 'mentor'
      ? 'Request event approval'
      : 'Add event';
    endTimeLabel.hidden = role !== 'supervisor';
    endTimeInput.hidden = role !== 'supervisor';
    eventForm.hidden = true;
    eventForm.reset();
    feedback.textContent = '';
    renderCalendar();
    renderDayEvents();
  }

  function renderCalendar() {
    daysGrid.replaceChildren();
    monthLabel.textContent = new Intl.DateTimeFormat('en', {
      month: 'long', year: 'numeric'
    }).format(currentMonth);

    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const offset = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const eventDays = new Set(monthEvents.map((item) => dateKey(new Date(item.starts_at))));

    for (let i = 0; i < offset; i += 1) {
      const blank = document.createElement('span');
      blank.className = 'fye-calendar-empty';
      daysGrid.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fye-calendar-date';
      button.textContent = String(day);
      button.setAttribute('aria-label', displayDate(date));

      if (dateKey(date) === dateKey(new Date())) button.classList.add('is-today');
      if (selectedDate && dateKey(date) === dateKey(selectedDate)) button.classList.add('is-selected');
      if (eventDays.has(dateKey(date))) button.classList.add('has-events');

      button.addEventListener('click', () => selectDate(date));
      daysGrid.appendChild(button);
    }
  }

  async function loadMonthEvents() {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 1);
    feedback.textContent = 'Loading events…';

    const { data, error } = await db
      .from('calendar_events')
      .select('id, title, event_type, description, starts_at, ends_at, location, audience, created_by, event_status')
      .gte('starts_at', start.toISOString())
      .lt('starts_at', end.toISOString())
      .order('starts_at');

    if (error) {
      console.error('Could not load calendar events:', error);
      feedback.textContent = `Could not load events: ${error.message}`;
      monthEvents = [];
    } else {
      monthEvents = (data || []).filter((item) =>
        role === 'supervisor' || item.event_status === 'scheduled'
      );
      feedback.textContent = '';
    }

    renderCalendar();
    renderDayEvents();
  }

  window.addEventListener('fye:calendar-refresh', loadMonthEvents);

  window.addEventListener('fye:open-calendar-event', async (event) => {
    const eventId = String(event.detail?.id || '');
    if (!eventId) return;

    const { data: selectedEvent, error } = await db
      .from('calendar_events')
      .select('id, title, event_type, description, starts_at, ends_at, location, audience, created_by, event_status')
      .eq('id', eventId)
      .maybeSingle();

    if (error || !selectedEvent || selectedEvent.event_status !== 'scheduled') {
      feedback.textContent = 'This event is no longer scheduled. Refresh the homepage to see the next event.';
      return;
    }

    const eventDate = new Date(selectedEvent.starts_at);
    currentMonth = new Date(eventDate.getFullYear(), eventDate.getMonth(), 1);
    selectedDate = null;
    await loadMonthEvents();

    if (!monthEvents.some((item) => String(item.id) === eventId)) {
      monthEvents.push(selectedEvent);
      renderCalendar();
    }

    selectDate(eventDate);
    const eventCard = [...eventList.querySelectorAll('.fye-calendar-event')]
      .find((card) => card.dataset.eventId === eventId);
    eventCard?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.querySelector('#calendar-previous').addEventListener('click', async () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    selectedDate = null;
    selectedDateLabel.textContent = 'Select a day to view its events.';
    addEventButton.hidden = true;
    eventForm.hidden = true;
    eventForm.reset();
    eventList.replaceChildren();
    await loadMonthEvents();
  });

  document.querySelector('#calendar-next').addEventListener('click', async () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    selectedDate = null;
    selectedDateLabel.textContent = 'Select a day to view its events.';
    addEventButton.hidden = true;
    eventForm.hidden = true;
    eventForm.reset();
    eventList.replaceChildren();
    await loadMonthEvents();
  });

  document.querySelector('#calendar-refresh').addEventListener('click', loadMonthEvents);

  addEventButton.addEventListener('click', () => {
    eventForm.hidden = false;
    document.querySelector('#calendar-event-title').focus();
  });

  eventForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.textContent = '';

    if (!selectedDate || !user || !['supervisor', 'mentor'].includes(role)) {
      feedback.textContent = 'Select a day and make sure you are signed in with permission to add events.';
      return;
    }

    const title = document.querySelector('#calendar-event-title').value.trim();
    const description = document.querySelector('#calendar-event-description').value.trim();
    const eventTime = document.querySelector('#calendar-event-time').value;
    const venue = document.querySelector('#calendar-event-venue').value.trim();
    const saveButton = eventForm.querySelector('button[type="submit"]');
    const mentorEvent = role === 'mentor';
    const [hours, minutes] = eventTime.split(':').map(Number);
    const startsAt = new Date(
      selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), hours, minutes, 0
    );

    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';

    try {
      const result = mentorEvent
        ? await db.rpc('create_event_request', {
            p_title: title,
            p_purpose: description,
            p_event_date: dateKey(selectedDate),
            p_event_time: eventTime,
            p_venue: venue
          })
        : await db.rpc('create_supervisor_event', {
            p_title: title,
            p_description: description,
            p_starts_at: startsAt.toISOString(),
            p_ends_at: endTimeInput.value
              ? new Date(`${dateKey(selectedDate)}T${endTimeInput.value}`).toISOString()
              : null,
            p_venue: venue
          });

      const { error } = result;
      if (error) throw error;
      feedback.textContent = mentorEvent
        ? 'Your event request was sent to the supervisor for approval.'
        : 'Event saved. Students have been notified and reminders are scheduled.';
      eventForm.reset();
      eventForm.hidden = true;
      if (mentorEvent) {
        window.dispatchEvent(new CustomEvent('fye:event-request-created'));
      }
      window.dispatchEvent(new CustomEvent('fye:calendar-refresh'));
      await loadMonthEvents();
    } catch (error) {
      console.error('Could not save calendar event:', error);
      const missingRequestRpc = mentorEvent && (
        error.code === 'PGRST202'
        || error.message?.includes('Could not find the function public.create_event_request')
      );
      feedback.textContent = missingRequestRpc
        ? 'Event requests are not enabled in Supabase yet. Apply the event approval migration and database/20261002000000_mentor_application_workflow.sql, reload the schema, and try again.'
        : `Could not save the event: ${error.message}`;
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Save event';
    }
  });

  async function init() {
    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData.user) {
      feedback.textContent = 'Please sign in to view the calendar.';
      return;
    }

    user = authData.user;
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('role, mentor_approval_status, is_active')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      feedback.textContent = 'Could not load your account role.';
      return;
    }
    if (profile.is_active === false) {
      await db.auth.signOut();
      window.location.replace('index.html');
      return;
    }

    role = profile.role === 'supervisor' ? 'supervisor' : 'student';
    const legacyMentorApproved = profile.role === 'mentor'
      && profile.mentor_approval_status === 'approved';
    const { data: application, error: applicationError } = await db
      .from('mentor_applications')
      .select('status')
      .eq('applicant_id', user.id)
      .maybeSingle();

    if (applicationError && applicationError.code !== 'PGRST205') {
      feedback.textContent = 'Could not verify mentor application access.';
      return;
    }

    if (legacyMentorApproved || application?.status === 'approved') {
      role = 'mentor';
    }

    if (isMentorDashboard && role !== 'mentor') {
      window.location.replace('student.html');
      return;
    }
    await loadMonthEvents();
  }

  init();
})();