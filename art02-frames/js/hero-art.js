/* ART-02a.3: the approved eight drawn poses, not deformation of a static image.
 * One common crop, scale and ground anchor for every frame. Two mirrored views.
 * No mesh skinning, limb scaling, interpolation or generated frames at runtime.
 */
const HERO_WALK = Object.freeze({
  cellW: 304, cellH: 384, columns: 4, frames: 8,
  anchorX: 140, anchorY: 363, visibleHeight: 360,
  cycleDistance: 206.4,
  muzzles: Object.freeze([
    {x:291,y:168}, {x:289,y:168}, {x:291,y:167.5}, {x:290,y:168},
    {x:291,y:166.5}, {x:289,y:166.5}, {x:291,y:166.5}, {x:290,y:166.5}
  ])
});
const heroArt = {
  image: new Image(), ready: false, label: 'ЗАГРУЗКА', facing: 1,
  height: 96, frame: 0, travel: 0, walking: false
};
const artStart = document.getElementById('play');
const artStatus = document.getElementById('asset-status');
artStart.disabled = true;
heroArt.image.onload = function () {
  if (this.naturalWidth !== HERO_WALK.cellW*4 || this.naturalHeight !== HERO_WALK.cellH*2) {
    heroArt.label = 'ОШИБКА РАЗМЕРА АТЛАСА';
    artStatus.textContent = 'Получен несовместимый атлас. Запуск заблокирован.';
    return;
  }
  heroArt.ready = true;
  heroArt.label = '8 НАРИСОВАННЫХ КАДРОВ';
  artStart.disabled = false;
  artStatus.textContent = 'Ходьба загружена · 8 поз · без растягивания · один ракурс и отражение';
};
heroArt.image.onerror = function () {
  heroArt.ready = false;
  heroArt.label = 'ОШИБКА ЗАГРУЗКИ';
  artStart.disabled = true;
  artStatus.textContent = 'Атлас героя не загрузился. Проверьте файлы сборки и обновите страницу.';
};
heroArt.image.src = 'assets/hero-walk-8.webp';
artStart.onclick = function () {
  reset();
  heroArt.frame = 0;
  heroArt.travel = 0;
  heroArt.walking = false;
  heroArt.facing = 1;
};

// Called by gameplay.js after movement and BEFORE a shot is spawned.
// Real distance determines phase. At rest use the neutral approved first pose.
function updateHeroMotion(dt, distance) {
  if (!Number.isFinite(distance) || distance <= 0.001) {
    heroArt.frame = 0;
    heroArt.travel = 0;
    heroArt.walking = false;
    return;
  }
  heroArt.walking = true;
  heroArt.travel = (heroArt.travel + distance) % HERO_WALK.cycleDistance;
  heroArt.frame = Math.floor(heroArt.travel / HERO_WALK.cycleDistance * HERO_WALK.frames);
}

function heroPose(angle) {
  const sx = (Math.cos(angle)-Math.sin(angle))*.78;
  if (Math.abs(sx)>.06) heroArt.facing = sx<0 ? -1 : 1;
  const scale = heroArt.height/HERO_WALK.visibleHeight;
  const recoil = p.fire>.125 ? 1 : p.fire>.085 ? .5 : 0;
  // Only rigid whole-image translation for recoil, in display pixels.
  return {scale,frame:heroArt.frame,facing:heroArt.facing,rx:-1.65*recoil,ry:-.44*recoil};
}

function heroMuzzlePixels(angle) {
  const pose = heroPose(angle);
  const m = HERO_WALK.muzzles[pose.frame];
  return {
    x: ((m.x-HERO_WALK.anchorX)*pose.scale + pose.rx)*pose.facing,
    y: (m.y-HERO_WALK.anchorY)*pose.scale + pose.ry
  };
}

armoredSprite = function (q, angle, moving) {
  if (!heroArt.ready) return;
  const pose = heroPose(angle);
  const col = pose.frame % HERO_WALK.columns;
  const row = Math.floor(pose.frame/HERO_WALK.columns);
  x.save();
  x.fillStyle = '#080b1399';
  x.beginPath(); x.ellipse(q.x,q.y+1,22,7,0,0,Math.PI*2); x.fill();
  x.translate(q.x,q.y);
  x.scale(pose.facing,1);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  if (p.inv>0 && Math.floor(t*18)%2===0) x.globalAlpha = .7;
  x.drawImage(heroArt.image,
    col*HERO_WALK.cellW,row*HERO_WALK.cellH,HERO_WALK.cellW,HERO_WALK.cellH,
    -HERO_WALK.anchorX*pose.scale+pose.rx,-HERO_WALK.anchorY*pose.scale+pose.ry,
    HERO_WALK.cellW*pose.scale,HERO_WALK.cellH*pose.scale);
  x.restore();
  if (p.fire>.10) {
    const m = heroMuzzlePixels(angle);
    const flashAngle = Math.atan2((Math.cos(angle)+Math.sin(angle))*.39,
                                 (Math.cos(angle)-Math.sin(angle))*.78);
    x.save(); x.translate(q.x+m.x,q.y+m.y); x.rotate(flashAngle);
    x.fillStyle='#ffaf46'; x.beginPath(); x.moveTo(0,0); x.lineTo(18,-6);
    x.lineTo(13,0); x.lineTo(18,6); x.closePath(); x.fill();
    x.fillStyle='#fff3c4'; x.beginPath(); x.moveTo(0,0); x.lineTo(12,-3);
    x.lineTo(9,0); x.lineTo(12,3); x.closePath(); x.fill(); x.restore();
  }
};

// render.js uses iso(shot).y-12 for bullet height. Compensate the ground point
// so visual projectile origin and the frame's barrel share EXACTLY one anchor.
gunMuzzleWorld = function () {
  const m = heroMuzzlePixels(p.angle), groundY = m.y+12;
  return {x:p.x+(m.x/.78+groundY/.39)/2,
          y:p.y+(groundY/.39-m.x/.78)/2};
};
