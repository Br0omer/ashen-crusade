/* ART-01 asset data only. No damage, movement or weapon simulation here. */
const HERO_DEFINITION = Object.freeze({
  asset: 'assets/hero-approved.webp', width: 208, height: 256, displayHeight: 96,
  anchor: Object.freeze({x: (625-204)/905, y: (1150-89)/1114}),
  sockets: Object.freeze({muzzle: Object.freeze({x: (1093-204)/905, y: (480-89)/1114})}),
  projectileElevationPx: 12,
  supportedWeapon: 'rifle-default'
});
