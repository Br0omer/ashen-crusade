const GAME_BUILD=Object.freeze({"version": "1.1.0-art01.1", "build": "ART-01-20261110-01", "status": "candidate", "date": "2026-11-10", "baseCommit": "e39296449ebb86aee574006e071d2e63cd5ece8a", "notes": "Утверждённый растр героя: один ракурс и зеркальное отражение, без покадровой ходьбы", "testUrl": "/ashen-crusade/art01/"});
const buildInfo=document.getElementById("build-info");
if(buildInfo) buildInfo.textContent=GAME_BUILD.version+" · "+GAME_BUILD.build;
document.title="Пепельный крестовый поход · "+GAME_BUILD.version;
