const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A small DOM fixture for exercising the existing browser scripts without a database.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.value = '';
    this.className = '';
    this.classList = {
      toggle: (name, active) => {
        const names = new Set(this.className.split(' ').filter(Boolean));
        if (active) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
      }
    };
  }
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.append(item); return item; }
  add(item) { this.append(item); }
  replaceChildren(...items) { this.children = items; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map((item) => item.textContent ?? item).join(''); }
  set innerHTML(value) { this.children = []; this._text = value; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  click() { return Promise.all((this.listeners.click || []).map((handler) => handler({ preventDefault() {} }))); }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  querySelectorAll(selector) {
    const matches = selector.startsWith('.')
      ? (item) => item.className?.split(' ').includes(selector.slice(1))
      : (item) => item.tagName === selector;
    return this.children.filter((item) => item instanceof Element)
      .flatMap((item) => [...(matches(item) ? [item] : []), ...item.querySelectorAll(selector)]);
  }
}

function fixture(script, db = {}) {
  const root = new Element();
  const nodes = new Map();
  const htmlName = script === 'admin-academic.js' ? 'admin.html'
    : ['manual-attendance.js', 'supervisor-notifications.js'].includes(script) ? 'supervisor.html' : script.replace('.js', '.html');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', htmlName), 'utf8');
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) {
    const element = new Element();
    element.id = id;
    nodes.set(id, element);
    root.append(element);
  }
  const document = {
    head: new Element('head'),
    createElement: (tag) => new Element(tag),
    querySelector: (selector) => nodes.get(selector.slice(1))
      || [...root.querySelectorAll('button')].find((item) => `#${item.id}` === selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    addEventListener: root.addEventListener.bind(root),
    dispatchEvent(event) { for (const listener of root.listeners[event.type] || []) listener(event); }
  };
  const context = vm.createContext({
    document, window: { fyeSupabase: db, addEventListener() {}, scrollTo() {}, setInterval() {} },
    history: { replaceState() {} }, location: { hash: '' }, console,
    setTimeout, clearTimeout,
    CustomEvent: function (type) { this.type = type; },
    Option: function (label, value) { const option = new Element('option'); option.textContent = label; option.value = value; return option; }
  });
  let source = fs.readFileSync(path.join(__dirname, '..', 'public', script), 'utf8');
  if (script === 'admin.js') {
    source = source.replace('  init();\n})();', `  globalThis.dashboard = {
      renderFacultyBreakdown, loadAllProfiles,
      setData(data) {
        profiles = data.profiles; faculties = data.faculties; programmes = data.programmes;
        facultyNames = new Map(faculties.map((item) => [String(item.id), item.name]));
      }
    };\n})();`);
  } else if (script === 'admin-academic.js') {
    source = source.replace('  init();\n})();', '  globalThis.dashboard = { loadAcademicData };\n})();');
  } else if (script === 'supervisor-notifications.js') {
    source = source.replace('  loadNotifications();\n})();', '  globalThis.dashboard = { loadNotifications };\n})();');
  } else if (script === 'manual-attendance.js') {
    source += '\nglobalThis.dashboard = window.fyeManualAttendance;';
  } else {
    source = source.replace('initSupervisorDashboard();', 'globalThis.dashboard = { state, renderDirectories, updateMentorFilterOptions };');
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','public','academic.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','public','directory.js'),'utf8'),context);
  vm.runInContext(source, context);
  return { ...context.dashboard, nodes, document };
}

test('admin loads every profile beyond one API page and sorts names', async () => {
  const records = Array.from({ length: 2101 }, (_, id) => ({ id, full_name: `Name ${2101 - id}` }));
  const ranges = [];
  const query = {
    select() { return this; }, order() { return this; },
    async range(start, end) { ranges.push([start, end]); return { data: records.slice(start, end + 1), error: null }; }
  };
  const app = fixture('admin.js', { from: () => query });
  const result = await app.loadAllProfiles();
  assert.equal(result.data.length, 2101);
  assert.equal(ranges.length, 5);
  assert.equal(result.data[0].full_name, 'Name 1');
});

test('admin propagates a later profile page failure instead of returning partial totals', async () => {
  const error = { message: 'Connection interrupted' };
  const query = {
    select() { return this; }, order() { return this; },
    async range(start) { return start ? { error } : { data: Array(500).fill({ id: 1 }) }; }
  };
  const app = fixture('admin.js', { from: () => query });
  assert.equal((await app.loadAllProfiles()).error, error);
});

test('faculty tabs filter programmes, count account states consistently, and retain selection', () => {
  const app = fixture('admin.js');
  app.setData({
    faculties: [{ id: 1, name: 'Science' }, { id: 2, name: 'Education' }],
    programmes: [{ id: 10, faculty_id: 1, name: 'Biology' }, { id: 20, faculty_id: 2, name: 'Teaching' }],
    profiles: [
      { faculty_id: 1, programme_id: 10, role: 'student', is_active: true },
      { faculty_id: 1, programme_id: 10, role: 'mentor', is_active: null },
      { faculty_id: 1, programme_id: 10, role: 'student', is_active: false }
    ]
  });
  app.renderFacultyBreakdown();
  let tabs = app.nodes.get('analytics-faculty-tabs').children;
  tabs[1].click();
  const detail = app.nodes.get('analytics-faculty-detail');
  assert.match(detail.textContent, /Biology/);
  assert.doesNotMatch(detail.textContent, /Teaching/);
  assert.deepEqual(detail.querySelectorAll('strong').map((item) => item.textContent), ['1', '1', '1', '1']);
  app.renderFacultyBreakdown();
  tabs = app.nodes.get('analytics-faculty-tabs').children;
  assert.equal(tabs[1].attributes['aria-selected'], 'true');
  assert.equal(tabs[0].tabIndex, -1);
  tabs[1].listeners.keydown[0]({ key: 'End', preventDefault() {} });
  assert.equal(tabs[2].attributes['aria-selected'], 'true');
  assert.equal(tabs[2].focused, true);
  assert.match(detail.textContent, /Teaching/);
});

test('supervisor boots, paginates, filters mentors, and clears the filter once', () => {
  const app = fixture('supervisor.js');
  app.state.faculties = [{ id: 1, name: 'Science' }, { id: 2, name: 'Education' }];
  app.state.programmes = [{ id: 10, name: 'Biology', faculty_id: 1 }];
  app.state.students = Array.from({ length: 12 }, (_, id) => ({ id: `student-${id}`, full_name: `Student ${id}`, faculty_id: 1, programme_id: 10 }));
  app.state.mentors = [{ id: 'm1', faculty_id: 1, programme_id: 10, full_name: 'Mentor One' }, { id: 'm2', faculty_id: 2, full_name: 'Mentor Two' }];
  app.renderDirectories();
  assert.equal(app.nodes.get('students-list').children.length, 10);
  const next = app.nodes.get('student-pagination').querySelectorAll('button')[1];
  next.click();
  assert.equal(app.nodes.get('students-list').children.length, 2);
  assert.equal(app.nodes.get('student-result-count').textContent, 'Showing 11-12 of 12 results');
  const faculty = app.nodes.get('mentor-filter-faculty');
  faculty.value = '1';
  faculty.listeners.change[0]();
  assert.equal(app.nodes.get('mentors-list').children.length, 1);
  assert.match(app.nodes.get('mentors-list').textContent, /Mentor One/);
  assert.equal(faculty.listeners.change.length, 1);
  app.nodes.get('mentor-filter-clear').click();
  assert.equal(app.nodes.get('mentors-list').children.length, 2);
});

test('student search resets pagination and empty results show 0-0', () => {
  const app = fixture('supervisor.js');
  app.state.currentPage = 8;
  app.state.students = [{ id: 's1', full_name: 'Thandi' }];
  app.nodes.get('student-filter-search').value = 'Nobody';
  app.nodes.get('student-filter-apply').click();
  assert.equal(app.state.currentPage, 1);
  assert.equal(app.nodes.get('student-result-count').textContent, 'Showing 0-0 of 0 results');
});

test('supervisor contact action opens only a saved WhatsApp group URL', () => {
  const app = fixture('supervisor.js');
  app.state.mentors = [
    { id: 'm1', full_name: 'Valid', whatsapp_group_link: 'https://chat.whatsapp.com/Abc123' },
    { id: 'm2', full_name: 'Invalid', whatsapp_group_link: 'javascript:alert(1)' }
  ];
  app.renderDirectories();
  const links = app.nodes.get('mentors-list').querySelectorAll('a');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://chat.whatsapp.com/Abc123');
  assert.equal(links[0].rel, 'noopener noreferrer');
});

test('academic setup groups faculties alphabetically, renders actions, and notifies after edits', async () => {
  const data = {
    faculties: [{ id: 2, name: 'Education' }, { id: 1, name: 'Science' }],
    programmes: [{ id: 10, faculty_id: 1, name: 'Biology' }, { id: 20, faculty_id: 2, name: 'Teaching' }]
  };
  const app = fixture('admin-academic.js', {
    from: (table) => ({ select: () => ({ order: async () => ({ data: data[table] }) }) })
  });
  let notifications = 0;
  app.document.addEventListener('academic-data-updated', () => notifications++);
  await app.loadAcademicData();
  assert.equal(notifications, 0);
  assert.equal(app.nodes.get('faculty-manage-list').querySelectorAll('button').length, 4);
  assert.equal(app.nodes.get('programme-manage-list').querySelectorAll('summary')[0].textContent, 'Education');
  app.nodes.get('programme-faculty').value = '1';
  await app.loadAcademicData(true);
  assert.equal(notifications, 1);
  assert.equal(app.nodes.get('programme-faculty').value, '1');
});

function attendanceFixture({ people, rpc = async () => ({ error: null }), profileError } = {}) {
  return fixture('manual-attendance.js', {
    from: () => ({ select() { return this; }, in() { return this; }, eq() { return this; }, order() { return this; },
      async range(start, end) { return { data: (people || [{ id: 's1', full_name: 'Thandi', role: 'student' }]).slice(start, end + 1), error: profileError }; }
    }), rpc
  });
}

async function openAttendance(app, attendance = [], refresh = async () => {}) {
  const details = app.render({ id: 7, event_status: 'completed' }, attendance, refresh);
  details.open = true;
  await details.listeners.toggle[0]();
  const form = details.querySelectorAll('form')[0];
  return { details, form, select: details.querySelectorAll('select')[0], reason: details.querySelectorAll('textarea')[0],
    status: details.querySelectorAll('p').at(-1), submit: details.querySelectorAll('button')[0] };
}

test('manual check-in enforces scheduled window boundaries and excludes cancelled events', () => {
  const app = attendanceFixture();
  const event = { event_status: 'scheduled', starts_at: '2026-10-18T10:00:00Z', ends_at: '2026-10-18T11:00:00Z' };
  assert.equal(app.canRecord(event, Date.parse('2026-10-18T08:59:59Z')), false);
  assert.equal(app.canRecord(event, Date.parse('2026-10-18T09:00:00Z')), true);
  assert.equal(app.canRecord(event, Date.parse('2026-10-18T13:00:00Z')), true);
  assert.equal(app.canRecord(event, Date.parse('2026-10-18T13:00:01Z')), false);
  assert.equal(app.canRecord({ event_status: 'completed' }), true);
  assert.equal(app.canRecord({ ...event, event_status: 'cancelled' }), false);
});

test('manual check-in excludes valid check-ins but allows invalidated records to be corrected', async () => {
  const app = attendanceFixture({ people: [{ id: 's1', full_name: 'One' }, { id: 's2', full_name: 'Two' }] });
  const view = await openAttendance(app, [{ attendee_id: 's1', is_valid: true }, { attendee_id: 's2', is_valid: false }]);
  assert.deepEqual(view.select.children.map((item) => item.value), ['', 's2']);
  assert.equal(view.submit.disabled, false);
});

test('manual check-in requires a reason, prevents duplicate saves, and refreshes attendance', async () => {
  const calls = [];
  let refreshes = 0;
  const app = attendanceFixture({ rpc: async (name, args) => { calls.push([name, args]); return {}; } });
  const view = await openAttendance(app, [], async () => { refreshes++; });
  view.select.value = 's1';
  view.reason.value = '  ';
  await view.form.listeners.submit[0]({ preventDefault() {} });
  assert.equal(calls.length, 0);
  assert.match(view.status.textContent, /Enter a reason/);
  view.reason.value = ' QR camera unavailable ';
  const first = view.form.listeners.submit[0]({ preventDefault() {} });
  const second = view.form.listeners.submit[0]({ preventDefault() {} });
  await Promise.all([first, second]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'record_manual_event_attendance');
  assert.equal(calls[0][1].p_attendee_id, 's1');
  assert.equal(calls[0][1].p_event_id, 7);
  assert.equal(calls[0][1].p_reason, 'QR camera unavailable');
  assert.equal(refreshes, 1);
});

test('manual attendance retains inputs on an RPC failure and distinguishes refresh failure after saving', async () => {
  let failure = true;
  const app = attendanceFixture({ rpc: async () => failure ? { error: { message: 'Access denied' } } : {} });
  const view = await openAttendance(app, [], async () => { throw new Error('Offline'); });
  view.select.value = 's1';
  view.reason.value = 'Camera unavailable';
  await view.form.listeners.submit[0]({ preventDefault() {} });
  assert.match(view.status.textContent, /Could not record attendance: Access denied/);
  assert.equal(view.reason.value, 'Camera unavailable');
  assert.equal(view.submit.disabled, false);
  failure = false;
  await view.form.listeners.submit[0]({ preventDefault() {} });
  assert.match(view.status.textContent, /Attendance was saved, but the list could not refresh/);
});

test('manual attendee lookup loads all API pages and narrows a large result set', async () => {
  const app = attendanceFixture({ people: Array.from({ length: 510 }, (_, id) => ({ id: String(id), full_name: `Student ${id}`, student_number: `NUM${id}` })) });
  const view = await openAttendance(app);
  assert.match(view.status.textContent, /510 matches/);
  assert.equal(view.select.children.length, 51);
  const search = view.details.querySelectorAll('input')[0];
  search.value = 'NUM509';
  search.listeners.input[0]();
  assert.equal(view.select.children.length, 2);
  assert.equal(view.select.children[1].value, '509');
});

function notificationFixture({ count = 125, bulkError = null } = {}) {
  let read = false;
  const calls = [];
  const app = fixture('supervisor-notifications.js', {
    auth: { getUser: async () => ({ data: { user: { id: 'supervisor1' } } }) },
    from: (table) => ({ select() { return this; }, eq() { return this; }, order() { return this; },
      async maybeSingle() { return { data: { role: 'supervisor', is_active: true } }; },
      async is() { return { count: read ? 0 : count }; },
      async limit() { return { data: [{ id: 'n1', notification_type: 'admin_notice', title: 'Update', created_at: '2026-10-18T09:00:00Z', read_at: read ? '2026-10-18T10:00:00Z' : null }] }; }
    }),
    async rpc(name) {
      calls.push(name);
      if (name === 'mark_all_supervisor_notifications_read') {
        if (bulkError) return { error: bulkError };
        read = true;
      }
      return {};
    }
  });
  return { ...app, calls };
}

test('supervisor unread badge uses the full unread total and caps its display', async () => {
  const app = notificationFixture();
  await app.loadNotifications();
  const badge = app.nodes.get('supervisor-notification-count');
  assert.equal(badge.textContent, '99+');
  assert.equal(badge.attributes['aria-label'], '125 unread notifications');
  await app.nodes.get('supervisor-notifications-read-all').click();
  assert.equal(app.calls.filter((name) => name === 'mark_all_supervisor_notifications_read').length, 1);
  assert.equal(badge.hidden, true);
  assert.equal(app.nodes.get('supervisor-notifications-read-all').disabled, true);
});

test('bulk notification failure leaves notifications unread and restores controls', async () => {
  const app = notificationFixture({ bulkError: { code: 'PGRST202', message: 'RPC missing' } });
  await app.loadNotifications();
  await app.nodes.get('supervisor-notifications-read-all').click();
  assert.match(app.nodes.get('supervisor-notifications-feedback').textContent, /Ask your administrator to enable it/);
  assert.equal(app.nodes.get('supervisor-notification-count').textContent, '99+');
  assert.equal(app.nodes.get('supervisor-notifications-read-all').disabled, false);
});
