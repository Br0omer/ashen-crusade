function loop(now){let dt=Math.min(.033,(now-last)/1000||.016);last=now;if(running)update(dt);render();requestAnimationFrame(loop)}requestAnimationFrame(loop);
