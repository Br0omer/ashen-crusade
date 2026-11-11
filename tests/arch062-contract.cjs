/* node tests/arch062-contract.cjs. Pure pose/socket contract, no bitmap load. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../arch062/js'),context=vm.createContext({console});
for(const file of ['projection.js','composite-definition.js','composite-visual.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
vm.runInContext("globalThis.view=new CompositeCharacterViews.LayeredSpriteVisual(COMPOSITE_HERO_DEFINITION,WorldProjection,()=>{throw Error('No bitmap work in preparePose')});",context);
assert.throws(()=>vm.runInContext("view.getSocket('muzzle')",context),/preparePose/);
const result=vm.runInContext(`(()=>{
 let worst=0,immutable=true;
 for(const weapon of COMPOSITE_HERO_DEFINITION.weapons)for(let i=0;i<256;i++){
  const state={root:{x:123,y:-67},velocity:{x:30,y:10},aimAngle:i*Math.PI/128,time:4,weaponId:weapon.id,locomotion:'moving',action:'shoot',muzzleFlash:true};
  const pose=view.preparePose(state),socket=view.getSocket('muzzle'),screen=WorldProjection.delta(socket.x-123,socket.y+67);
  worst=Math.max(worst,Math.abs(screen.x-pose.muzzlePixels.x),Math.abs(screen.y-socket.elevationPx-pose.muzzlePixels.y));
  const before=JSON.stringify(pose);state.root.x=999;
  view.render(new Proxy({},{get:()=>()=>{},set:()=>true}),{x:640,y:400});
  immutable=immutable&&Object.isFrozen(pose)&&Object.isFrozen(socket)&&JSON.stringify(pose)===before;
 }
 return {worst,immutable};})()`,context);
assert.ok(result.worst<1e-9);assert.ok(result.immutable);
assert.throws(()=>vm.runInContext("view.getSocket('missing')",context),/Unknown socket/);
assert.throws(()=>vm.runInContext("view.preparePose({root:{x:0,y:0},velocity:{x:0,y:0},aimAngle:0,time:0,weaponId:'missing'})",context),/Unsupported weapon/);
assert.throws(()=>vm.runInContext("view.preparePose({root:{x:NaN,y:0},velocity:{x:0,y:0},aimAngle:0,time:0,weaponId:'rifle-default'})",context),/finite/);
console.log('PASS: 512 socket directions, immutable pose, unknown weapon/socket guards.');
