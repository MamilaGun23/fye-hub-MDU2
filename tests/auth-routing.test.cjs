const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname,'../public',file),'utf8');
const settle = async () => {for(let i=0;i<8;i++) await new Promise(r=>setImmediate(r));};

function setup(t, page, {role='student',approved=false,signedIn=true,disabled=false,profileError=false,search=''}={}) {
  const dom = new JSDOM(read(page),{url:`https://fye.test/${page}${search}`});
  t.after(()=>dom.window.close());
  const document=dom.window.document,calls=[],navigations=[];
  let authCallback;
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  const location={pathname:`/${page}`,search,href:`https://fye.test/${page}${search}`,replace:value=>navigations.push(value),reload:()=>calls.push('reload')};
  const window={location,alert:message=>calls.push({alert:message}),
    fyeAcademic:{mentor:async()=>{calls.push('mentor');return approved;}},
    fyeSupabase:{
      auth:{getUser:async()=>{calls.push('getUser');return {data:{user:signedIn?{id:'user'}:null}};},
        signOut:async()=>{calls.push('signOut');return {};},onAuthStateChange:callback=>{authCallback=callback;}},
      from:table=>{calls.push(table);return {select(){return this;},eq(){return this;},single:async()=>({data:{id:'user',role,is_active:!disabled},error:profileError?Error('network'):null})};}
    }};
  const context=vm.createContext({window,document,location,URL,URLSearchParams,console:{error(){}}});
  vm.runInContext(read('auth.js'),context);
  return {window,document,dom,calls,navigations,authEvent:event=>authCallback(event),run:file=>vm.runInContext(read(file),context)};
}

for(const role of ['student','mentor','supervisor','admin']) {
  test(`existing ${role} session resumes from home and redirects wrong dashboard`,async t=>{
    const options={role,approved:role==='mentor'};
    const landing=setup(t,'index.html',options);await landing.window.fyeAuth.ready;
    assert.deepEqual(landing.navigations,[`${role}.html`]);
    assert.equal(landing.calls.filter(c=>c==='getUser').length,1);
    const page=role==='admin'?'supervisor.html':'admin.html';
    const wrong=setup(t,page,options);assert.equal(await wrong.window.fyeAuth.ready,null);
    assert.deepEqual(wrong.navigations,[`${role}.html`]);
    assert.equal(wrong.calls.includes('signOut'),false);
    assert.notEqual(wrong.document.body.dataset.authState,'ready');
  });

  test(`${role} dashboard waits for session and signs out centrally`,async t=>{
    const app=setup(t,`${role}.html`,{role,approved:role==='mentor'});
    const account=await app.window.fyeAuth.ready;
    assert.equal(account.role,role);assert.equal(app.document.body.dataset.authState,'ready');
    const first=await app.window.fyeAuth.getAccount();const second=await app.window.fyeAuth.getAccount();
    assert.equal(first,second);assert.equal(app.calls.filter(c=>c==='getUser').length,1);
    const link=app.document.querySelector('.signout');
    link.dispatchEvent(new app.dom.window.MouseEvent('click',{bubbles:true,cancelable:true}));await settle();
    assert.equal(app.calls.filter(c=>c==='signOut').length,1);
    assert.equal(app.navigations.at(-1),'index.html');
  });
}

test('anonymous, disabled and unavailable profiles never enable dashboard features',async t=>{
  const anonymous=setup(t,'student.html',{signedIn:false});await anonymous.window.fyeAuth.ready;
  assert.deepEqual(anonymous.navigations,['index.html']);assert.notEqual(anonymous.document.body.dataset.authState,'ready');
  const disabled=setup(t,'supervisor.html',{role:'supervisor',disabled:true});await disabled.window.fyeAuth.ready;
  assert.equal(disabled.calls.includes('signOut'),true);assert.match(disabled.document.querySelector('.auth-status').textContent,/disabled/);
  const failed=setup(t,'admin.html',{role:'admin',profileError:true});await failed.window.fyeAuth.ready;
  assert.equal(failed.calls.includes('signOut'),false);assert.match(failed.document.querySelector('.auth-status').textContent,/could not be loaded/);
  failed.run('admin.js');await settle();assert.equal(failed.calls.filter(c=>c==='profiles').length,1);
});

test('cross-tab signout redirects every dashboard',async t=>{
  const app=setup(t,'student.html');await app.window.fyeAuth.ready;app.authEvent('SIGNED_OUT');
  assert.equal(app.navigations.at(-1),'index.html');
});

test('attendance return links retain QR token and reject arbitrary redirect URLs',async t=>{
  const next='event-attendance.html?token=abc%2F123%2Bxyz';
  const app=setup(t,'index.html',{search:`?${new URLSearchParams({next})}`});await app.window.fyeAuth.ready;
  assert.equal(app.navigations.at(-1),next);
  assert.equal(app.window.fyeAuth.signInUrl(next),`index.html?${new URLSearchParams({next})}`);
  for(const unsafe of ['https://other.test/event-attendance.html?token=123','//other.test/event-attendance.html?token=123','javascript:alert(1)','admin.html','event-attendance.html']) {
    assert.equal(app.window.fyeAuth.signInUrl(unsafe),'index.html');
  }
  const staff=setup(t,'index.html',{role:'admin',search:`?${new URLSearchParams({next})}`});await staff.window.fyeAuth.ready;
  assert.equal(staff.navigations.at(-1),'admin.html');
});

test('all dashboards load the shared guard before data scripts',()=>{
  for(const page of ['student.html','mentor.html','supervisor.html','admin.html']) {
    const source=read(page);
    assert.match(source,/<body data-auth-required>/);
    assert.ok(source.indexOf('src="academic.js"')<source.indexOf('src="auth.js"'));
    assert.ok(source.indexOf('src="auth.js"')<source.indexOf('src="dashboard-counts.js"'));
  }
});

test('calendar installs before dashboard navigation while session verification is pending',async t=>{
  for(const role of ['student','mentor','supervisor']) {
    const dom=new JSDOM(read(`${role}.html`),{url:`https://fye.test/${role}.html#calendar`,runScripts:'outside-only'});
    t.after(()=>dom.window.close());
    const w=dom.window;w.scrollTo=()=>{};
    w.fyeAuth={ready:new Promise(()=>{})};
    w.fyeSupabase={from(){throw Error('Data queried before account verification');}};
    w.eval(read('directory.js'));w.eval(read('calendar.js'));w.eval(read(`${role}.js`));
    const calendar=w.document.querySelector('[data-page="calendar"]');
    assert.ok(calendar,role);assert.equal(calendar.hidden,false,role);
    w.document.querySelector('[data-view="overview"]').click();
    assert.equal(calendar.hidden,true,role);
    w.document.querySelector('[data-view="calendar"]').click();
    assert.equal(calendar.hidden,false,role);
    assert.equal(w.document.querySelector('[data-page="overview"]').hidden,true,role);
  }
});

test('assignment badges use the verified dashboard role instead of the saved role',async t=>{
  for(const scenario of [
    {page:'mentor.html',role:'student',approved:true,view:'students',key:'mentor_id'},
    {page:'student.html',role:'mentor',approved:false,view:'mentor',key:'student_id'}
  ]) {
    const app=setup(t,scenario.page,scenario);await app.window.fyeAuth.ready;
    app.window.addEventListener=app.dom.window.addEventListener.bind(app.dom.window);
    app.window.setInterval=()=>0;
    app.window.fyeSupabase.from=table=>{
      assert.notEqual(table,'profiles');let assignmentKey;
      const query={select(){return this;},eq(key){assignmentKey=key;return this;},gte(){return this;},
        then(resolve,reject){return Promise.resolve({count:table==='active_mentor_assignments'&&assignmentKey===scenario.key?2:0}).then(resolve,reject);}};
      return query;
    };
    app.run('dashboard-counts.js');await settle();
    assert.equal(app.document.querySelector(`[data-view="${scenario.view}"] .nav-count`).textContent,'2');
    assert.equal(app.calls.filter(c=>c==='getUser').length,1);
  }
});

test('an anonymous QR attendance visit offers sign-in with its return token',async t=>{
  const app=setup(t,'event-attendance.html',{signedIn:false,search:'?token=qr%2Fabc'});
  await app.window.fyeAuth.ready;
  app.run('event-attendance.js');await settle();
  const link=app.document.querySelector('a.form-action');
  assert.ok(link);
  const url=new URL(link.getAttribute('href'),'https://fye.test/');
  assert.equal(url.pathname,'/index.html');
  assert.equal(url.searchParams.get('next'),'event-attendance.html?token=qr%2Fabc');
});
