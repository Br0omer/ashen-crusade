/* node tests/arch062-swap-fire.cjs
 * ARCH-062 regression: RB (button 5) + RT (button 7) pressed in the same tick.
 * Production arch062/js scripts (input(), update(), cycleEquippedWeapon, the
 * muzzle socket / pose code) run unmodified in an isolated Node VM. Only the browser
 * environment (DOM stubs, getGamepads) and graphics readiness (Image/canvas stubs)
 * are simulated. The expected muzzle is computed independently from definition data.
 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../arch062/js');
const SCRIPTS=['core.js','input.js','projection.js','composite-definition.js','composite-visual.js','state.js','gameplay.js','character-bridge.js'];
const A='rifle-default',B='rifle-long',EPS=1e-9;
const BTN_RB=5,BTN_RT=7;

function stubElement(){
  const el={style:{},textContent:'',disabled:false,onclick:null,src:'',width:0,height:0,dataset:{},
    addEventListener(){},getContext:()=>stub2d(),toDataURL:()=>'data:image/png;base64,'};
  return el;
}
function stub2d(){
  const img=(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h});
  return {drawImage(){},clearRect(){},putImageData(){},setTransform(){},
    getImageData:(x,y,w,h)=>img(w,h),createImageData:(w,h)=>img(w,h)};
}

/* A fresh, isolated VM per case: no shared input edge state, shots or timers. */
async function createGame({aim}){
  const gamepad={axes:[0,0,aim.x,aim.y],buttons:Array.from({length:10},()=>({pressed:false}))};
  const elements=new Map();
  const getElementById=id=>{if(!elements.has(id))elements.set(id,stubElement());return elements.get(id);};
  let defRef=null;
  class FakeImage{ // graphics readiness only: reports the dimensions the real asset must have
    set src(value){
      this._src=value;
      Promise.resolve().then(()=>{
        const d=defRef,addon=d.weapons.some(w=>w.addon===value);
        this.naturalWidth=addon?d.canvasWidth:d.width;this.naturalHeight=d.height;
        this.onload&&this.onload();
      });
    }
    get src(){return this._src;}
  }
  const sandbox={console,Image:FakeImage,innerWidth:1280,innerHeight:800,devicePixelRatio:1,
    addEventListener(){},requestAnimationFrame(){},
    navigator:{getGamepads:()=>[gamepad]},
    document:{getElementById,querySelector:()=>stubElement(),
      createElement:()=>Object.assign(stubElement(),{})}};
  const context=vm.createContext(sandbox);
  for(const file of SCRIPTS){
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
    if(file==='composite-definition.js')defRef=vm.runInContext('COMPOSITE_HERO_DEFINITION',context);
  }
  const ev=code=>vm.runInContext(code,context);
  await ev('characterVisual.load()');           // production load(), simulated bitmaps
  await Promise.resolve();                       // let the bridge's .then(...) finish
  assert.equal(ev('characterVisual.getStatus()'),'ready','graphics must be ready for swapping');
  ev('spawn=1e9');                               // no enemy spawn; enemies stay empty
  assert.equal(ev('enemies.length'),0);
  assert.equal(ev('paused'),false);
  return {context,ev,gamepad,def:defRef,
    holdBoth(){gamepad.buttons[BTN_RB].pressed=true;gamepad.buttons[BTN_RT].pressed=true;}};
}

/* Independent expectation: no WorldProjection / preparePose calls. */
function expectedMuzzle(def,weaponId,rootPos,angle){
  const w=def.weapons.find(x=>x.id===weaponId);
  const aimScreenX=(Math.cos(angle)-Math.sin(angle))*.78;
  assert.ok(Math.abs(aimScreenX)>.06,'test aim must not hit the facing dead zone');
  const facing=aimScreenX<0?-1:1,scale=def.displayHeight/def.height;
  const ox=(w.muzzle.x+def.grips.primary.x-w.grip.x-def.anchor.x)*scale*facing;
  const oy=(w.muzzle.y+def.grips.primary.y-w.grip.y-def.anchor.y)*scale+def.projectileElevationPx;
  return {x:rootPos.x+(ox/.78+oy/.39)/2,y:rootPos.y+(oy/.39-ox/.78)/2,elevationPx:def.projectileElevationPx};
}
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<EPS,`${msg}: ${a} vs ${b}`);

const AIMS={right:{x:.6,y:-.3},left:{x:-.7,y:.25}};
const START={x:123,y:-67},DT=.016;

async function setup(from,aimName){
  const g=await createGame({aim:AIMS[aimName]});
  g.ev(`p.x=${START.x};p.y=${START.y};p.weaponId='${from}';prepareCharacterPose()`);
  assert.equal(g.ev('characterVisual.getPose().weaponId'),from);
  assert.equal(g.ev('p.fire'),0);
  assert.equal(g.ev('shots.length'),0);
  return g;
}

async function fireCase(from,to,aimName){
  const label=`${from}->${to} aim ${aimName}`,g=await setup(from,aimName);
  g.holdBoth();
  g.ev(`update(${DT})`);                         // one real tick, RB+RT edge in the same tick
  assert.equal(g.ev('p.weaponId'),to,label+': new weapon equipped');
  assert.equal(g.ev('characterVisual.getPose().weaponId'),to,label+': pose uses the new weapon');
  assert.equal(g.ev('shots.length'),1,label+': exactly one bullet');
  assert.equal(g.ev('p.fire'),.17,label+': cooldown set to 0.17');
  assert.equal(g.ev('p.vx'),0);assert.equal(g.ev('p.vy'),0);
  near(g.ev('p.x'),START.x,label+' hero x');near(g.ev('p.y'),START.y,label+' hero y');
  const shot=g.ev('({...shots[0]})'),angle=g.ev('p.angle');
  assert.ok(Math.abs(angle-Math.atan2(AIMS[aimName].y,AIMS[aimName].x))<EPS,label+': real input aim');
  // update() already advanced the new bullet once; compensate by its own velocity*dt.
  near(shot.vx,Math.cos(angle)*780,label+' vx');near(shot.vy,Math.sin(angle)*780,label+' vy');
  const origin={x:shot.x-shot.vx*DT,y:shot.y-shot.vy*DT};
  const fresh=expectedMuzzle(g.def,to,START,angle),stale=expectedMuzzle(g.def,from,START,angle);
  near(origin.x,fresh.x,label+' origin.x');near(origin.y,fresh.y,label+' origin.y');
  assert.equal(shot.elevationPx,fresh.elevationPx,label+': elevationPx');
  near(shot.life,.8-DT,label+' life');
  assert.ok(Math.hypot(origin.x-stale.x,origin.y-stale.y)>5,label+': origin must differ from the old weapon muzzle');
  const socket=g.ev('({...characterVisual.getSocket("muzzle")})');
  near(socket.x,fresh.x,label+' pose socket.x');near(socket.y,fresh.y,label+' pose socket.y');
}

async function residualCase(from,to,aimName){
  const label=`residual ${from}->${to} aim ${aimName}`,g=await setup(from,aimName);
  const FIRE=.05,DT1=.016,DT2=.01;
  g.ev(`p.fire=${FIRE}`);
  g.holdBoth();
  g.ev(`update(${DT1})`);
  assert.equal(g.ev('p.weaponId'),to,label+': swapped');
  assert.equal(g.ev('characterVisual.getPose().weaponId'),to,label+': pose swapped');
  assert.equal(g.ev('shots.length'),0,label+': no bullet while cooling down');
  const rest=Math.max(0,FIRE-DT1);
  assert.ok(rest>DT2,'precondition: leftover cooldown exceeds the next tick');
  near(g.ev('p.fire'),rest,label+': cooldown minus dt');
  g.ev(`update(${DT2})`);                         // both buttons still held, no new edge
  assert.equal(g.ev('p.weaponId'),to,label+': no reverse swap');
  assert.equal(g.ev('characterVisual.getPose().weaponId'),to,label+': pose not reverted');
  assert.equal(g.ev('shots.length'),0,label+': no extra bullet');
  near(g.ev('p.fire'),rest-DT2,label+': cooldown keeps counting down');
}

async function run(){
  let count=0;
  for(const aim of Object.keys(AIMS)){
    await fireCase(A,B,aim);count++;
    await fireCase(B,A,aim);count++;
    await residualCase(A,B,aim);count++;
    await residualCase(B,A,aim);count++;
  }
  console.log(`PASS: ARCH-062 RB+RT same tick, ${count} cases (A->B, B->A, residual cooldown, no reverse swap).`);
}
module.exports={run};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
