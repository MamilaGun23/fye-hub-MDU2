(() => {
  const db = window.fyeSupabase;
  const title = document.querySelector('#attendance-title');
  const details = document.querySelector('#attendance-details');
  const feedback = document.querySelector('#attendance-feedback');
  const submitButton = document.querySelector('#attendance-submit');
  const token = new URLSearchParams(location.search).get('token');
  if (!db || !title || !details || !feedback || !submitButton) return;

  async function loadEvent() {
    if (!token) {
      title.textContent = 'Attendance code missing';
      feedback.textContent = 'Scan the QR code shared by the event mentor.';
      return;
    }

    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData.user) {
      title.textContent = 'Sign in required';
      feedback.textContent = 'Sign in to FYE Hub with your student account, then scan this event QR code again.';
      return;
    }

    const { data: events, error } = await db.rpc('get_approved_event_for_attendance', {
      p_qr_token: token
    });
    const event = events?.[0];

    if (error || !event) {
      title.textContent = 'Event unavailable';
      feedback.textContent = error
        ? `Could not load event details: ${error.message}`
        : 'This attendance code is invalid or the event is no longer approved.';
      return;
    }

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (profileError || profile?.role !== 'student') {
      title.textContent = event.title;
      details.textContent = `${event.event_date} · ${String(event.event_time).slice(0, 5)} · ${event.venue}`;
      feedback.textContent = 'Only signed-in student accounts can record event attendance.';
      return;
    }

    title.textContent = event.title;
    details.textContent = `${event.event_date} · ${String(event.event_time).slice(0, 5)} · ${event.venue}`;
    submitButton.disabled = false;
  }

  submitButton.addEventListener('click', async () => {
    submitButton.disabled = true;
    feedback.textContent = 'Recording attendance…';
    const { error } = await db.rpc('mark_event_attendance', { p_qr_token: token });
    if (error) {
      feedback.textContent = `Could not record attendance: ${error.message}`;
      submitButton.disabled = false;
      return;
    }
    feedback.textContent = 'Your attendance has been recorded.';
    submitButton.textContent = 'Attendance recorded';
  });

  loadEvent();
})();
