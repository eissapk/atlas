/**
 * Projections.
 *
 * A projection is split into two halves on purpose:
 *
 *   1. A *raw* function, which turns radians into abstract, unitless
 *      coordinates. This is the actual cartography and it is the only part
 *      that changes between projections.
 *   2. A *fit*, which scales and translates those raw units into the SVG
 *      viewBox. The build script computes the fit once and stores it next to
 *      the geometry, so the browser never repeats it.
 *
 * Runtime code only ever needs `createProjection()`, and only markers actually
 * call it — country outlines arrive already projected.
 */

const DEG = Math.PI / 180;

/**
 * Natural Earth I (Tom Patterson / Bojan Savric polynomial).
 * A compromise projection: neither angles nor areas are exact, but the world
 * looks the way most people expect a world map to look.
 */
function naturalEarth1Raw(lambda, phi) {
  const phi2 = phi * phi;
  const phi4 = phi2 * phi2;
  return [
    lambda *
      (0.8707 +
        phi2 * -0.131979 +
        phi4 * (-0.013791 + phi4 * (0.003971 * phi2 - 0.001529 * phi4))),
    phi *
      (1.007226 +
        phi2 *
          (0.015085 +
            phi4 * (-0.044475 + 0.028874 * phi2 - 0.005916 * phi4))),
  ];
}

/** Plate carrée. Mostly here to prove swapping projections costs nothing. */
function equirectangularRaw(lambda, phi) {
  return [lambda, phi];
}

/** Web Mercator's maths, minus the tiling. Latitudes are clamped by `maxLat`. */
function mercatorRaw(lambda, phi) {
  return [lambda, Math.log(Math.tan(Math.PI / 4 + phi / 2))];
}

export const projections = {
  naturalEarth1: { raw: naturalEarth1Raw },
  equirectangular: { raw: equirectangularRaw },
  // Beyond ~85° Mercator runs off to infinity, so the poles get cut.
  mercator: { raw: mercatorRaw, maxLat: 85.05112878 },
};

/**
 * Build a `project(lat, lon) -> {x, y}` function.
 *
 * @param {object} spec
 * @param {string} spec.name       Key into `projections`.
 * @param {number} spec.scale      Raw units -> viewBox units.
 * @param {number[]} spec.translate Viewbox offset, as [x, y].
 */
export function createProjection({ name, scale, translate }) {
  const def = projections[name];
  if (!def) throw new Error(`Unknown projection "${name}"`);

  const [tx, ty] = translate;
  const maxLat = def.maxLat ?? 90;

  return function project(lat, lon) {
    const phi = Math.max(-maxLat, Math.min(maxLat, lat)) * DEG;
    const [rx, ry] = def.raw(lon * DEG, phi);
    // y is negated because SVG's y axis grows downward while latitude grows up.
    return { x: tx + scale * rx, y: ty - scale * ry };
  };
}
