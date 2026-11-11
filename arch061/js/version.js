const GAME_BUILD=Object.freeze({"version": "1.1.0-arch061.1", "build": "ARCH-06.1-20261111-01", "status": "candidate", "date": "2026-11-11", "baseCommit": "6b6d180e6d54c97eed40353b414ff89801f0afbf", "baseline": "art01/", "notes": "Отделение визуальной позы и точек привязки от боя. Статичный герой ART-01 без смены оружия.", "testUrl": "/ashen-crusade/arch061/"});
const buildInfo=document.getElementById("build-info");
if(buildInfo)buildInfo.textContent=GAME_BUILD.version+" · "+GAME_BUILD.build;
document.title="Пепельный крестовый поход · "+GAME_BUILD.version;
