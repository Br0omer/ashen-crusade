/* Run from the repository: node tests/arch061-contract.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'arch061', 'js');
const context = vm.createContext({console, Image: class {
  constructor(){this.naturalWidth=208;this.naturalHeight=256;}
  set src(value){this._src=value;this.onload();}
}});
for (const file of ['projection.js','hero-definition.js','character-visual.js']) {
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
}
(async()=>{
  await vm.runInContext(`
    globalThis.view = new CharacterViews.StaticSpriteVisual(HERO_DEFINITION, WorldProjection);
    view.load();
  `,context);
  assert.equal(vm.runInContext('view.getStatus()',context),'ready');
  const result=vm.runInContext(`(() => {
    let error=0;let finite=true;
    for(let i=0;i<256;i++){
      const root={x:i*.3,y:-i*.2}, angle=i*Math.PI/128;
      const input={root,velocity:{x:25,y:13},aimAngle:angle,time:i/60,locomotion:'moving',action:'shoot',weaponId:'rifle-default',muzzleFlash:true,hurtFlash:false};
      const pose=view.preparePose(input), socket=view.getSocket('muzzle');
      const projected=WorldProjection.delta(socket.x-root.x,socket.y-root.y);
      error=Math.max(error,Math.abs(projected.x-pose.muzzlePixels.x),Math.abs(projected.y-socket.elevationPx-pose.muzzlePixels.y));
      const saved=JSON.stringify(pose);
      input.root.x=99999;
      const ctx=new Proxy({}, {get:(_,key)=>()=>{},set:()=>true});
      view.render(ctx,{x:600,y:400});view.render(ctx,{x:600,y:400});
      finite=finite&&JSON.stringify(view.getPose())===saved&&Object.isFrozen(socket)&&Object.isFrozen(pose.root);
    }
    return {error,finite};
  })()`,context);
  assert.ok(result.error<1e-9,JSON.stringify(result));
  assert.ok(result.finite);
  assert.throws(()=>vm.runInContext("view.getSocket('missing')",context),/Unknown socket/);
  console.log('PASS: 256 muzzle directions, immutable snapshots, render without game globals, unknown socket guard.');
})().catch(error=>{console.error(error);process.exitCode=1;});
