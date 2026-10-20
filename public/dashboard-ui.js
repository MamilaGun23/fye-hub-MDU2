(() => {
  function actionMenu(container, label = 'More actions') {
    if (!container || container.dataset.actionsReady || !container.children.length) return;
    container.dataset.actionsReady = 'true';
    const menu = document.createElement('details');
    menu.className = 'dashboard-action-menu';
    const toggle = document.createElement('summary');
    toggle.textContent = '•••';
    toggle.tabIndex = 0;
    toggle.setAttribute('aria-label', label);
    const body = document.createElement('div');
    body.className = 'dashboard-action-items';
    while (container.firstChild) body.appendChild(container.firstChild);
    menu.append(toggle, body);
    container.appendChild(menu);
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { menu.open = false; toggle.focus(); }
    });
  }
  function installMenus() {
    document.querySelectorAll('.table-wrap:not([tabindex])').forEach(table => { table.tabIndex = 0; });
    document.querySelectorAll('.academic-row-actions,.mentor-approval-actions,.admin-account-actions,.notice-actions,.event-review-actions,.attendance-correction-actions')
      .forEach((container) => actionMenu(container));
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-disclosure]');
    if (button) {
      const content = document.getElementById(button.dataset.disclosure);
      if (content) {
        content.hidden = !content.hidden;
        button.setAttribute('aria-expanded', String(!content.hidden));
        const label = button.querySelector('.disclosure-label');
        if (label) label.textContent = content.hidden ? button.dataset.showLabel : button.dataset.hideLabel;
      }
    }
    document.querySelectorAll('.dashboard-action-menu[open]').forEach((menu) => {
      if (!menu.contains(event.target)) menu.open = false;
    });
  });
  new MutationObserver(installMenus).observe(document.body, { childList: true, subtree: true });
  installMenus();
  window.fyeDashboardUI = { actionMenu };
})();
