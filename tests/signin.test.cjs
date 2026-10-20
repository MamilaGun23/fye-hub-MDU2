const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
const settle = async () => { for (let i=0; i<8; i++) await new Promise(r=>setImmediate(r)); };

for (const scenario of [
  {role:'student', approved:false, page:'student.html'},
  {role:'student', approved:true, page:'mentor.html'},
  {role:'mentor', approved:true, page:'mentor.html'},
  {role:'mentor', approved:false, page:'student.html'},
  {role:'supervisor', page:'supervisor.html'},
  {role:'admin', page:'admin.html'},
  {role:'admin', is_active:false, error:/disabled/},
  {role:'unknown', error:/supported role/},
  {role:'student', missing:true, error:/find a profile/},
  {role:'student', badPassword:true, error:/Check your email and password/},
  {role:'student', rpcFailure:true, error:/Something went wrong/}
]) {
  test(`single sign-in resolves ${JSON.stringify(scenario)}`, async t => {
    const dom = new JSDOM(read('index.html')); t.after(()=>dom.window.close());
    const document = dom.window.document;
    dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
    let destination, signedOut=false, credentials;
    const window = {
      location:{pathname:'/index.html',search:'',href:'https://fye.test/index.html',replace:page=>{destination=page;}},
      fyeAcademic:{mentor:async()=>{if(scenario.rpcFailure) throw Error('RPC unavailable');return !!scenario.approved;}},
      fyeSupabase:{auth:{
        getUser:async()=>({data:{user:null}}),
        signInWithPassword:async args=>{credentials=args;return {data:{user:{id:'account'}},error:scenario.badPassword?{}:null};},
        signOut:async()=>{signedOut=true;return {};}
      },from:()=>({select(){return this;},eq(){return this;},single:async()=>({data:scenario.missing?null:{role:scenario.role,is_active:scenario.is_active??true}})})}
    };
    const context = vm.createContext({document,window,location:window.location,URL,URLSearchParams,console:{error(){}}});
    vm.runInContext(read('auth.js'),context);
    vm.runInContext(read('script.js'),context);
    assert.equal(document.querySelectorAll('#open-signin').length,1);
    assert.equal(document.querySelector('[data-role]'),null);
    document.querySelector('#open-signin').click();
    assert.equal(document.querySelector('.login-dialog').open,true);
    document.querySelector('#email').value='person@ump.ac.za'; document.querySelector('#password').value='password';
    document.querySelector('#login-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
    await settle();
    assert.equal(credentials.email,'person@ump.ac.za');
    assert.equal(destination,scenario.page);
    if(scenario.error) assert.match(document.querySelector('.form-message').textContent,scenario.error);
    if(scenario.is_active===false || scenario.role==='unknown' || scenario.missing) assert.equal(signedOut,true);
    assert.equal(document.querySelector('#login-form button').disabled,false);
  });
}
