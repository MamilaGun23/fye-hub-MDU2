(() => {
  const db = window.fyeSupabase;
  const dashboards = Object.freeze({student:'student.html', mentor:'mentor.html', supervisor:'supervisor.html', admin:'admin.html'});
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  const dashboardRole = Object.keys(dashboards).find(role => dashboards[role] === currentPage);
  const landing = currentPage === 'index.html';
  let pendingAccount;

  function authError(message, code) {
    const error = new Error(message); error.code = code; return error;
  }

  async function resolveAccount(user) {
    if (!user) return null;
    const {data:profile, error} = await db.from('profiles')
      .select('id, full_name, role, mentor_approval_status, is_active')
      .eq('id', user.id).single();
    if (error) throw authError('Your account details could not be loaded. Please try again.', 'profile-unavailable');
    if (!profile) throw authError('We could not find a profile for this account.', 'missing-profile');
    if (profile.is_active === false) throw authError('This account is disabled. Contact your FYE administrator for assistance.', 'disabled');
    if (!Object.hasOwn(dashboards, profile.role)) throw authError('This account does not have a supported role. Contact your FYE coordinator.', 'unsupported-role');
    let role = profile.role;
    if (['student', 'mentor'].includes(role)) {
      role = await window.fyeAcademic.mentor(user.id) ? 'mentor' : 'student';
    }
    return {user, profile, role, dashboard:dashboards[role]};
  }

  async function getAccount({refresh=false} = {}) {
    if (refresh) pendingAccount = null;
    if (!pendingAccount) {
      pendingAccount = (async () => {
        if (!db) throw Error('The database connection did not load. Please refresh the page.');
        const {data, error} = await db.auth.getUser();
        if (error || !data?.user) return null;
        return resolveAccount(data.user);
      })();
      pendingAccount.catch(() => { pendingAccount = null; });
    }
    return pendingAccount;
  }

  // Attendance is the only supported return route. Never navigate to arbitrary next URLs.
  function returnPath(value) {
    if (!value) return null;
    try {
      const url = new URL(value, location.href);
      const attendance = new URL('event-attendance.html', location.href);
      if (url.origin !== attendance.origin || url.pathname !== attendance.pathname) return null;
      const token = url.searchParams.get('token');
      if (!token) return null;
      return `event-attendance.html?${new URLSearchParams({token})}`;
    } catch { return null; }
  }

  function destination(account) {
    const next = returnPath(new URLSearchParams(location.search).get('next'));
    return next && ['student', 'mentor'].includes(account.role) ? next : account.dashboard;
  }

  function signInUrl(next) {
    const path = returnPath(next);
    return path ? `index.html?${new URLSearchParams({next:path})}` : 'index.html';
  }

  async function signOut() {
    if (db) {
      const {error} = await db.auth.signOut();
      if (error) throw error;
    }
    pendingAccount = null;
  }

  function showError(error) {
    const message = error.message || 'Could not verify your account. Please try again.';
    if (landing) {
      const feedback = document.querySelector('.form-message');
      if (feedback) feedback.textContent = message;
      document.querySelector('.login-dialog')?.showModal();
      return;
    }
    const status = document.createElement('main'); status.className = 'auth-status';
    const heading = document.createElement('h1'); heading.textContent = 'Account access';
    const text = document.createElement('p'); text.textContent = message; text.setAttribute('role', 'alert');
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Try again';
    retry.addEventListener('click', () => location.reload());
    const link = document.createElement('a'); link.href = 'index.html'; link.textContent = 'Return to sign in';
    status.append(heading, text, retry, link); document.body.appendChild(status);
  }

  async function start() {
    if (!landing && !dashboardRole) return null;
    // The public landing page stays available before a database is configured.
    if (landing && !db) return null;
    let loading;
    if (dashboardRole) {
      loading = document.createElement('p'); loading.className = 'auth-status';
      loading.setAttribute('role', 'status'); loading.textContent = 'Checking your account...';
      document.body.appendChild(loading);
    }
    try {
      const account = await getAccount();
      if (!account) {
        if (dashboardRole) location.replace('index.html');
        return null;
      }
      if (landing) { location.replace(destination(account)); return null; }
      if (account.role !== dashboardRole) { location.replace(account.dashboard); return null; }
      document.body.dataset.authState = 'ready';
      return account;
    } catch (error) {
      if (['disabled', 'missing-profile', 'unsupported-role'].includes(error.code)) {
        try { await signOut(); } catch (signOutError) { console.error('Could not end session:', signOutError); }
      }
      showError(error);
      return null;
    } finally {
      loading?.remove();
    }
  }

  window.fyeAuth = {dashboards, resolveAccount, getAccount, destination, signInUrl, signOut};
  window.fyeAuth.ready = start();
  document.addEventListener('click', async event => {
    if (!event.target.closest('.signout')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    try {
      await signOut();
      location.replace('index.html');
    } catch (error) { window.alert(`Could not sign out: ${error.message}. Please try again.`); }
  }, true);
  // Supabase propagates this event across tabs. End dashboard access there too.
  db?.auth.onAuthStateChange?.((event) => {
    if (event !== 'SIGNED_OUT') return;
    pendingAccount = null;
    if (dashboardRole) location.replace('index.html');
  });
})();
