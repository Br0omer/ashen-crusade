/* node tests/rifles-b1-contract.cjs
 * RIFLES-B1 contract. The prototype page scripts (prototypes/rifles-b1/index.html) run in an isolated
 * Node VM together with the unchanged arch062/js scripts. Only the browser environment (DOM stubs,
 * getGamepads, Image/canvas stubs) is simulated. Real update(dt) and input() are used throughout.
 * A is compared tick by tick with the real arch062 build; B1 is checked against independent numbers.
 * Not a sandbox for untrusted code: it executes this repository's own scripts.
 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const REPO=path.resolve(__dirname,'..');
const PROTO=path.join(REPO,'prototypes/rifles-b1');
const A062=path.join(REPO,'arch062');
const BTN={RB:5,RT:7,PAUSE:9};
const DT=.016,EPS=1e-9;
const read=file=>fs.readFileSync(file,'utf8');
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<EPS,`${msg}: ${a} vs ${b}`);

/* ---------- environment stubs (graphics readiness only) ---------- */
function recordingContext(log,calls=[]){
  const store={};
  return new Proxy(store,{
    get(target,key){
      if(typeof key==='symbol')return undefined;
      if(key in target)return target[key];
      if(key==='save')return target[key]=()=>{(target.__stack||(target.__stack=[])).push(['fillStyle','strokeStyle','lineWidth','globalAlpha'].map(k=>[k,target[k]]));};
      if(key==='restore')return target[key]=()=>{const saved=(target.__stack||[]).pop();if(saved)for(const [k,v] of saved)target[k]=v;};
      if(key==='moveTo'||key==='lineTo')return target[key]=(px,py)=>{calls.push({op:key,x:px,y:py,strokeStyle:target.strokeStyle});};
      if(key==='getImageData'||key==='createImageData'){
        const make=(a,b,c,d)=>{const w=key==='getImageData'?c:a,h=key==='getImageData'?d:b;return {data:new Uint8ClampedArray(w*h*4),width:w,height:h};};
        return target[key]=make;
      }
      return target[key]=()=>{};
    },
    set(target,key,value){target[key]=value;if(key==='fillStyle'||key==='strokeStyle')log.push([key,value]);return true;}
  });
}
function pageScripts(){
  const html=read(path.join(PROTO,'index.html'));
  return [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m=>m[1]);
}
function assertInside(file){assert.ok(file.startsWith(REPO+path.sep),'path escapes the repository: '+file);return file;}

const ARCH_SCRIPTS=['core.js','input.js','projection.js','composite-definition.js','composite-visual.js','state.js','gameplay.js','character-bridge.js'];
/* kind 'arch062': the accepted build (reference). kind 'rifles': exactly the scripts listed in the prototype page. */
async function createGame({kind,aim={x:1,y:0},seed=20261123}){
  const gamepad={axes:[0,0,aim.x,aim.y],buttons:Array.from({length:10},()=>({pressed:false}))};
  const elements=new Map(),imageSrcs=[],paints=[],calls=[];
  const getElementById=id=>{if(!elements.has(id))elements.set(id,stubElement());return elements.get(id);};
  function stubElement(){
    return {style:{},textContent:'',disabled:false,onclick:null,src:'',width:0,height:0,dataset:{},
      addEventListener(){},getContext:()=>recordingContext(paints,calls),toDataURL:()=>'data:image/png;base64,'};
  }
  const defName=kind==='rifles'?'RIFLES_HERO_DEFINITION':'COMPOSITE_HERO_DEFINITION';
  let context;
  class FakeImage{
    set src(value){
      this._src=value;imageSrcs.push(value);
      Promise.resolve().then(()=>{
        const d=vm.runInContext(defName,context);let w=256,h=64;
        if(value===d.source){w=d.width;h=d.height;}
        else if(d.weapons.some(x=>x.addon===value)){w=d.canvasWidth;h=d.height;}
        this.naturalWidth=w;this.naturalHeight=h;this.complete=true;this.onload&&this.onload();
      });
    }
    get src(){return this._src;}
  }
  const sandbox={console,Image:FakeImage,innerWidth:1280,innerHeight:800,devicePixelRatio:1,performance:{now:()=>0},
    addEventListener(){},requestAnimationFrame(){},navigator:{getGamepads:()=>[gamepad]},
    document:{getElementById,querySelector:()=>stubElement(),createElement:()=>stubElement()}};
  context=vm.createContext(sandbox);
  vm.runInContext(`(()=>{let a=${seed|0};Math.random=function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}})()`,context);
  const files=kind==='rifles'
    ?pageScripts().map(src=>assertInside(path.resolve(PROTO,src)))
    :ARCH_SCRIPTS.map(f=>path.join(A062,'js',f));
  for(const file of files)vm.runInContext(read(file),context,{filename:path.relative(REPO,file)});
  const ev=code=>vm.runInContext(code,context);
  await ev('characterVisual.load()');
  await Promise.resolve();
  assert.equal(ev('characterVisual.getStatus()'),'ready',kind+': graphics must be ready');
  ev('spawn=1e9');
  const g={context,ev,gamepad,elements,imageSrcs,paints,calls,files,
    json:code=>JSON.parse(ev(`JSON.stringify(${code})`)),
    set(button,value){gamepad.buttons[button].pressed=value;},
    update(dt=DT){ev(`update(${dt})`);},
    clear(){ev("enemies=[];shots=[];particles=[];drops=[];level=1;paused=false;p.x=-2000;p.y=0;p.fire=0;p.flash=0;p.hp=100;p.weaponId='rifle-default';characterVisual.preparePose({root:{x:p.x,y:p.y},velocity:{x:0,y:0},aimAngle:0,time:0,weaponId:p.weaponId});");},
    enemies(list){
      ev(`for(const o of ${JSON.stringify(list)})enemies.push(Object.assign({hp:1000,max:1000,speed:0,r:12,col:'#8e9b83',type:'grunt',attack:0,id:++enemySerial},o))`);
    },
    shot(profileId,x,y,angle=0,extra={}){
      ev(`{const s=createShot(weaponProfile('${profileId}'),{x:${x},y:${y},elevationPx:12},${angle});Object.assign(s,${JSON.stringify(extra)});shots.push(s)}`);
    },
    hpByTag:()=>Object.fromEntries(g.json('enemies.map(e=>[e.tag,e.hp])'))
  };
  return g;
}

/* ---------- static: files, build info, stale text, resource paths ---------- */
const PREFIXES=['/ashen-crusade','','/other/site/root'];
function resolveUnderPrefix(prefix,ref){
  const url=new URL(ref,`https://host.test${prefix}/prototypes/rifles-b1/index.html`);
  assert.ok(url.pathname.startsWith(prefix+'/'),`reference escapes the site prefix ${prefix}: ${ref}`);
  const file=path.join(REPO,decodeURIComponent(url.pathname.slice(prefix.length+1)));
  assertInside(file);
  return file;
}
function staticChecks(){
  const html=read(path.join(PROTO,'index.html'));
  // no needless copies of shared arch062 scripts, styles or art
  for(const name of ['input.js','projection.js','composite-definition.js','composite-visual.js','diagnostics.js','boot.js','core.js','style.css','assets'])
    assert.ok(!fs.existsSync(path.join(PROTO,name))&&!fs.existsSync(path.join(PROTO,'js',name)),'copy of shared file: '+name);
  const refs=[...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map(m=>m[1]);
  assert.ok(refs.length>=15);
  for(const ref of refs){
    assert.ok(!/^(?:[a-z]+:)?\/\//i.test(ref)&&!ref.startsWith('/'),'absolute reference: '+ref);
    for(const prefix of PREFIXES)assert.ok(fs.existsSync(resolveUnderPrefix(prefix,ref)),`${ref} missing under prefix "${prefix}"`);
  }
  // shared files are read from arch062/ and are the ones the page uses
  for(const shared of ['style.css','js/core.js','js/input.js','js/projection.js','js/composite-definition.js','js/composite-visual.js','js/diagnostics.js','js/boot.js'])
    assert.ok(refs.includes('../../arch062/'+shared),'page must use arch062/'+shared);
  // no hard-coded site prefix anywhere in the prototype
  for(const file of ['index.html','build.json',...fs.readdirSync(path.join(PROTO,'js')).map(f=>'js/'+f)])
    assert.ok(!/ashen-crusade/i.test(read(path.join(PROTO,file))),'hard-coded site prefix in '+file);
  // version: js/version.js and build.json agree and differ from arch062
  const build=JSON.parse(read(path.join(PROTO,'build.json'))),ref062=JSON.parse(read(path.join(A062,'build.json')));
  const ctx=vm.createContext({document:{getElementById:()=>info,title:''}}),info={textContent:''};
  vm.runInContext(read(path.join(PROTO,'js/version.js')),ctx);
  const gb=JSON.parse(vm.runInContext('JSON.stringify(GAME_BUILD)',ctx));
  assert.equal(JSON.stringify(gb),JSON.stringify(build),'js/version.js must equal build.json');
  assert.notEqual(build.version,ref062.version);assert.notEqual(build.build,ref062.build);
  assert.match(build.version,/rifles-b1/);assert.match(info.textContent,/rifles-b1/);assert.equal(build.baseline,'arch062/');
  assert.notEqual(build.status,'accepted');
  // stale arch062 wording must be gone, new facts present
  const visible=html+read(path.join(PROTO,'js/character-bridge.js'));
  assert.ok(!/одинаков/i.test(visible),'stale text: identical characteristics');
  assert.ok(!/ARCH-06\.2 ·|ИГРОВОЙ СПРАЙТ|<title>[^<]*ARCH-06\.2/.test(html),'stale ARCH-06.2 page title/label');
  assert.match(html,/<title>[^<]*RIFLES-B1/);
  for(const fact of ['0,17','0,40','36','27 + 2','3 разных','бирюзов','янтарн'])assert.ok(html.includes(fact),'page text lacks: '+fact);
  return 'static';
}
/* The copied scene code must stay identical to arch062 apart from the declared differences. */
const squash=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'').replace(/\s+/g,'');
function fidelityChecks(){
  const origRender=squash(read(path.join(A062,'js/render.js')));
  let mine=read(path.join(PROTO,'js/render.js'));
  const drawShot=mine.match(/function drawShot\(s\)\{[\s\S]*?\n\}\n/);
  assert.ok(drawShot,'drawShot present');
  mine=mine.replace(drawShot[0],'').replace('for(let s of shots)drawShot(s);',"for(let s of shots){let q=iso(s.x,s.y);x.fillStyle='#ffcc72';x.beginPath();x.arc(q.x,q.y-(s.elevationPx??12),4,0,7);x.fill()}")
    .replace("arch062Asset('assets/cultist-sprites.svg?v=060')","'assets/cultist-sprites.svg?v=060'").replace("arch062Asset('assets/brute-sprites.svg?v=071')","'assets/brute-sprites.svg?v=071'");
  assert.equal(squash(mine),origRender,'render.js differs from arch062 beyond shots and asset paths');
  const origGame=squash(read(path.join(A062,'js/gameplay.js'))),myGameSrc=read(path.join(PROTO,'js/gameplay.js'));
  const head=origGame.slice(0,origGame.indexOf('functionupdate(')).replace('type,attack:0})','type,attack:0,id:++enemySerial})');
  const myHead=squash(myGameSrc.slice(myGameSrc.indexOf('function rand'),myGameSrc.indexOf('/* One projectile step')));
  assert.equal(myHead,head,'rand/hit/burst/enemy/damage/input differ from arch062');
  const myGame=squash(myGameSrc);
  const between=(a,b)=>origGame.slice(origGame.indexOf(a),origGame.indexOf(b)+b.length);
  for(const segment of [
    between('letmag=','burst(p.x,p.y,\'#7cb9e5\',12)}'),
    between('if(k.melee&&p.melee<=0)',"if(t>100&&!boss){enemy('boss');boss=true}"),
    origGame.slice(origGame.indexOf('for(leteofenemies){if(e.hp<=0)continue;'))
  ])assert.ok(segment.length>200&&myGame.includes(segment),'gameplay segment differs from arch062: '+segment.slice(0,60));
  return 'fidelity';
}

/* ---------- pure geometry and profile data ---------- */
async function profileAndGeometry(){
  const g=await createGame({kind:'rifles'});
  const P=g.json('[WEAPON_PROFILES["rifle-default"],WEAPON_PROFILES["rifle-long"]]'),[A,B]=P;
  assert.equal(A.id,'A');assert.equal(B.id,'B1');
  assert.equal(A.cooldown,.17);assert.equal(B.cooldown,.40);
  for(const key of ['speed','life','hitPad'])assert.equal(A[key],B[key],key+' must match between A and B1');
  assert.equal(A.speed,780);assert.equal(A.life,.8);assert.equal(A.hitPad,5);
  assert.equal(A.pierce,1);assert.equal(B.pierce,3);
  for(const level of [1,2,4,5,9,20]){
    assert.equal(g.ev(`WEAPON_PROFILES['rifle-default'].damage(${level})`),27+2*level,'A damage');
    assert.equal(g.ev(`WEAPON_PROFILES['rifle-long'].damage(${level})`),Math.max(36,27+2*level),'B1 damage');
  }
  assert.equal(g.ev("weaponProfile('rifle-long')===WEAPON_PROFILES['rifle-long']"),true);
  assert.throws(()=>g.ev("weaponProfile('nope')"),/No weapon profile/);
  const entry=(...a)=>g.ev(`segmentCircleEntry(${a.join(',')})`);
  assert.equal(entry(0,0,200,0,100,0,10),.45,'first entry, not the centre');
  assert.equal(entry(0,0,200,0,5,0,10),0,'start inside');
  assert.equal(entry(0,0,200,0,10,0,10),0,'start exactly on the edge');
  assert.equal(entry(0,0,200,0,100,17,17),.5,'tangent touch counts');
  assert.equal(entry(0,0,200,0,100,17.001,17),null,'just misses');
  assert.equal(entry(0,0,200,0,300,0,10),null,'beyond the end of the segment');
  assert.equal(entry(0,0,200,0,-100,0,10),null,'circle behind');
  assert.equal(entry(0,0,0,0,50,0,10),null,'zero length, outside');
  assert.equal(entry(0,0,0,0,5,0,10),0,'zero length, inside');
  assert.equal(entry(0,0,200,0,190,0,10),.9,'enters inside the segment');
  assert.equal(entry(0,0,200,0,210,0,10),1,'enters exactly at the end');
  assert.equal(entry(0,0,200,0,215,0,10),null,'enters just after the end');
  for(const v of [entry(0,0,200,0,100,3,10),entry(0,0,200,0,0,0,10),entry(-5,-5,200,0,100,0,10)])assert.ok(v===null||(v>=0&&v<=1));
  return 'profiles+geometry';
}

/* ---------- A is unchanged: tick-by-tick comparison with the real arch062 build ---------- */
const SNAPSHOT=`JSON.stringify({fire:p.fire,x:p.x,y:p.y,weapon:p.weaponId,level,score,kills,exp,particles:particles.length,drops:drops.length,hp:p.hp,
  shots:shots.map(s=>[s.x,s.y,s.vx,s.vy,s.life,s.elevationPx]),
  enemies:enemies.map(e=>[e.x,e.y,e.hp,e.knock,e.flash,e.type])})`;
/* The muzzle depends on the aim, so enemies are placed in the frame of the real bullet line. */
async function laneFor(aim){
  const g=await createGame({kind:'rifles',aim}),angle=Math.atan2(aim.y,aim.x);
  g.ev(`p.x=0;p.y=0;p.angle=${angle};prepareCharacterPose()`);
  const m=g.json("characterVisual.getSocket('muzzle')");
  return {o:{x:m.x,y:m.y},dir:{x:Math.cos(angle),y:Math.sin(angle)}};
}
async function runParity(kind,aim,script,lane){
  const g=await createGame({kind,aim});
  const at=(d,lat)=>({x:lane.o.x+lane.dir.x*d-lane.dir.y*lat,y:lane.o.y+lane.dir.y*d+lane.dir.x*lat});
  const list=[{...at(260,0),hp:45,max:45,speed:0,r:12,type:'grunt'},{...at(262,4),hp:45,max:45,speed:0,r:12,type:'grunt'},
    {...at(340,-3),hp:100,max:100,speed:0,r:20,type:'brute'},{...at(300,12),hp:45,max:45,speed:0,r:12,type:'grunt'}];
  g.ev(`enemies.push(...${JSON.stringify(list)}.map(o=>Object.assign({col:'#8e9b83',attack:0},o)))`);
  g.ev("p.x=0;p.y=0");
  g.set(BTN.RT,true);
  const snaps=[];
  for(let i=0;i<110;i++){
    if(script[i])g.ev(script[i]);
    g.update(DT);snaps.push(g.ev(SNAPSHOT));
  }
  return snaps;
}
async function parity(){
  // The shooter stands still at the world origin; aim points along several directions so that
  // both the hit line and the muzzle offset differ.
  for(const aim of [{x:1,y:0},{x:.5,y:.8},{x:.9,y:-.4}]){
    const script={20:'level=9',60:'level=4'},lane=await laneFor(aim);
    const ref=await runParity('arch062',aim,script,lane),mine=await runParity('rifles',aim,script,lane);
    assert.equal(mine.length,ref.length);
    for(let i=0;i<ref.length;i++)assert.equal(mine[i],ref[i],`A diverges from arch062 at tick ${i} aim ${JSON.stringify(aim)}`);
    const states=mine.map(s=>JSON.parse(s));
    assert.ok(states.some(s=>s.kills>0||s.enemies.some(e=>e[3]>0)),'the A scenario must really hit: '+JSON.stringify(aim));
    assert.ok(states.some(s=>s.shots.length>1)&&states.some(s=>s.fire>0));
  }
  return 'A parity';
}

/* ---------- B1 projectile mechanics through the real update(dt) ---------- */
/* Fire one real shot at tick 1 and return its origin line so targets can be placed on its path. */
function fireLane(g,weaponId){
  g.clear();g.ev(`p.weaponId='${weaponId}'`);
  g.set(BTN.RT,true);g.update(DT);g.set(BTN.RT,false);
  assert.equal(g.ev('shots.length'),1,'one shot fired');
  const s=g.json('({x:shots[0].x,y:shots[0].y,vx:shots[0].vx,vy:shots[0].vy})'),speed=Math.hypot(s.vx,s.vy);
  const dir={x:s.vx/speed,y:s.vy/speed},origin={x:s.x-s.vx*DT,y:s.y-s.vy*DT};
  return {dir,origin,at:d=>({x:origin.x+dir.x*d,y:origin.y+dir.y*d})};
}
function settle(g,max=80){let n=0;while(g.ev('shots.length')>0&&n++<max)g.update(DT);assert.ok(n<max,'shot must end');return n;}

async function levels(){
  const expected={1:36,4:36,5:37,9:45};
  for(const [level,damage] of Object.entries(expected)){
    const g=await createGame({kind:'rifles'});
    const lane=fireLane(g,'rifle-long');
    g.ev(`level=${level}`);
    g.enemies([{...lane.at(150),tag:'t'}]);
    settle(g);
    assert.equal(g.hpByTag().t,1000-damage,`B1 damage at level ${level}`);
  }
  // damage is computed at the moment of the hit, not at firing time
  const g=await createGame({kind:'rifles'});
  const lane=fireLane(g,'rifle-long');
  g.enemies([{...lane.at(300),tag:'t'}]);
  g.update(DT);g.ev('level=9');settle(g);
  assert.equal(g.hpByTag().t,1000-45,'level read at the hit');
  return 'B1 levels 1,4,5,9';
}
async function reverseOrder(){
  const g=await createGame({kind:'rifles'});
  const lane=fireLane(g,'rifle-long');
  // four targets on the path, array stored far-to-near
  g.enemies([230,180,130,80].map(d=>({...lane.at(d),tag:'d'+d})));
  settle(g);
  const hp=g.hpByTag();
  assert.deepEqual(hp,{d230:1000,d180:1000-36,d130:1000-36,d80:1000-36},'3 nearest targets, once each');
  return 'four enemies reversed';
}
async function tunnelling(){
  const g=await createGame({kind:'rifles'});g.clear();
  // 780*.033 = 25.74 per tick; the circle (radius 1+5) lies fully between the two end points.
  g.enemies([{x:12.87,y:0,r:1,tag:'small'}]);
  g.shot('rifle-long',0,0);g.update(.033);
  assert.equal(g.hpByTag().small,1000-36,'B1 hits an enemy between the tick end points');
  g.clear();g.enemies([{x:12.87,y:0,r:1,tag:'small'}]);
  g.shot('rifle-default',0,0);g.update(.033);
  assert.equal(g.hpByTag().small,1000,'A keeps the discrete rule and misses it');
  return 'tunnelling';
}
async function entryOrder(){
  const g=await createGame({kind:'rifles'});
  const specs=[{tag:'E1',x:100,r:20},{tag:'E2',x:95,r:12},{tag:'E3',x:125,r:20},{tag:'E4',x:120,r:12}];
  // entry order E1(75) E2(78) E3(100) E4(103); centre order E2 E1 E4 E3
  const orders=permutations(specs);
  assert.equal(orders.length,24);
  for(const order of orders){
    g.clear();g.enemies(order.map(s=>({...s,y:0})));
    g.shot('rifle-long',0,0);g.update(.2);
    assert.deepEqual(g.hpByTag(),{E1:964,E2:964,E3:964,E4:1000},'order '+order.map(s=>s.tag).join(','));
  }
  return 'entry order != centre order';
}
async function ties(){
  const g=await createGame({kind:'rifles'});
  // exact integer geometry: the same first-entry time (100/250) for different radii
  const same=[{tag:'r2',x:107,r:2},{tag:'r12',x:117,r:12},{tag:'r20',x:125,r:20},{tag:'r28',x:133,r:28}];
  for(const order of permutations(same)){
    g.clear();g.enemies(order.map(s=>({...s,y:0})));
    g.shot('rifle-long',0,0,0,{vx:1000,vy:0});g.update(.25);
    assert.deepEqual(g.hpByTag(),{r2:964,r12:964,r20:964,r28:1000},'equal t, nearer centre first: '+order.map(s=>s.tag));
  }
  // mirror images: equal entry time and distance; the lower y wins whatever the array order
  const mirror=[{tag:'a+',x:200,y:10},{tag:'a-',x:200,y:-10},{tag:'b+',x:300,y:10},{tag:'b-',x:300,y:-10}];
  for(const order of permutations(mirror)){
    g.clear();g.enemies(order);
    g.shot('rifle-long',0,0,0,{vx:1000,vy:0});g.update(.4);
    assert.deepEqual(g.hpByTag(),{'a+':964,'a-':964,'b+':1000,'b-':964},'mirror tie: '+order.map(s=>s.tag));
  }
  return 'tie-break';
}
async function uniqueness(){
  const g=await createGame({kind:'rifles'});g.clear();
  // a wide target on the path: the projectile stays inside it for several ticks
  g.enemies([{x:60,y:0,r:20,tag:'wide'},{x:200,y:0,tag:'far'}]);
  g.shot('rifle-long',0,0);
  const ref=g.ev('shots[0]');
  let sizes=[];
  for(let i=0;i<5;i++){g.update(DT);sizes.push(ref.hit.size);}
  assert.equal(g.hpByTag().wide,1000-36,'one hit across several ticks inside the circle');
  assert.ok(sizes.includes(1)&&ref.remaining<=2);
  settle(g);
  assert.deepEqual(g.hpByTag(),{wide:1000-36,far:1000-36});
  // a projectile that begins inside a target hits it at once, and only once
  g.clear();g.enemies([{x:60,y:0,r:20,tag:'wide'}]);
  g.shot('rifle-long',60,0);g.update(DT);
  assert.equal(g.hpByTag().wide,1000-36);
  settle(g);assert.equal(g.hpByTag().wide,1000-36);
  // the limit of 3 ends the projectile in the same tick
  g.clear();g.enemies([40,70,100,130,160].map(x=>({x,y:0,tag:'x'+x})));
  g.shot('rifle-long',0,0);const limited=g.ev('shots[0]');
  g.update(.2);
  assert.equal(limited.remaining,0);assert.equal(limited.hit.size,3);assert.equal(g.ev('shots.length'),0);
  return 'uniqueness';
}
async function rangeLimit(){
  const g=await createGame({kind:'rifles'});g.clear();
  g.enemies([{x:90,y:0,tag:'in'},{x:100,y:0,tag:'out'}]);  // entries 73 and 83; 0.1 s of range left = 78
  g.shot('rifle-long',0,0,0,{life:.1});
  const ref=g.ev('shots[0]');
  g.update(.25);
  assert.deepEqual(g.hpByTag(),{in:1000-36,out:1000},'segment cut at the end of the range');
  assert.ok(ref.x<=78.0001&&ref.x>77.99,'position not beyond the range: '+ref.x);
  assert.equal(g.ev('shots.length'),0);
  // a full tick that ends beyond a target but with plenty of life behaves normally
  g.clear();g.enemies([{x:100,y:0,tag:'near'}]);g.shot('rifle-long',0,0);g.update(.2);
  assert.equal(g.hpByTag().near,1000-36);
  return 'range limit';
}
async function twoShots(){
  const g=await createGame({kind:'rifles'});g.clear();
  g.enemies([{x:40,y:0,tag:'e40'},{x:70,y:0,tag:'e70'},{x:100,y:0,tag:'e100'},{x:130,y:0,tag:'e130'}]);
  g.shot('rifle-long',0,0);g.shot('rifle-long',60,0);
  const [s1,s2]=[g.ev('shots[0]'),g.ev('shots[1]')];
  assert.notEqual(s1.hit,s2.hit,'own Set per projectile');
  g.update(.2);
  assert.deepEqual(g.hpByTag(),{e40:964,e70:928,e100:928,e130:964},'independent hit lists');
  assert.equal(s1.remaining,0);assert.equal(s2.remaining,0);
  return 'two shots';
}

/* ---------- RB / RT ---------- */
function expectedMuzzle(def,weaponId,rootPos,angle){
  const w=def.weapons.find(x=>x.id===weaponId);
  const aimScreenX=(Math.cos(angle)-Math.sin(angle))*.78;
  assert.ok(Math.abs(aimScreenX)>.06);
  const facing=aimScreenX<0?-1:1,scale=def.displayHeight/def.height;
  const ox=(w.muzzle.x+def.grips.primary.x-w.grip.x-def.anchor.x)*scale*facing;
  const oy=(w.muzzle.y+def.grips.primary.y-w.grip.y-def.anchor.y)*scale+def.projectileElevationPx;
  return {x:rootPos.x+(ox/.78+oy/.39)/2,y:rootPos.y+(oy/.39-ox/.78)/2,elevationPx:def.projectileElevationPx};
}
const START={x:123,y:-67};
const PROFILE_OF={'rifle-default':{id:'A',cooldown:.17,trail:'#ffcc72'},'rifle-long':{id:'B1',cooldown:.40,trail:'#4fe3d2'}};
function hue(hex){
  const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  if(!d)return 0;const h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;return (h*60+360)%360;
}
async function swapFire(){
  let count=0;
  for(const aim of [{x:.6,y:-.3},{x:-.7,y:.25}])for(const [from,to] of [['rifle-default','rifle-long'],['rifle-long','rifle-default']]){
    const g=await createGame({kind:'rifles',aim}),def=g.json('RIFLES_HERO_DEFINITION'),label=`${from}->${to} ${JSON.stringify(aim)}`;
    g.ev(`p.x=${START.x};p.y=${START.y};p.weaponId='${from}';prepareCharacterPose()`);
    g.set(BTN.RB,true);g.set(BTN.RT,true);g.update();
    assert.equal(g.ev('p.weaponId'),to,label+' swapped before the shot');
    assert.equal(g.ev('characterVisual.getPose().weaponId'),to);
    assert.equal(g.ev('shots.length'),1,label+' exactly one bullet');
    assert.equal(g.ev('p.fire'),PROFILE_OF[to].cooldown,label+' cooldown of the NEW weapon');
    const shot=g.json('({x:shots[0].x,y:shots[0].y,vx:shots[0].vx,vy:shots[0].vy,life:shots[0].life,e:shots[0].elevationPx,profile:shots[0].profile.id,trail:shots[0].trail})');
    const angle=g.ev('p.angle');
    assert.equal(shot.profile,PROFILE_OF[to].id);assert.equal(shot.trail,PROFILE_OF[to].trail);
    const origin={x:shot.x-shot.vx*DT,y:shot.y-shot.vy*DT},fresh=expectedMuzzle(def,to,START,angle),stale=expectedMuzzle(def,from,START,angle);
    near(origin.x,fresh.x,label+' muzzle x');near(origin.y,fresh.y,label+' muzzle y');
    assert.equal(shot.e,fresh.elevationPx,label+' elevationPx');
    assert.ok(Math.hypot(origin.x-stale.x,origin.y-stale.y)>5,label+' not the old muzzle');
    near(shot.life,.8-DT,label+' life');
    // both buttons are still held: no reverse swap, no shot while cooling down
    g.update(DT);
    assert.equal(g.ev('p.weaponId'),to,label+' no reverse swap');
    assert.equal(g.ev('shots.length'),1);
    count++;
  }
  return `RB+RT ${count} cases`;
}
async function cooldownsAndHold(){
  for(const weapon of ['rifle-default','rifle-long']){
    const g=await createGame({kind:'rifles'});g.clear();g.ev(`p.weaponId='${weapon}'`);
    g.set(BTN.RT,true);
    const model=[];let f=0;
    for(let i=0;i<120;i++){f=Math.max(0,f-DT);if(f<=0){model.push(i);f=PROFILE_OF[weapon].cooldown;}}
    const got=[];
    for(let i=0;i<120;i++){
      g.update();
      if(g.ev('shots.filter(s=>!s.counted).length')>0)got.push(i);
      g.ev('shots.forEach(s=>{s.counted=true})');
    }
    assert.deepEqual(got,model,weapon+' fires exactly on the cooldown grid while RT is held');
  }
  // RB+RT held for many ticks: one swap only, then the new cooldown grid
  const g=await createGame({kind:'rifles'});g.clear();
  g.set(BTN.RB,true);g.set(BTN.RT,true);
  const weapons=[];for(let i=0;i<40;i++){g.update();weapons.push(g.ev('p.weaponId'));}
  assert.ok(weapons.every(w=>w==='rifle-long'),'single swap while RB stays held');
  // the cooldown is shared and not reset by a swap: B1 shot, then swap to A while RT held
  const h=await createGame({kind:'rifles'});h.clear();h.ev("p.weaponId='rifle-long'");
  h.set(BTN.RT,true);h.update();assert.equal(h.ev('p.fire'),.40);
  h.set(BTN.RB,true);h.update();h.set(BTN.RB,false);
  assert.equal(h.ev('p.weaponId'),'rifle-default');
  near(h.ev('p.fire'),.40-DT,'swap does not reset the shared cooldown');
  assert.equal(h.ev('shots.length'),1,'A cannot fire on the B1 cooldown');
  let expectedTicks=0,f=.40-DT;do{expectedTicks++;f=Math.max(0,f-DT);}while(f>0);
  let guard=0;while(h.ev('shots.length')<2&&guard<60){h.update();guard++;}
  assert.equal(guard,expectedTicks,'A fires exactly when the leftover B1 cooldown ends');
  assert.equal(h.ev('shots.length'),2);
  assert.equal(h.ev("shots[1].profile.id"),'A');assert.equal(h.ev('p.fire'),.17);
  return 'cooldown, hold';
}
async function pauseBlocks(){
  const g=await createGame({kind:'rifles'});g.clear();
  g.set(BTN.PAUSE,true);g.update();g.set(BTN.PAUSE,false);
  assert.equal(g.ev('paused'),true);
  const before=g.ev('t');
  g.set(BTN.RB,true);g.set(BTN.RT,true);
  for(let i=0;i<5;i++)g.update();
  assert.equal(g.ev('p.weaponId'),'rifle-default','no swap while paused');
  assert.equal(g.ev('shots.length'),0,'no shot while paused');
  assert.equal(g.ev('p.fire'),0);assert.equal(g.ev('p.flash'),0);assert.equal(g.ev('t'),before);
  g.ev('cycleEquippedWeapon()');assert.equal(g.ev('p.weaponId'),'rifle-default','UI swap is blocked too');
  return 'pause';
}
async function swapInFlight(){
  // B1 in flight, then RB to A: the projectile keeps B1 rules, colour and limit
  let g=await createGame({kind:'rifles'});
  let lane=fireLane(g,'rifle-long');
  g.enemies([60,100,140,180].map(d=>({...lane.at(d),tag:'d'+d})));
  g.set(BTN.RB,true);g.update();g.set(BTN.RB,false);
  assert.equal(g.ev('p.weaponId'),'rifle-default');
  assert.equal(g.ev('shots[0].profile.id'),'B1');assert.equal(g.ev('shots[0].trail'),'#4fe3d2');
  assert.equal(g.ev('shots[0].remaining')+g.ev('shots[0].hit.size'),3);
  settle(g);
  assert.deepEqual(g.hpByTag(),{d60:964,d100:964,d140:964,d180:1000},'B1 projectile still pierces 3 after the swap');
  // A in flight, then RB to B1: the projectile stays discrete, single target, amber
  g=await createGame({kind:'rifles'});
  lane=fireLane(g,'rifle-default');
  g.enemies([60,100].map(d=>({...lane.at(d),tag:'d'+d})));
  g.set(BTN.RB,true);g.update();g.set(BTN.RB,false);
  assert.equal(g.ev('p.weaponId'),'rifle-long');
  assert.equal(g.ev('shots[0].profile.id'),'A');assert.equal(g.ev('shots[0].trail'),'#ffcc72');assert.equal(g.ev('shots[0].hit'),undefined);
  settle(g);
  assert.deepEqual(g.hpByTag(),{d60:1000-29,d100:1000},'A projectile still stops at the first target');
  return 'swap in flight';
}
async function flashAndColours(){
  for(const weapon of ['rifle-default','rifle-long']){
    const g=await createGame({kind:'rifles'});g.clear();g.ev(`p.weaponId='${weapon}'`);
    g.set(BTN.RT,true);g.update();g.set(BTN.RT,false);
    const flags=[];
    for(let i=0;i<8;i++){
      const pose=g.json('({flash:characterVisual.getPose().flash,action:characterVisual.getPose().action,fire:p.fire})');
      flags.push(pose);
      if(weapon==='rifle-default')assert.equal(pose.flash,pose.fire>.10,'A: same duration as arch062 (cooldown above 0.10)');
      assert.equal(pose.action==='shoot',pose.flash,'shoot action follows the flash');
      g.update();
    }
    const off=flags.findIndex(f=>!f.flash);
    assert.ok(flags[0].flash,weapon+' flash on the firing tick');
    assert.ok(off*DT>=.07-1e-9&&off*DT<.09,`${weapon}: flash lasts about 0.07 s (${off} ticks)`);
    if(weapon==='rifle-long')assert.ok(flags[off].fire>.25,'B1 flash ends long before the 0.40 s cooldown');
  }
  // trail colours: drawn from the colour stored in the projectile
  const g=await createGame({kind:'rifles'});g.clear();
  g.enemies([{x:0,y:0,tag:'g',type:'grunt'},{x:30,y:30,tag:'b',type:'brute',r:20},{x:-30,y:30,tag:'boss',type:'boss',r:20}]);
  const colours=()=>{g.paints.length=0;g.ev('render()');return new Set(g.paints.filter(([k])=>k==='strokeStyle'||k==='fillStyle').map(([,v])=>v));};
  g.shot('rifle-default',10,10);
  let c=colours();assert.ok(c.has('#ffcc72')&&!c.has('#4fe3d2'),'A trail only');
  g.ev('shots=[]');g.shot('rifle-long',10,10);
  c=colours();assert.ok(!c.has('#ffcc72')&&c.has('#4fe3d2'),'B1 trail only');
  g.shot('rifle-default',20,20);g.ev("p.weaponId='rifle-long'");
  c=colours();assert.ok(c.has('#ffcc72')&&c.has('#4fe3d2'),'both stay distinct, whichever rifle is equipped');
  const a=g.json('WEAPON_PROFILES["rifle-default"].trail'),b=g.json('WEAPON_PROFILES["rifle-long"].trail');
  assert.ok(hue(a)>=30&&hue(a)<=50,'A is amber');assert.ok(hue(b)>=160&&hue(b)<=190,'B1 is turquoise');
  return 'flash and colours';
}
/* Regression: the visible trail must never start behind the muzzle. The exact Canvas start/end points of
 * the trail segment are recorded and compared with an independently computed iso projection + elevation. */
async function trailGeometry(){
  const W=1280,H=800;                                  // sandbox innerWidth/innerHeight
  const isoPoint=(wx,wy,root,lift)=>({x:W/2+((wx-root.x)-(wy-root.y))*.78,y:H/2+((wx-root.x)+(wy-root.y))*.39-lift});
  let checked=0;
  for(const weapon of ['rifle-default','rifle-long'])for(const aim of [{x:.6,y:-.3},{x:-.7,y:.25}]){
    const label=`${weapon} aim ${JSON.stringify(aim)}`,colour=PROFILE_OF[weapon].trail;
    const g=await createGame({kind:'rifles',aim});g.clear();
    g.ev(`p.x=${START.x};p.y=${START.y};p.weaponId='${weapon}';prepareCharacterPose()`);
    g.set(BTN.RT,true);g.update();g.set(BTN.RT,false);
    const muzzle=g.json("characterVisual.getSocket('muzzle')"),root={x:START.x,y:START.y};
    const origin={x:muzzle.x,y:muzzle.y},lift=muzzle.elevationPx;
    assert.equal(lift,12,'projectile elevation');
    const full=780*.04;
    for(let frame=1;frame<=9;frame++){
      const s=g.json('({x:shots[0].x,y:shots[0].y,vx:shots[0].vx,vy:shots[0].vy})'),speed=Math.hypot(s.vx,s.vy);
      const travelled=Math.hypot(s.x-origin.x,s.y-origin.y);
      assert.ok(Math.abs(travelled-speed*DT*frame)<1e-6,`${label} frame ${frame}: travelled distance`);
      const length=Math.min(full,travelled),dir={x:s.vx/speed,y:s.vy/speed};
      g.calls.length=0;g.ev('render()');
      const drawn=g.calls.filter(c=>c.strokeStyle===colour);
      assert.equal(drawn.length,2,`${label} frame ${frame}: exactly one trail segment`);
      assert.equal(drawn[0].op,'moveTo');assert.equal(drawn[1].op,'lineTo');
      const start={x:drawn[0].x,y:drawn[0].y},end={x:drawn[1].x,y:drawn[1].y};
      const wantEnd=isoPoint(s.x,s.y,root,lift),wantStart=isoPoint(s.x-dir.x*length,s.y-dir.y*length,root,lift),muzzleOnScreen=isoPoint(origin.x,origin.y,root,lift);
      near(end.x,wantEnd.x,`${label} frame ${frame} end.x`);near(end.y,wantEnd.y,`${label} frame ${frame} end.y`);
      near(start.x,wantStart.x,`${label} frame ${frame} start.x`);near(start.y,wantStart.y,`${label} frame ${frame} start.y`);
      // never behind the muzzle: the start lies on the muzzle->head segment (screen space)
      const ax=end.x-muzzleOnScreen.x,ay=end.y-muzzleOnScreen.y,bx=start.x-muzzleOnScreen.x,by=start.y-muzzleOnScreen.y;
      assert.ok(ax*bx+ay*by>=-1e-6,`${label} frame ${frame}: trail starts behind the muzzle`);
      assert.ok(Math.hypot(bx,by)<=Math.hypot(ax,ay)+1e-6);
      if(travelled<full)near(Math.hypot(start.x-muzzleOnScreen.x,start.y-muzzleOnScreen.y),0,`${label} frame ${frame}: short trail starts at the muzzle`);
      else near(Math.hypot(end.x-start.x,end.y-start.y),Math.hypot(isoPoint(dir.x*full,dir.y*full,{x:0,y:0},0).x-W/2,isoPoint(dir.x*full,dir.y*full,{x:0,y:0},0).y-H/2),`${label} frame ${frame}: full .04 s trail length`);
      checked++;
      g.update();
    }
  }
  assert.equal(checked,36);
  return 'trail geometry';
}
async function restart(){
  const g=await createGame({kind:'rifles'});g.clear();g.ev("p.weaponId='rifle-long'");
  g.set(BTN.RT,true);g.update();g.set(BTN.RT,false);
  assert.ok(g.ev('shots.length')===1&&g.ev('p.fire')>0&&g.ev('p.flash')>0);
  g.ev('level=7;score=500');
  g.elements.get('play').onclick();
  assert.equal(g.ev('shots.length'),0);assert.equal(g.ev('p.fire'),0);assert.equal(g.ev('p.flash'),0);
  assert.equal(g.ev('characterVisual.getPose().flash'),false);assert.equal(g.ev('level'),1);
  assert.equal(g.ev('enemies.length'),0);assert.equal(g.ev('paused'),false);
  g.ev('spawn=1e9');
  g.set(BTN.RT,true);g.update();g.set(BTN.RT,false);
  assert.equal(g.ev('shots.length'),1,'fires immediately after restart');
  assert.equal(g.ev('shots[0].hit.size'),0);assert.equal(g.ev('shots[0].remaining'),3);
  return 'restart';
}

/* ---------- the page really loads its resources, from any site prefix ---------- */
async function pageResources(){
  const g=await createGame({kind:'rifles'});
  const expected=['arch062/assets/hero-approved.webp','arch062/assets/rifle-long-addon.svg','arch062/assets/cultist-sprites.svg','arch062/assets/brute-sprites.svg'];
  assert.equal(g.imageSrcs.length,expected.length,'exactly the expected images: '+g.imageSrcs.join(' '));
  for(const prefix of PREFIXES){
    const files=g.imageSrcs.map(src=>path.relative(REPO,resolveUnderPrefix(prefix,src.split(/[?#]/)[0])));
    for(const file of files)assert.ok(fs.existsSync(path.join(REPO,file)),`image missing under "${prefix}": ${file}`);
    assert.deepEqual([...files].sort(),[...expected].sort(),'image set under prefix "'+prefix+'"');
  }
  assert.equal(g.elements.get('build-info').textContent.includes('rifles-b1'),true);
  assert.equal(g.elements.get('play').disabled,false,'start enabled after load');
  assert.equal(g.elements.get('swap-weapon').disabled,false);
  assert.ok(/B1/.test(g.ev("(()=>{p.weaponId='rifle-long';refreshEquipmentView();return document.getElementById('weapon-name').textContent})()")),'equipment label names the profile');
  // the whole scene renders with every enemy type, projectile and pause overlay
  g.clear();
  g.enemies([{x:0,y:0,type:'grunt'},{x:50,y:0,type:'brute',r:20,windup:1},{x:-50,y:0,type:'boss',r:20}]);
  g.shot('rifle-default',0,0);g.shot('rifle-long',5,5);g.ev('paused=true');
  g.ev('render()');
  // the page scripts reference only files that exist and keep the original order of arch062
  const scripts=pageScripts();
  assert.ok(scripts.indexOf('js/asset-paths.js')<scripts.indexOf('js/render.js')&&scripts.indexOf('js/weapon-profiles.js')<scripts.indexOf('js/gameplay.js'));
  assert.ok(scripts.indexOf('../../arch062/js/boot.js')===scripts.length-1);
  return 'page resources';
}

function permutations(list){
  if(list.length<=1)return [list];
  return list.flatMap((item,i)=>permutations([...list.slice(0,i),...list.slice(i+1)]).map(rest=>[item,...rest]));
}

async function run(){
  const steps=[staticChecks,fidelityChecks,profileAndGeometry,parity,levels,reverseOrder,tunnelling,entryOrder,ties,uniqueness,rangeLimit,twoShots,
    swapFire,cooldownsAndHold,pauseBlocks,swapInFlight,flashAndColours,trailGeometry,restart,pageResources];
  const done=[];
  for(const step of steps)done.push(await step());
  console.log('PASS: RIFLES-B1 contract: '+done.join(', ')+'.');
}
module.exports={run};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
