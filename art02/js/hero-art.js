/* ART-02a: cached mesh/rig animation of the approved image, not new artwork.
 * Feet move independently; torso and cloth have separate skinning weights.
 * There are still only two mirrored views. New directions belong to ART-02b.
 * No atlas generation or triangle rendering runs in the gameplay frame loop.
 */
const heroArt = {
  image: new Image(), ready: false, label: 'ЗАГРУЗКА', facing: 1,
  height: 96, frames: 12, pad: 16, atlas: null, stride: 0,
  anchor: {x: (625-204)/905, y: (1150-89)/1114},
  muzzle: {x: (1093-204)/905, y: (480-89)/1114}
};
const artStart = document.getElementById('play');
const artStatus = document.getElementById('asset-status');
artStart.disabled = true;

function artClamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function artSmooth(a, b, v) {
  const z = artClamp((v-a)/(b-a), 0, 1); return z*z*(3-2*z);
}
// Coordinates are in the approved 208 x 256 source image. Smooth weights
// keep knee/hip joins intact instead of cutting the painting into rectangles.
function heroVertex(px, py, phase, walking, recoil) {
  const lower = artSmooth(137, 245, py);
  const near = 1-artSmooth(76, 92, px);
  const far = artSmooth(118, 133, px);
  const cloth = Math.max(0, 1-near-far);
  const step = Math.sin(phase)*walking;
  const liftNear = Math.max(0, step);
  const liftFar = Math.max(0, -step);
  const knee = Math.sin(Math.PI*artSmooth(140, 246, py));
  const upper = 1-artSmooth(126, 164, py);
  const bob = -Math.pow(Math.sin(phase), 2)*1.7*walking;
  return {
    x: px + lower*(near*step*12-far*step*10+cloth*step*2.2)
          + knee*(near*liftNear-far*liftFar)*3 - recoil*4.5*upper,
    y: py - lower*(near*liftNear*12+far*liftFar*10)
          + bob*(1-lower*.65) - recoil*1.2*upper
  };
}
function heroTriangle(ctx, src, dst) {
  const [a,b,c] = src, [u,v,w] = dst;
  const det = (b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y);
  const A = ((v.x-u.x)*(c.y-a.y)-(w.x-u.x)*(b.y-a.y))/det;
  const C = ((w.x-u.x)*(b.x-a.x)-(v.x-u.x)*(c.x-a.x))/det;
  const B = ((v.y-u.y)*(c.y-a.y)-(w.y-u.y)*(b.y-a.y))/det;
  const D = ((w.y-u.y)*(b.x-a.x)-(v.y-u.y)*(c.x-a.x))/det;
  // A subpixel overlap removes antialiased cracks between texture triangles.
  const cx=(u.x+v.x+w.x)/3, cy=(u.y+v.y+w.y)/3;
  ctx.save(); ctx.beginPath();
  dst.forEach((p,i)=>{const dx=p.x-cx,dy=p.y-cy,len=Math.hypot(dx,dy)||1;
    ctx[i?'lineTo':'moveTo'](p.x+dx/len*.32,p.y+dy/len*.32);});
  ctx.closePath(); ctx.clip();
  ctx.transform(A,B,C,D,u.x-A*a.x-C*a.y,u.y-B*a.x-D*a.y);
  ctx.drawImage(heroArt.image,0,0); ctx.restore();
}
function bakeHeroPose(ctx, frame, walking, recoil) {
  const sw=heroArt.image.naturalWidth,sh=heroArt.image.naturalHeight;
  if (!walking && !recoil) { ctx.drawImage(heroArt.image,0,0); return; }
  const phase=frame/heroArt.frames*Math.PI*2;
  // 16 px mesh; smooth weights preserve the belt and cloth joins.
  const xs=[],ys=[];
  for(let v=0;v<sw;v+=16) xs.push(v); xs.push(sw);
  for(let v=0;v<sh;v+=16) ys.push(v); ys.push(sh);
  for(let j=0;j<ys.length-1;j++) for(let i=0;i<xs.length-1;i++) {
    const s=[{x:xs[i],y:ys[j]},{x:xs[i+1],y:ys[j]},
      {x:xs[i+1],y:ys[j+1]},{x:xs[i],y:ys[j+1]}];
    const d=s.map(p=>heroVertex(p.x,p.y,phase,walking,recoil));
    heroTriangle(ctx,[s[0],s[1],s[2]],[d[0],d[1],d[2]]);
    heroTriangle(ctx,[s[0],s[2],s[3]],[d[0],d[2],d[3]]);
  }
}
async function buildHeroAtlas() {
  const sw=heroArt.image.naturalWidth,sh=heroArt.image.naturalHeight;
  heroArt.cellW=sw+heroArt.pad*2; heroArt.cellH=sh+heroArt.pad*2;
  const atlas=document.createElement('canvas');
  atlas.width=heroArt.cellW*(heroArt.frames+1); atlas.height=heroArt.cellH*3;
  const ctx=atlas.getContext('2d'); ctx.imageSmoothingEnabled=true;
  for(let r=0;r<3;r++) {
    for(let f=0;f<=heroArt.frames;f++) {
      ctx.save();ctx.translate(f*heroArt.cellW+heroArt.pad,r*heroArt.cellH+heroArt.pad);
      bakeHeroPose(ctx,f,f<heroArt.frames?1:0,r*.5);ctx.restore();
    }
    artStatus.textContent='Подготовка кадров анимации: '+(r+1)+'/3';
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  heroArt.atlas=atlas;
}
heroArt.image.onload = async function () {
  try {
    await buildHeroAtlas(); heroArt.ready=true; heroArt.label='АНИМАЦИЯ ГОТОВА';
    artStart.disabled=false;
    artStatus.textContent='12 фаз шага · отдача · два зеркальных вида · новые ракурсы ещё не добавлены';
    document.getElementById('hero-preview').src=this.src;
  } catch(error) {
    heroArt.label='ОШИБКА АНИМАЦИИ';
    artStatus.textContent='Не удалось подготовить анимацию. Игра не запущена.';
    console.error(error);
  }
};
heroArt.image.onerror = function () {
  heroArt.label='ОШИБКА ЗАГРУЗКИ';
  artStatus.textContent='Изображение не загрузилось. Обновите страницу.';
};
heroArt.image.src='assets/hero-approved.webp';
artStart.onclick=function(){ reset();heroArt.stride=0;heroArt.walking=false;heroArt.facing=1; };

// Called after movement, before shooting. Uses travelled distance, not FPS.
function updateHeroMotion(dt, distance) {
  if(distance>.001) {
    heroArt.stride=(heroArt.stride+distance/190*Math.PI*2)%(Math.PI*2);
    heroArt.walking=true;
  } else if(heroArt.walking) {
    // Complete the last half-step and settle both feet; do not walk in place.
    const target=Math.ceil((heroArt.stride+1e-6)/Math.PI)*Math.PI;
    heroArt.stride=Math.min(target,heroArt.stride+dt*15);
    if(target-heroArt.stride<.001){heroArt.stride=0;heroArt.walking=false;}
  }
}
function heroPose(angle) {
  const screenX=(Math.cos(angle)-Math.sin(angle))*.78;
  if(Math.abs(screenX)>.06) heroArt.facing=screenX<0?-1:1;
  const scale=heroArt.height/heroArt.image.naturalHeight;
  const frame=heroArt.walking?Math.round(heroArt.stride/(Math.PI*2)*heroArt.frames)%heroArt.frames:heroArt.frames;
  const recoil=p.fire>.125?2:p.fire>.085?1:0;
  return {scale,frame,recoil,facing:heroArt.facing};
}
function heroMuzzlePixels(angle) {
  const pose=heroPose(angle), sw=heroArt.image.naturalWidth,sh=heroArt.image.naturalHeight;
  const v=heroVertex(heroArt.muzzle.x*sw,heroArt.muzzle.y*sh,
    pose.frame/heroArt.frames*Math.PI*2,pose.frame<heroArt.frames?1:0,pose.recoil*.5);
  return {x:(v.x-heroArt.anchor.x*sw)*pose.scale*pose.facing,
          y:(v.y-heroArt.anchor.y*sh)*pose.scale};
}
armoredSprite=function(q,angle,moving) {
  if(!heroArt.ready) return;
  const pose=heroPose(angle),sw=heroArt.image.naturalWidth,sh=heroArt.image.naturalHeight;
  x.save();x.fillStyle='#080b1399';x.beginPath();x.ellipse(q.x,q.y+1,22,7,0,0,Math.PI*2);x.fill();
  x.translate(q.x,q.y);x.scale(pose.facing,1);
  x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';
  if(p.inv>0&&Math.floor(t*18)%2===0)x.globalAlpha=.7;
  x.drawImage(heroArt.atlas,pose.frame*heroArt.cellW,pose.recoil*heroArt.cellH,
    heroArt.cellW,heroArt.cellH,(-heroArt.anchor.x*sw-heroArt.pad)*pose.scale,
    (-heroArt.anchor.y*sh-heroArt.pad)*pose.scale,heroArt.cellW*pose.scale,heroArt.cellH*pose.scale);
  x.restore();
  if(p.fire>.10) {
    const m=heroMuzzlePixels(angle);
    const flashAngle=Math.atan2((Math.cos(angle)+Math.sin(angle))*.39,(Math.cos(angle)-Math.sin(angle))*.78);
    x.save();x.translate(q.x+m.x,q.y+m.y);x.rotate(flashAngle);
    x.fillStyle='#ffaf46';x.beginPath();x.moveTo(0,0);x.lineTo(18,-6);x.lineTo(13,0);x.lineTo(18,6);x.closePath();x.fill();
    x.fillStyle='#fff3c4';x.beginPath();x.moveTo(0,0);x.lineTo(12,-3);x.lineTo(9,0);x.lineTo(12,3);x.closePath();x.fill();x.restore();
  }
};
// The visible origin compensates for render.js's projectile elevation (-12).
gunMuzzleWorld=function(){
  const m=heroMuzzlePixels(p.angle), groundY=m.y+12;
  return {x:p.x+(m.x/.78+groundY/.39)/2,y:p.y+(groundY/.39-m.x/.78)/2};
};
