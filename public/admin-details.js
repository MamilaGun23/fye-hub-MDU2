(async () => {
  if (window.fyeAuth && !(await window.fyeAuth.ready)) return;
  const db = window.fyeSupabase;
  const dialog = document.querySelector('#admin-detail-dialog');
  if (!db || !dialog) return;
  const title = document.querySelector('#admin-detail-title');
  const content = document.querySelector('#admin-detail-content');
  const feedback = document.querySelector('#admin-detail-feedback');
  const metricNames = { students: 'Students on platform', mentors: 'Active mentors', events: 'Events in period', upcoming: 'Upcoming events', assignments: 'Active assignments', disabled: 'Disabled profiles', notices: 'Active updates', eligible: 'Eligible mentees', unassigned: 'Unassigned eligible mentees', awaiting: 'Applications awaiting results' };
  let profiles = [];
  let faculties = [];
  let programmes = [];
  let requestVersion = 0;
  function button(text, action) {
    const element = document.createElement('button');
    element.type = 'button'; element.className = 'text-button'; element.textContent = text;
    element.addEventListener('click', action);
    return element;
  }
  function open(titleText) {
    ++requestVersion;
    title.textContent = titleText;
    content.replaceChildren(); feedback.textContent = '';
    if (!dialog.open) dialog.showModal();
  }
  function openProfile(id) {
    const profile = profiles.find((item) => String(item.id) === String(id));
    open(profile?.full_name || 'Account details');
    if (!profile) { feedback.textContent = 'This account is unavailable. Refresh the user list and try again.'; return; }
    const list = document.createElement('dl');
    list.className = 'account-detail-list';
    for (const [label,value] of [
      ['Name',profile.full_name],['Student number',profile.student_number],['Email',profile.email],['Role',profile.role],
      ['Status',profile.is_active === false ? 'Disabled' : 'Active'],
      ['Faculty',faculties.find((item) => String(item.id) === String(profile.faculty_id))?.name],
      ['Programme',programmes.find((item) => String(item.id) === String(profile.programme_id))?.name],
      ['School',profile.school],['Bio',profile.bio]
    ]) {
      const term = document.createElement('dt'); term.textContent = label;
      const description = document.createElement('dd'); description.textContent = value || 'Not provided';
      list.append(term,description);
    }
    content.appendChild(list);
    if (profile.role === 'mentor') {
      const actions = document.createElement('div'); actions.className = 'admin-account-actions';
      actions.appendChild(button('Edit mentor account', () => {
        dialog.close();
        document.dispatchEvent(new CustomEvent('fye:admin-edit-mentor', { detail: { id: profile.id } }));
      }));
      content.appendChild(actions);
    }
  }
  function exportCSV(name, rows, context = '') {
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const escape = (value) => {
      const text = String(value ?? '').replace(/[\r\n\t]/g,' ');
      const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replaceAll('"','""')}"`;
    };
    const lines = [[name],['Generated at',new Date().toISOString()],['Scope',context],[],columns,
      ...rows.map((row) => columns.map((column) => row[column]))];
    const file = new Blob(['\uFEFF'+lines.map((line) => line.map(escape).join(',')).join('\r\n')],{ type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const download = document.createElement('a'); download.href = url;
    download.download = `fye-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.csv`;
    download.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  function showRows(rows, reportName, scope = '') {
    content.replaceChildren();
    const toolbar = document.createElement('div'); toolbar.className = 'notification-toolbar';
    const total = document.createElement('p'); total.textContent = `${rows.length} record(s)`;
    toolbar.append(total,button('Generate CSV report',() => exportCSV(reportName,rows,scope)));
    content.appendChild(toolbar);
    if (!rows.length) { feedback.textContent = 'No records in this selection.'; return; }
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) => !key.endsWith('_id'));
    const wrap = document.createElement('div'); wrap.className = 'table-wrap';
    const table = document.createElement('table');
    const head = document.createElement('thead'); const heading = document.createElement('tr');
    for (const key of columns) { const cell = document.createElement('th'); cell.scope='col'; cell.textContent=key.replaceAll('_',' '); heading.appendChild(cell); }
    head.appendChild(heading); table.appendChild(head);
    const body = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const key of columns) {
        const cell = document.createElement('td');
        const accountId = key === 'name' ? row.profile_id : key === 'student' ? row.student_id : key === 'mentor' ? row.mentor_id : null;
        if (accountId) cell.appendChild(button(row[key] || 'View account',() => openProfile(accountId)));
        else if (key === 'title' && row.event_id) cell.appendChild(button(row[key],() => openAttendance(row.event_id,row.title)));
        else cell.textContent = row[key] == null ? '—' : String(row[key]);
        tr.appendChild(cell);
      }
      body.appendChild(tr);
    }
    table.appendChild(body); wrap.appendChild(table); content.appendChild(wrap);
  }
  async function openAttendance(id, eventTitle) {
    open(`Attendance: ${eventTitle}`);
    const version = requestVersion;
    feedback.textContent = 'Loading recorded attendance…';
    const { data,error } = await db.rpc('get_admin_event_attendance',{p_event_id:id});
    if (version !== requestVersion) return;
    if (error) { feedback.textContent=`Could not load attendance: ${error.message}`; return; }
    feedback.textContent = `${(data || []).filter((row) => row.role === 'student').length} students attended · ${(data || []).length} total valid check-ins.`;
    showRows(data || [],`Attendance ${eventTitle}`,'Valid QR and manual check-ins');
  }
  async function metricData(metric) {
    const period = document.querySelector('#analytics-period').value;
    const {data,error} = await db.rpc('get_admin_analytics_details',{p_metric:metric,p_period_days:period === 'all' ? 0 : Number(period)});
    if (error) throw error;
    return (data || []).map((row) => ({ ...row,
      ...('faculty_id' in row ? {faculty:faculties.find((item) => String(item.id) === String(row.faculty_id))?.name || (row.faculty_id == null ? 'University-wide / not assigned' : 'Unknown faculty')} : {}),
      ...('programme_id' in row ? {programme:programmes.find((item) => String(item.id) === String(row.programme_id))?.name || 'Not assigned'} : {})
    }));
  }
  async function openMetric(metric, report = false, trigger) {
    if (trigger) trigger.disabled=true;
    if (!report) open(metricNames[metric]);
    const version = requestVersion;
    try {
      const rows = await metricData(metric);
      const period = document.querySelector('#analytics-period').selectedOptions?.[0]?.textContent || document.querySelector('#analytics-period').value;
      const scope = metric === 'events' ? period : 'Current totals';
      if (report) exportCSV(metricNames[metric],rows,scope);
      else if (version === requestVersion) showRows(rows,metricNames[metric],scope);
    } catch (error) {
      if (report) document.querySelector('#analytics-feedback').textContent=`Could not generate report: ${error.message}`;
      else if (version === requestVersion) feedback.textContent=`Could not load details: ${error.message}`;
    } finally { if (trigger) trigger.disabled=false; }
  }
  document.addEventListener('fye:admin-data', (event) => {
    ({profiles,faculties,programmes}=event.detail);
  });
  document.querySelector('#admin-detail-close').addEventListener('click',() => { ++requestVersion; dialog.close(); });
  dialog.addEventListener('cancel',() => { ++requestVersion; });
  const metrics = Object.keys(metricNames);
  document.querySelectorAll('.admin-metric').forEach((card,index) => {
    const metric=metrics[index];
    if (!metric) return;
    const view = button('View details',() => openMetric(metric));
    const report = button('Generate report',() => openMetric(metric,true,report));
    const actions = document.createElement('div'); actions.className='metric-detail-actions';
    actions.append(view,report); card.appendChild(actions);
    card.tabIndex=0; card.setAttribute('role','group'); card.setAttribute('aria-label',metricNames[metric]);
    card.addEventListener('click',(event) => { if (!event.target.closest('button,a')) openMetric(metric); });
    card.addEventListener('keydown',(event) => {
      if (event.target===card && ['Enter',' '].includes(event.key)) { event.preventDefault(); openMetric(metric); }
    });
  });
  window.fyeAdminDetails={openProfile,openMetric,exportCSV};
})();
