/* Composition root: only this bridge knows both gameplay state and the visual.
 * Replace the adapter here when introducing layered art; do not patch combat.
 */
let characterVisual = new CharacterViews.StaticSpriteVisual(HERO_DEFINITION, WorldProjection);
function prepareCharacterPose() {
  const moving = Math.hypot(p.vx || 0, p.vy || 0) > .001;
  return characterVisual.preparePose({
    root: {x:p.x, y:p.y}, velocity: {x:p.vx || 0, y:p.vy || 0},
    aimAngle:p.angle, time:t, weaponId:p.weaponId || 'rifle-default',
    locomotion:moving ? (p.dash>.65 ? 'dash' : 'moving') : 'idle',
    action:p.fire>.10 ? 'shoot' : p.melee>0 ? 'melee' : p.ability>8.8 ? 'ability' : 'aim',
    muzzleFlash:p.fire>.10, hurtFlash:p.inv>0 && Math.floor(t*18)%2===0
  });
}
const characterStart = document.getElementById('play');
const characterStatus = document.getElementById('asset-status');
characterStart.disabled = true;
prepareCharacterPose();
characterVisual.load().then(() => {
  prepareCharacterPose();
  document.getElementById('hero-preview').src = HERO_DEFINITION.asset;
  characterStatus.textContent = 'Герой ART-01 загружен · единый модуль отображения · статичная поза';
  characterStart.disabled = false;
}).catch(error => {
  characterStart.disabled = true;
  characterStatus.textContent = 'Не удалось загрузить героя. Начало игры заблокировано; обновите страницу.';
  console.error(error);
});
