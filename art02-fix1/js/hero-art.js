/* ART-02a correction: the mesh walk was rejected on device.
 * Draw the approved image without warping or stretching it.
 * This is NOT a replacement walk cycle. Walking remains an open art task.
 * Rigid recoil, muzzle flash and projectile origin share the same pose.
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
  heroArt.ready = this.naturalWidth > 0 && this.naturalHeight > 0;
  heroArt.label = heroArt.ready ? 'БЕЗ ДЕФОРМАЦИИ' : 'ОШИБКА';
  artStart.disabled = !heroArt.ready;
  artStatus.textContent = heroArt.ready
    ? 'Герой загружен. Растягивание отключено. Новая ходьба ещё не реализована.'
    : 'Изображение героя не загрузилось.';
  document.getElementById('hero-preview').src = this.src;
};
heroArt.image.onerror = function () {
  heroArt.label = 'ОШИБКА ЗАГРУЗКИ';
  artStart.disabled = true;
  artStatus.textContent = 'Изображение не загрузилось. Обновите страницу.';
};
heroArt.image.src = 'assets/hero-approved.webp';
artStart.onclick = function () { reset(); heroArt.facing = 1; };

// Preserve gameplay.js's existing hook without animating/deforming the sprite.
function updateHeroMotion(dt, distance) { /* No walk cycle in this correction. */ }

function heroPose(angle) {
  const screenX = (Math.cos(angle)-Math.sin(angle))*.78;
  if (Math.abs(screenX)>.06) heroArt.facing = screenX<0 ? -1 : 1;
  const scale = heroArt.height/(heroArt.image.naturalHeight || 256);
  const recoil = p.fire>.125 ? 1 : p.fire>.085 ? .5 : 0;
  // Translate the whole image, never resize limbs or warp texture triangles.
  return {scale, facing:heroArt.facing, rx:-4.5*recoil, ry:-1.2*recoil};
}
function heroMuzzlePixels(angle) {
  const pose = heroPose(angle);
  const sw = heroArt.image.naturalWidth || 208;
  const sh = heroArt.image.naturalHeight || 256;
  return {
    x:((heroArt.muzzle.x-heroArt.anchor.x)*sw+pose.rx)*pose.scale*pose.facing,
    y:((heroArt.muzzle.y-heroArt.anchor.y)*sh+pose.ry)*pose.scale
  };
}
armoredSprite = function (q, angle, moving) {
  if (!heroArt.ready) return;
  const pose=heroPose(angle), sw=heroArt.image.naturalWidth, sh=heroArt.image.naturalHeight;
  x.save();
  x.fillStyle='#080b1399';
  x.beginPath();x.ellipse(q.x,q.y+1,22,7,0,0,Math.PI*2);x.fill();
  x.translate(q.x,q.y);x.scale(pose.facing,1);
  x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';
  if(p.inv>0&&Math.floor(t*18)%2===0)x.globalAlpha=.7;
  x.drawImage(heroArt.image,
    (-heroArt.anchor.x*sw+pose.rx)*pose.scale,
    (-heroArt.anchor.y*sh+pose.ry)*pose.scale,
    sw*pose.scale,sh*pose.scale);
  x.restore();
  if(p.fire>.10) {
    const m=heroMuzzlePixels(angle);
    const flashAngle=Math.atan2((Math.cos(angle)+Math.sin(angle))*.39,(Math.cos(angle)-Math.sin(angle))*.78);
    x.save();x.translate(q.x+m.x,q.y+m.y);x.rotate(flashAngle);
    x.fillStyle='#ffaf46';x.beginPath();x.moveTo(0,0);x.lineTo(18,-6);x.lineTo(13,0);x.lineTo(18,6);x.closePath();x.fill();
    x.fillStyle='#fff3c4';x.beginPath();x.moveTo(0,0);x.lineTo(12,-3);x.lineTo(9,0);x.lineTo(12,3);x.closePath();x.fill();x.restore();
  }
};
// Keep render.js's -12 projectile-elevation compensation.
gunMuzzleWorld = function () {
  const m=heroMuzzlePixels(p.angle), groundY=m.y+12;
  return {x:p.x+(m.x/.78+groundY/.39)/2,y:p.y+(groundY/.39-m.x/.78)/2};
};
