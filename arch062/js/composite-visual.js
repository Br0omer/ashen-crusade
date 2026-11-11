/* ARCH-06.2: a layered CharacterVisual. Only one view plus reflection.
 * Original source pixels are partitioned into lower/upper/hands/weapon ONCE.
 * No DOM, globals, input, combat or animation clocks are read here.
 * surfaceFactory and imageFactory are injected by the composition root.
 * Static composites are cached at native resolution, avoiding seams from
 * independent subpixel filtering. Weapons reuse the same body part buffers.
 */
const CompositeCharacterViews = (() => {
  'use strict';
  function inside(x,y,poly) {
    let yes=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
      const [ax,ay]=poly[i],[bx,by]=poly[j];
      if((ay>y)!==(by>y) && x<(bx-ax)*(y-ay)/(by-ay)+ax)yes=!yes;
    }
    return yes;
  }
  class LayeredSpriteVisual {
    constructor(definition,projection,surfaceFactory,imageFactory=()=>new Image()) {
      this.definition=definition; this.projection=projection;
      this.surfaceFactory=surfaceFactory; this.imageFactory=imageFactory;
      this.status='loading'; this.pose=null; this.facing=1; this.loadPromise=null;
      this.parts=new Map(); this.weapons=new Map(); this.composites=new Map();
    }
    readImage(src,w,h) {
      return new Promise((resolve,reject)=>{
        const image=this.imageFactory();
        image.onload=()=>image.naturalWidth===w && image.naturalHeight===h
          ?resolve(image):reject(new Error('Unexpected dimensions: '+src));
        image.onerror=()=>reject(new Error('Asset failed to load: '+src));image.src=src;
      });
    }
    surface() {return this.surfaceFactory(this.definition.canvasWidth,this.definition.height);}
    load() {
      if(this.loadPromise)return this.loadPromise;
      const d=this.definition;
      this.loadPromise=(async()=>{
        try {
          const [source,...addons]=await Promise.all([
            this.readImage(d.source,d.width,d.height),
            ...d.weapons.filter(w=>w.addon).map(w=>this.readImage(w.addon,d.canvasWidth,d.height))
          ]);
          this.sourceImage=source;
          const native=this.surface(),ctx=native.getContext('2d');ctx.drawImage(source,0,0);
          const pixels=ctx.getImageData(0,0,d.canvasWidth,d.height);
          const arrays={};
          for(const id of ['lower','upper','hands','weapon'])arrays[id]=ctx.createImageData(d.canvasWidth,d.height);
          for(let yy=0;yy<d.height;yy++)for(let xx=0;xx<d.width;xx++){
            const at=(yy*d.canvasWidth+xx)*4;
            if(!pixels.data[at+3])continue;
            const hand=d.partition.handMasks.some(poly=>inside(xx+.5,yy+.5,poly));
            const weapon=inside(xx+.5,yy+.5,d.partition.weaponMask);
            const id=yy>=d.partition.splitY?'lower':hand?'hands':weapon?'weapon':'upper';
            arrays[id].data.set(pixels.data.subarray(at,at+4),at);
          }
          for(const id of Object.keys(arrays)){
            const surface=this.surface();surface.getContext('2d').putImageData(arrays[id],0,0);
            this.parts.set(id,surface);
          }
          let addonIndex=0;
          for(const weapon of d.weapons){
            const surface=this.surface(),wc=surface.getContext('2d');
            wc.drawImage(this.parts.get('weapon'),0,0);
            if(weapon.addon){wc.clearRect(...weapon.clearRect);wc.drawImage(addons[addonIndex++],0,0);}
            this.weapons.set(weapon.id,surface);
            const complete=this.surface(),cc=complete.getContext('2d');
            cc.drawImage(this.parts.get('lower'),0,0);cc.drawImage(this.parts.get('upper'),0,0);
            cc.drawImage(surface,d.grips.primary.x-weapon.grip.x,d.grips.primary.y-weapon.grip.y);
            cc.drawImage(this.parts.get('hands'),0,0);
            this.composites.set(weapon.id,complete);
          }
          this.status='ready';return this;
        }catch(error){this.status='error';throw error;}
      })();
      return this.loadPromise;
    }
    preparePose(state) {
      const d=this.definition,{root,velocity,aimAngle,time}=state;
      if(![root.x,root.y,velocity.x,velocity.y,aimAngle,time].every(Number.isFinite))
        throw new TypeError('CharacterSnapshot must contain finite coordinates and time');
      const weapon=d.weapons.find(w=>w.id===state.weaponId);
      if(!weapon)throw new RangeError('Unsupported weapon: '+state.weaponId);
      const aim=this.projection.delta(Math.cos(aimAngle),Math.sin(aimAngle));
      if(Math.abs(aim.x)>.06)this.facing=aim.x<0?-1:1;
      const scale=d.displayHeight/d.height;
      const shift={x:d.grips.primary.x-weapon.grip.x,y:d.grips.primary.y-weapon.grip.y};
      const toPixels=point=>Object.freeze({x:(point.x-d.anchor.x)*scale*this.facing,y:(point.y-d.anchor.y)*scale});
      const muzzlePixels=toPixels({x:weapon.muzzle.x+shift.x,y:weapon.muzzle.y+shift.y});
      const rootCopy=Object.freeze({...root});
      const sockets={root:Object.freeze({...rootCopy,elevationPx:0})};
      for(const [name,point] of Object.entries({waist:d.waist,grip_primary:d.grips.primary,grip_secondary:d.grips.secondary}))
        sockets[name]=this.projection.socket(rootCopy,toPixels(point),d.projectileElevationPx);
      sockets.muzzle=this.projection.socket(rootCopy,muzzlePixels,d.projectileElevationPx);
      this.pose=Object.freeze({root:rootCopy,velocity:Object.freeze({...velocity}),aimAngle,time,
        locomotion:state.locomotion,action:state.action,weaponId:weapon.id,
        scale,w:d.canvasWidth*scale,h:d.height*scale,facing:this.facing,alpha:state.hurtFlash ? .7 : 1,
        flash:!!state.muzzleFlash,flashAngle:Math.atan2(aim.y,aim.x),muzzlePixels,sockets:Object.freeze(sockets)});
      return this.pose;
    }
    getSocket(name){if(!this.pose)throw new Error('Call preparePose before querying a socket');
      if(!Object.hasOwn(this.pose.sockets,name))throw new RangeError('Unknown socket: '+name);return this.pose.sockets[name];}
    getPose(){return this.pose;}
    getStatus(){return this.status;}
    render(ctx,screenRoot){
      const pose=this.pose,d=this.definition;
      if(this.status!=='ready'||!pose)return;
      ctx.save();ctx.fillStyle='#080b1399';ctx.beginPath();
      ctx.ellipse(screenRoot.x,screenRoot.y+1,22,7,0,0,Math.PI*2);ctx.fill();
      ctx.translate(screenRoot.x,screenRoot.y);ctx.scale(pose.facing,1);
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.globalAlpha=pose.alpha;
      ctx.drawImage(this.composites.get(pose.weaponId),-d.anchor.x*pose.scale,-d.anchor.y*pose.scale,pose.w,pose.h);
      ctx.restore();
      if(pose.flash){const m=pose.muzzlePixels;ctx.save();ctx.translate(screenRoot.x+m.x,screenRoot.y+m.y);ctx.rotate(pose.flashAngle);
        ctx.fillStyle='#ffaf46';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(18,-6);ctx.lineTo(13,0);ctx.lineTo(18,6);ctx.closePath();ctx.fill();
        ctx.fillStyle='#fff3c4';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(12,-3);ctx.lineTo(9,0);ctx.lineTo(12,3);ctx.closePath();ctx.fill();ctx.restore();}
    }
  }
  return Object.freeze({LayeredSpriteVisual});
})();
