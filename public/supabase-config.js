(() => {
  const config = window.FYE_CONFIG || {};
  if (!config.supabaseUrl || !config.supabasePublishableKey || !window.supabase) {
    window.fyeSupabase = null;
    const notice = document.createElement('p');
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'margin:0;padding:12px 20px;text-align:center;background:#fff3d6;color:#513b13;font:14px/1.5 sans-serif';
    notice.append('Live sign-in needs Supabase configuration. ');
    const link = document.createElement('a');
    link.href = 'https://github.com/MamilaGun23/fye-hub-MDU2/blob/main/docs/SETUP.md';
    link.textContent = 'View setup instructions';
    notice.append(link);
    document.body.prepend(notice);
    return;
  }
  window.fyeSupabase = window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey
  );
})();
