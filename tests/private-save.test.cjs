const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {save,read,privatePath}=require('../scripts/demo/files.cjs');

test('private checkpoints retry transient Windows file locks without losing data',t=>{
 const batch='checkpoint-test-'+crypto.randomBytes(4).toString('hex'),file=batch+'/progress.json',dir=privatePath(batch);
 t.after(()=>{assert(dir.startsWith(path.resolve(__dirname,'../.demo-seed')+path.sep+'checkpoint-test-'));fs.rmSync(dir,{recursive:true,force:true});});
 save(file,{completed:1});
 const original=fs.renameSync;let attempts=0;
 fs.renameSync=function(source,target){
  if(target===privatePath(file)&&++attempts<3)throw Object.assign(Error('File is temporarily open'),{code:'EPERM'});
  return original.call(this,source,target);
 };
 try {save(file,{completed:2});}
 finally {fs.renameSync=original;}
 assert.equal(attempts,3);assert.deepEqual(read(file),{completed:2});
 assert.deepEqual(fs.readdirSync(dir),['progress.json']);
});
