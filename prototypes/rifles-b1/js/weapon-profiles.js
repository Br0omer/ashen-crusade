/* RIFLES-B1: weapon profiles and pure projectile geometry.
 * No DOM, input, rendering or player state here, so the contract test can run it directly.
 * A keeps the arch062 discrete rule (end-of-step distance, one target, projectile ends).
 * B1 sweeps the whole segment of the tick and may hit up to 3 distinct targets.
 */
const MUZZLE_FLASH_TIME=.07;
const WEAPON_PROFILES=Object.freeze({
  'rifle-default':Object.freeze({id:'A',weaponId:'rifle-default',cooldown:.17,speed:780,life:.8,hitPad:5,pierce:1,sweep:false,
    trail:'#ffcc72',burst:'#f9b65e',label:'A: 27+2×ур., 0,17 с, 1 цель',damage:level=>27+level*2}),
  'rifle-long':Object.freeze({id:'B1',weaponId:'rifle-long',cooldown:.40,speed:780,life:.8,hitPad:5,pierce:3,sweep:true,
    trail:'#4fe3d2',burst:'#6af0df',label:'B1: max(36, 27+2×ур.), 0,40 с, до 3 целей',damage:level=>Math.max(36,27+2*level)})
});
function weaponProfile(weaponId){
  const profile=WEAPON_PROFILES[weaponId];
  if(!profile)throw new RangeError('No weapon profile: '+weaponId);
  return profile;
}
/* The profile, colour and pierce limit belong to the projectile from the moment it is fired:
 * swapping weapons later never changes a projectile that is already in flight. */
function createShot(profile,muzzle,angle){
  const shot={x:muzzle.x,y:muzzle.y,elevationPx:muzzle.elevationPx,vx:Math.cos(angle)*profile.speed,vy:Math.sin(angle)*profile.speed,
    life:profile.life,profile,trail:profile.trail};
  if(profile.sweep){shot.hit=new Set();shot.remaining=profile.pierce;}
  return shot;
}
/* First time t in [0,1] when the segment P0->P1 enters the circle (cx,cy,r), or null.
 * Start inside (or exactly on the edge) gives 0; a tangent touch counts as entry. */
function segmentCircleEntry(x0,y0,x1,y1,cx,cy,r){
  const dx=x1-x0,dy=y1-y0,fx=x0-cx,fy=y0-cy,c=fx*fx+fy*fy-r*r;
  if(c<=0)return 0;
  const a=dx*dx+dy*dy;
  if(a===0)return null;
  const b=2*(fx*dx+fy*dy);
  if(b>=0)return null;                       // outside and not approaching: no entry
  const disc=b*b-4*a*c;
  if(disc<0)return null;
  const t=2*c/(-b+Math.sqrt(disc));          // smaller root without cancellation
  return t>=0&&t<=1?t:null;
}
function compareText(a,b){a=String(a);b=String(b);return a<b?-1:a>b?1:0}
/* Order: entry time, then geometry/identity only. Never the array position. */
function compareContacts(a,b){
  return a.t-b.t||a.d2-b.d2||a.e.x-b.e.x||a.e.y-b.e.y||a.e.r-b.e.r||compareText(a.e.type,b.e.type)||
    (a.e.id||0)-(b.e.id||0)||(a.e.max||0)-(b.e.max||0)||a.e.hp-b.e.hp;
}
function sweepContacts(x0,y0,x1,y1,targets,seen,hitPad){
  const found=[];
  for(const e of targets){
    if(e.hp<=0||seen.has(e))continue;
    const t=segmentCircleEntry(x0,y0,x1,y1,e.x,e.y,e.r+hitPad);
    if(t===null)continue;
    found.push({e,t,d2:(e.x-x0)*(e.x-x0)+(e.y-y0)*(e.y-y0)});
  }
  return found.sort(compareContacts);
}
