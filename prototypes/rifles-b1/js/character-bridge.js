/* Composition root: only this bridge knows both gameplay state and the visual.
 * The hero definition and bitmap loader come unchanged from arch062/. Only the page-relative
 * image paths are rebased here, because the page lives two directories deeper.
 */
const RIFLES_HERO_DEFINITION=(base=>Object.freeze({
  ...base,
  source:arch062Asset(base.source),
  weapons:Object.freeze(base.weapons.map(w=>Object.freeze(w.addon?{...w,addon:arch062Asset(w.addon)}:{...w})))
}))(COMPOSITE_HERO_DEFINITION);
let characterVisual = new CompositeCharacterViews.LayeredSpriteVisual(RIFLES_HERO_DEFINITION, WorldProjection, (w,h) => {const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;return canvas;});
function prepareCharacterPose() {
  const moving = Math.hypot(p.vx || 0, p.vy || 0) > .001;
  // Muzzle flash and the shooting action follow their own timer (MUZZLE_FLASH_TIME), not the
  // weapon cooldown, so the slower B1 does not hold the shooting pose for 0.40 s.
  return characterVisual.preparePose({
    root: {x:p.x, y:p.y}, velocity: {x:p.vx || 0, y:p.vy || 0},
    aimAngle:p.angle, time:t, weaponId:p.weaponId || 'rifle-default',
    locomotion:moving ? (p.dash>.65 ? 'dash' : 'moving') : 'idle',
    action:p.flash>0 ? 'shoot' : p.melee>0 ? 'melee' : p.ability>8.8 ? 'ability' : 'aim',
    muzzleFlash:p.flash>0, hurtFlash:p.inv>0 && Math.floor(t*18)%2===0
  });
}
const characterStart = document.getElementById('play');
const characterStatus = document.getElementById('asset-status');
characterStart.disabled = true;
prepareCharacterPose();
characterVisual.load().then(() => {
  prepareCharacterPose();
  refreshEquipmentView();
  document.getElementById('swap-weapon').disabled=false;
  for(const [id,part] of characterVisual.parts){const preview=document.querySelector('[data-part="'+id+'"]');if(preview)preview.src=part.toDataURL('image/png');}
  characterStatus.textContent = 'Составной герой загружен · RB / R — смена винтовки A / B1 · ноги статичны';
  characterStart.disabled = false;
}).catch(error => {
  characterStart.disabled = true;
  characterStatus.textContent = 'Не удалось загрузить героя. Начало игры заблокировано; обновите страницу.';
  console.error(error);
});

// Only the bridge mutates equipment. Health, the shared fire cooldown and movement are untouched.
function cycleEquippedWeapon() {
  if(characterVisual.getStatus()!=='ready' || paused)return;
  const list=RIFLES_HERO_DEFINITION.weapons;
  const index=list.findIndex(w=>w.id===p.weaponId);
  p.weaponId=list[(index+1)%list.length].id;
  prepareCharacterPose();refreshEquipmentView();
}
function refreshEquipmentView(){
  const weapon=RIFLES_HERO_DEFINITION.weapons.find(w=>w.id===p.weaponId);
  document.getElementById('weapon-name').textContent=weapon.name+' · '+weaponProfile(weapon.id).label;
  const canvas=characterVisual.composites.get(p.weaponId);
  if(canvas)document.getElementById('hero-preview').src=canvas.toDataURL('image/png');
}
document.getElementById('swap-weapon').onclick=cycleEquippedWeapon;
