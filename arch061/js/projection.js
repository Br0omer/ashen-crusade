/* World XY <-> isometric pixels. Elevation is a screen-pixel offset, not 3D Z. */
const WorldProjection = Object.freeze({
  delta(x, y) { return {x: (x-y)*.78, y: (x+y)*.39}; },
  inverse(x, y) { return {x: (x/.78+y/.39)/2, y: (y/.39-x/.78)/2}; },
  socket(root, offset, elevationPx) {
    const d = this.inverse(offset.x, offset.y+elevationPx);
    return Object.freeze({x: root.x+d.x, y: root.y+d.y, elevationPx});
  }
});
