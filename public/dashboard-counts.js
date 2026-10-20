(async () => {
  const account = window.fyeAuth ? await window.fyeAuth.ready : null;
  if (window.fyeAuth && !account) return;
  const db = window.fyeSupabase;
  if (!db || !document.querySelector('.main-nav')) return;
  let user, role, refreshing = false, again = false;
  function set(view, count, description) {
    const link = document.querySelector(`.main-nav [data-view="${view}"]`);
    if (!link) return;
    if (link.dataset.count === 'off') { link.querySelector('.nav-count')?.remove(); return; }
    let badge = link.querySelector('.nav-count');
    if (!badge) { badge = document.createElement('span'); badge.className = 'nav-count'; link.appendChild(badge); }
    badge.textContent = Number(count).toLocaleString('en-ZA');
    badge.title = `${count} ${description}`;
    badge.setAttribute('aria-label', badge.title);
    badge.hidden = false;
  }
  async function count(view, table, filter, description) {
    const result = await filter(db.from(table).select('id', { count: 'exact', head: true }));
    if (result.error || !Number.isInteger(result.count)) {
      const badge = document.querySelector(`.main-nav [data-view="${view}"] .nav-count`);
      if (badge) badge.hidden = true;
      return;
    }
    set(view, result.count, description);
  }
  async function refresh() {
    if (!user || !role) return;
    if (refreshing) { again = true; return; }
    refreshing = true;
    try {
      const jobs = [];
      if (['student','mentor'].includes(role)) {
        jobs.push(count('messages', 'mentor_student_conversations', q => q, 'active conversations'));
        jobs.push(count(role === 'mentor' ? 'students' : 'mentor', 'active_mentor_assignments', q => q.eq(role === 'mentor' ? 'mentor_id' : 'student_id', user.id), role === 'mentor' ? 'assigned students' : 'assigned mentors'));
      }
      if (role !== 'admin') jobs.push(count('calendar', 'calendar_events', q => q.eq('event_type','event').eq('event_status','scheduled').gte('starts_at',new Date().toISOString()), 'upcoming events'));
      if (role === 'supervisor') {
        jobs.push(count('mentor-applications','mentor_applications',q => q.or('status.in.(pending,shortlisted,declined,closed),and(status.eq.approved,replacement_review_required.eq.true)'), 'applications in the review workspace'));
        jobs.push((async()=>{
          const [events,cancellations] = await Promise.all([
            db.from('event_requests').select('id',{count:'exact',head:true}).eq('status','pending'),
            db.from('event_cancellation_requests').select('id',{count:'exact',head:true}).in('status',['pending','approved'])
          ]);
          if (!events.error && !cancellations.error && Number.isInteger(events.count) && Number.isInteger(cancellations.count)) set('event-requests',events.count+cancellations.count,'event and cancellation requests awaiting action');
        })());
      }
      if (role === 'admin') jobs.push(count('notices','system_notices',q => q.eq('is_active',true).or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`),'active or scheduled updates'));
      await Promise.allSettled(jobs);
    } finally {
      refreshing = false;
      if (again) { again = false; refresh(); }
    }
  }
  for (const name of ['fye:calendar-refresh','fye:counts-refresh','fye:event-request-created','fye:supervisor-data-refresh']) window.addEventListener(name,refresh);
  document.addEventListener('fye:notices-updated',refresh);
  window.addEventListener('focus',refresh);
  window.fyeNavCounts = {set,refresh};
  (async()=>{
    if (account) { user = account.user; role = account.role; }
    else {
      const auth = await db.auth.getUser();if (auth.error || !auth.data.user) return;user = auth.data.user;
      const profile = await db.from('profiles').select('role').eq('id',user.id).maybeSingle();
      if (profile.error || !profile.data) return;role = profile.data.role;
    }
    await refresh();window.setInterval(refresh,60000);
  })().catch(()=>{});
})();
