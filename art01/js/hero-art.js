/* ART-01: approved raster asset. One view + horizontal reflection only.
 * Shared anchors keep muzzle flash and projectile origin in the same place.
 * Full directional/walk animation is deliberately reserved for ART-02.
 */
const heroArt = {
  image: new Image(), ready: false, label: 'ЗАГРУЗКА', facing: 1,
  height: 96,
  anchor: {x: (625-204)/905, y: (1150-89)/1114},
  muzzle: {x: (1093-204)/905, y: (480-89)/1114}
};
const artStart = document.getElementById('play');
const artStatus = document.getElementById('asset-status');
artStart.disabled = true;
heroArt.image.onload = function () {
  heroArt.ready = this.naturalWidth > 0;
  heroArt.label = heroArt.ready ? 'УТВЕРЖДЁННЫЙ СПРАЙТ' : 'ОШИБКА';
  artStart.disabled = !heroArt.ready;
  artStatus.textContent = 'Герой загружен · один ракурс + отражение · анимация ходьбы — ART-02';
  document.getElementById('hero-preview').src = this.src;
};
heroArt.image.onerror = function () {
  heroArt.label = 'ОШИБКА ЗАГРУЗКИ';
  artStatus.textContent = 'Изображение героя не загрузилось. Обновите страницу. Начало игры заблокировано, чтобы не скрывать ошибку старой графикой.';
};
heroArt.image.src = 'assets/hero-approved.webp';

function heroPose(angle) {
  const screenX = (Math.cos(angle)-Math.sin(angle))*.78;
  if (Math.abs(screenX)>.06) heroArt.facing = screenX<0 ? -1 : 1;
  const h = heroArt.height;
  const w = h * (heroArt.image.naturalWidth || 208) / (heroArt.image.naturalHeight || 256);
  return {w, h, facing: heroArt.facing};
}
function heroMuzzlePixels(angle) {
  const pose = heroPose(angle);
  return {x:(heroArt.muzzle.x-heroArt.anchor.x)*pose.w*pose.facing,
          y:(heroArt.muzzle.y-heroArt.anchor.y)*pose.h};
}
// Replace the old hero renderer; all enemy/environment rendering is unchanged.
armoredSprite = function(q, angle, moving) {
  if (!heroArt.ready) return;
  const pose = heroPose(angle);
  x.save();
  x.fillStyle = '#080b1399';
  x.beginPath(); x.ellipse(q.x,q.y+1,22,7,0,0,Math.PI*2); x.fill();
  x.translate(q.x,q.y);
  x.scale(pose.facing,1);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  if (p.inv>0 && Math.floor(t*18)%2===0) x.globalAlpha=.7;
  x.drawImage(heroArt.image,-heroArt.anchor.x*pose.w,-heroArt.anchor.y*pose.h,pose.w,pose.h);
  x.restore();
  if (p.fire>.10) {
    const m=heroMuzzlePixels(angle);
    const flashAngle=Math.atan2((Math.cos(angle)+Math.sin(angle))*.39,(Math.cos(angle)-Math.sin(angle))*.78);
    x.save(); x.translate(q.x+m.x,q.y+m.y); x.rotate(flashAngle);
    x.fillStyle='#ffaf46'; x.beginPath(); x.moveTo(0,0); x.lineTo(18,-6); x.lineTo(13,0); x.lineTo(18,6); x.closePath(); x.fill();
    x.fillStyle='#fff3c4'; x.beginPath(); x.moveTo(0,0); x.lineTo(12,-3); x.lineTo(9,0); x.lineTo(12,3); x.closePath(); x.fill();
    x.restore();
  }
};
// render.js draws each bullet at iso(shot).y - 12. Compensate here so that
// the rendered origin matches the visible muzzle rather than the foot anchor.
gunMuzzleWorld = function() {
  const m=heroMuzzlePixels(p.angle);
  const groundY=m.y+12;
  return {x:p.x+(m.x/.78+groundY/.39)/2,
          y:p.y+(groundY/.39-m.x/.78)/2};
};
