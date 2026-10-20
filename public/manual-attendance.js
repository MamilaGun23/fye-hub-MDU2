(() => {
  const db = window.fyeSupabase;
  if (!db) return;
  let peopleRequest;

  function canRecord(event, now = Date.now()) {
    if (event.event_status === 'completed') return true;
    if (event.event_status !== 'scheduled') return false;
    const start = Date.parse(event.starts_at);
    const end = Date.parse(event.ends_at);
    return Number.isFinite(start) && Number.isFinite(end)
      && now >= start - 60 * 60 * 1000 && now <= end + 2 * 60 * 60 * 1000;
  }

  async function loadPeople() {
    if (!peopleRequest) {
      peopleRequest = (async () => {
        const people = [];
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await db.from('profiles')
            .select('id, full_name, email, student_number, role, faculty_id')
            .in('role', ['student', 'mentor'])
            .eq('is_active', true)
            .order('id')
            .range(offset, offset + 499);
          if (error) throw error;
          people.push(...(data || []));
          if ((data || []).length < 500) break;
        }
        return people.sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''));
      })().catch((error) => { peopleRequest = null; throw error; });
    }
    return peopleRequest;
  }

  function render(event, attendance, refresh) {
    const details = document.createElement('details');
    details.className = 'manual-attendance';
    const summary = document.createElement('summary');
    summary.textContent = 'Record manual attendance';
    details.appendChild(summary);
    const note = document.createElement('p');
    note.className = 'summary-text';
    note.textContent = 'Use when an active student or mentor cannot scan the QR code. A reason is required. Scheduled events allow check-in from one hour before the start until two hours after the end; completed events allow corrections.';
    details.appendChild(note);
    if (!canRecord(event)) {
      note.textContent = 'Manual attendance is available during the check-in window (one hour before the start until two hours after the end), or after the event is marked complete. Refresh events when the window opens or the status changes.';
      return details;
    }

    const form = document.createElement('form');
    form.className = 'data-form';
    function field(labelText, input) {
      const label = document.createElement('label');
      label.textContent = labelText;
      label.appendChild(input);
      form.appendChild(label);
    }
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Name, email, or student number';
    field('Find a student or mentor', search);
    const select = document.createElement('select');
    select.required = true;
    select.disabled = true;
    field('Attendee', select);
    const reason = document.createElement('textarea');
    reason.required = true;
    reason.maxLength = 1000;
    reason.rows = 2;
    field('Reason for manual check-in or correction', reason);
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'form-action';
    submit.textContent = 'Record attendance';
    submit.disabled = true;
    const status = document.createElement('p');
    status.className = 'form-feedback';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    form.append(submit, status);
    details.appendChild(form);

    let people = [];
    let loaded = false;
    let loading = false;
    let saving = false;
    const checkedIn = new Set(attendance.filter((record) => record.is_valid).map((record) => String(record.attendee_id)));
    function updateOptions() {
      const selectedId = select.value;
      const query = search.value.trim().toLowerCase();
      const matches = people.filter((person) => (event.faculty_id != null ? String(person.faculty_id) === String(event.faculty_id) : !event.faculty_only)
        && !checkedIn.has(String(person.id))
        && [person.full_name, person.email, person.student_number].some((value) => String(value || '').toLowerCase().includes(query)));
      select.replaceChildren(new Option('Choose an attendee', ''));
      for (const person of matches.slice(0, 50)) {
        select.add(new Option(`${person.full_name || person.email} · ${person.student_number || person.email || person.role}`, person.id));
      }
      select.value = matches.slice(0, 50).some((person) => String(person.id) === selectedId) ? selectedId : '';
      select.disabled = saving || !matches.length;
      submit.disabled = saving || !matches.length;
      status.textContent = matches.length > 50 ? `${matches.length} matches. Showing the first 50; refine your search.`
        : matches.length ? `${matches.length} attendee(s) available.` : 'No matching attendees without a valid check-in.';
    }
    search.addEventListener('input', () => { if (loaded && !saving) updateOptions(); });
    details.addEventListener('toggle', async () => {
      if (!details.open || loaded || loading) return;
      loading = true;
      status.textContent = 'Loading active students and mentors…';
      try {
        people = await loadPeople();
        loaded = true;
        updateOptions();
      } catch (error) {
        status.textContent = `Could not load attendees: ${error.message}. Close and reopen this section to retry.`;
      } finally { loading = false; }
    });
    form.addEventListener('submit', async (submitEvent) => {
      submitEvent.preventDefault();
      if (saving || !loaded) return;
      if (!canRecord(event)) {
        status.textContent = 'The check-in window has closed. Refresh events to see the current event status.';
        return;
      }
      const person = people.find((item) => String(item.id) === select.value);
      if (!person || checkedIn.has(String(person.id))) {
        status.textContent = 'Choose an attendee without a valid check-in.';
        return;
      }
      if (!reason.value.trim()) {
        status.textContent = 'Enter a reason for this manual attendance record.';
        reason.focus();
        return;
      }
      saving = true;
      submit.disabled = true;
      select.disabled = true;
      status.textContent = 'Saving attendance…';
      let recorded = false;
      try {
        const { error } = await db.rpc('record_manual_event_attendance', {
          p_event_id: event.id, p_attendee_id: person.id, p_reason: reason.value.trim()
        });
        if (error) throw error;
        recorded = true;
        checkedIn.add(String(person.id));
        select.value = '';
        reason.value = '';
        await refresh();
        status.textContent = 'Attendance recorded with an audit reason.';
      } catch (error) {
        status.textContent = recorded
          ? `Attendance was saved, but the list could not refresh: ${error.message}. Refresh events before making further corrections.`
          : `Could not record attendance: ${error.message}`;
      } finally {
        saving = false;
        select.disabled = false;
        submit.disabled = false;
      }
    });
    return details;
  }

  window.fyeManualAttendance = { render, canRecord };
})();
