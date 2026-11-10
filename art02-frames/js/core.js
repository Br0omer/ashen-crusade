
const c=document.getElementById('c'),x=c.getContext('2d');let W=0,H=0,dpr=1;function resize(){dpr=Math.min(devicePixelRatio||1,2);W=innerWidth;H=innerHeight;c.width=W*dpr;c.height=H*dpr;x.setTransform(dpr,0,0,dpr,0,0)}addEventListener('resize',resize);resize();
