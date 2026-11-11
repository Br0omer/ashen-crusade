const GAME_BUILD=Object.freeze({"version": "1.1.0-arch062.1", "build": "ARCH-06.2-20261111-01", "status": "candidate", "date": "2026-11-11", "baseCommit": "860afbf4aeefad27e0cdae2182f147eac4ff113e", "baseline": "arch061/", "notes": "Составной герой: низ, верх, руки, два оружия с одинаковым хватом. Ноги статичны.", "testUrl": "/ashen-crusade/arch062/"});
const buildInfo=document.getElementById("build-info");
if(buildInfo)buildInfo.textContent=GAME_BUILD.version+" · "+GAME_BUILD.build;
document.title="Пепельный крестовый поход · "+GAME_BUILD.version;
