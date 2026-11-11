/* ARCH-06.1: a replaceable CharacterVisual implementation.
 * Contract: load(), preparePose(snapshot), getSocket(name), render(ctx, screenRoot),
 * getStatus(), getPose(). No access to player globals, input, damage, DOM or RAF.
 * preparePose does not advance animation time. Re-evaluation in one tick is safe.
 * Future animation sampling must use snapshot.time/phase, not render frequency.
 */
const CharacterViews = (() => {
  'use strict';
  class StaticSpriteVisual {
    constructor(definition, projection, imageFactory = () => new Image()) {
      this.definition = definition;
      this.projection = projection;
      this.imageFactory = imageFactory;
      this.image = null;
      this.pose = null;
      this.facing = 1;
      this.status = 'loading';
      this.loadPromise = null;
    }
    load() {
      if (this.loadPromise) return this.loadPromise;
      this.loadPromise = new Promise((resolve, reject) => {
        const image = this.imageFactory(); this.image = image;
        image.onload = () => {
          if (image.naturalWidth !== this.definition.width || image.naturalHeight !== this.definition.height) {
            this.status = 'error'; reject(new Error('Unexpected hero asset dimensions')); return;
          }
          this.status = 'ready'; resolve(this);
        };
        image.onerror = () => { this.status = 'error'; reject(new Error('Hero asset failed to load')); };
        image.src = this.definition.asset;
      });
      return this.loadPromise;
    }
    preparePose(state) {
      const {root, velocity, aimAngle, time} = state;
      if (![root.x, root.y, velocity.x, velocity.y, aimAngle, time].every(Number.isFinite)) {
        throw new TypeError('CharacterSnapshot must contain finite coordinates and time');
      }
      if (state.weaponId !== this.definition.supportedWeapon) {
        throw new RangeError('This static adapter supports only rifle-default');
      }
      const aim = this.projection.delta(Math.cos(aimAngle), Math.sin(aimAngle));
      if (Math.abs(aim.x) > .06) this.facing = aim.x < 0 ? -1 : 1;
      const def = this.definition, h = def.displayHeight, w = h*def.width/def.height;
      const rootCopy = Object.freeze({x: root.x, y: root.y});
      const muzzlePixels = Object.freeze({
        x: (def.sockets.muzzle.x-def.anchor.x)*w*this.facing,
        y: (def.sockets.muzzle.y-def.anchor.y)*h
      });
      this.pose = Object.freeze({
        root: rootCopy, velocity: Object.freeze({...velocity}), aimAngle, time,
        locomotion: state.locomotion, action: state.action, weaponId: state.weaponId,
        w, h, facing: this.facing, alpha: state.hurtFlash ? .7 : 1,
        flash: !!state.muzzleFlash, flashAngle: Math.atan2(aim.y, aim.x),
        muzzlePixels,
        sockets: Object.freeze({
          root: Object.freeze({...rootCopy, elevationPx: 0}),
          muzzle: this.projection.socket(rootCopy, muzzlePixels, def.projectileElevationPx)
        })
      });
      return this.pose;
    }
    getSocket(name) {
      if (!this.pose) throw new Error('Call preparePose before querying a socket');
      if (!Object.hasOwn(this.pose.sockets, name)) throw new RangeError('Unknown socket: '+name);
      return this.pose.sockets[name];
    }
    getPose() { return this.pose; }
    getStatus() { return this.status; }
    render(ctx, screenRoot) {
      const pose = this.pose;
      if (this.status !== 'ready' || !pose) return;
      const def = this.definition;
      ctx.save();
      ctx.fillStyle = '#080b1399'; ctx.beginPath();
      ctx.ellipse(screenRoot.x, screenRoot.y+1, 22, 7, 0, 0, Math.PI*2); ctx.fill();
      ctx.translate(screenRoot.x, screenRoot.y); ctx.scale(pose.facing, 1);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.globalAlpha = pose.alpha;
      ctx.drawImage(this.image, -def.anchor.x*pose.w, -def.anchor.y*pose.h, pose.w, pose.h);
      ctx.restore();
      if (pose.flash) {
        const m = pose.muzzlePixels;
        ctx.save(); ctx.translate(screenRoot.x+m.x, screenRoot.y+m.y); ctx.rotate(pose.flashAngle);
        ctx.fillStyle='#ffaf46'; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(18,-6);
        ctx.lineTo(13,0); ctx.lineTo(18,6); ctx.closePath(); ctx.fill();
        ctx.fillStyle='#fff3c4'; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(12,-3);
        ctx.lineTo(9,0); ctx.lineTo(12,3); ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }
  }
  return Object.freeze({StaticSpriteVisual});
})();
