/**
 * Zoom, pan and pinch for a single <svg>.
 *
 * The controller owns exactly one piece of state — the transform `{k, x, y}`
 * that maps content coordinates to viewBox coordinates:
 *
 *     viewBox = content * k + translate
 *
 * It never touches the DOM itself. It reports a new transform through
 * `onTransform`, and reports "the user pressed and released without dragging"
 * through `onTap`. That split is what keeps clicking a country and dragging the
 * map from fighting each other, on mouse and touch alike.
 */

/** Movement (in CSS pixels) above which a press stops counting as a tap. */
const TAP_SLOP = 6;
const TWEEN_MS = 220;

const prefersReducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createInteraction({
  svg,
  width,
  height,
  minZoom = 1,
  maxZoom = 8,
  onTransform,
  onTap,
}) {
  let k = 1;
  let x = 0;
  let y = 0;

  // Where the map is *heading*. While a tween runs, `k/x/y` are mid-flight
  // values; a second button press must compose with the pending destination,
  // not with whatever frame the animation happens to be on — otherwise rapid
  // clicking barely moves the zoom at all.
  let target = { k: 1, x: 0, y: 0 };

  const pointers = new Map();
  let gesture = null;
  let travelled = 0;

  let inverseCTM = null;
  let frame = 0;
  let tween = 0;

  // -- coordinate helpers ---------------------------------------------------

  const invalidateCTM = () => {
    inverseCTM = null;
  };

  /**
   * Client (viewport) pixels -> viewBox units. Going through the SVG's own
   * screen matrix means responsive sizing, letterboxing from
   * preserveAspectRatio and page scroll are all handled by the browser rather
   * than re-derived here. The matrix only changes on resize/scroll, so it is
   * cached — reading it is a layout flush.
   */
  function toViewBox(clientX, clientY) {
    if (!inverseCTM) {
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      inverseCTM = ctm.inverse();
    }
    const p = new DOMPoint(clientX, clientY).matrixTransform(inverseCTM);
    return { x: p.x, y: p.y };
  }

  const clampZoom = (value) => Math.max(minZoom, Math.min(maxZoom, value));

  /**
   * Keeps the map anchored to the viewport. Once it is larger than the frame
   * its edges may not come inside, and while it is smaller it stays centred —
   * so the map can never be flung off somewhere the user cannot find it.
   */
  function clampTranslate(nx, ny, nk) {
    const scaledW = width * nk;
    const scaledH = height * nk;
    return {
      x:
        scaledW <= width
          ? (width - scaledW) / 2
          : Math.min(0, Math.max(width - scaledW, nx)),
      y:
        scaledH <= height
          ? (height - scaledH) / 2
          : Math.min(0, Math.max(height - scaledH, ny)),
    };
  }

  // -- applying state -------------------------------------------------------

  function emit() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onTransform({ k, x, y });
    });
  }

  /** Sets the transform immediately (used by every continuous gesture). */
  function set(nk, nx, ny) {
    const zoom = clampZoom(nk);
    const t = clampTranslate(nx, ny, zoom);
    k = zoom;
    x = t.x;
    y = t.y;
    target = { k, x, y };
    emit();
  }

  /** Zooms by `factor` while holding one viewBox point still under the cursor. */
  function zoomAbout(factor, px, py) {
    const next = clampZoom(k * factor);
    const ratio = next / k;
    set(next, px - (px - x) * ratio, py - (py - y) * ratio);
  }

  function stopTween() {
    if (tween) cancelAnimationFrame(tween);
    tween = 0;
  }

  /** Eased move, used only by the buttons and by programmatic selection. */
  function animateTo(nk, nx, ny) {
    stopTween();
    const zoom = clampZoom(nk);
    const destination = clampTranslate(nx, ny, zoom);
    target = { k: zoom, x: destination.x, y: destination.y };

    if (prefersReducedMotion()) {
      set(zoom, destination.x, destination.y);
      return;
    }

    const k0 = k;
    const x0 = x;
    const y0 = y;
    const start = performance.now();

    const step = (now) => {
      const p = Math.min(1, (now - start) / TWEEN_MS);
      const e = 1 - (1 - p) ** 3; // easeOutCubic
      k = k0 + (zoom - k0) * e;
      x = x0 + (destination.x - x0) * e;
      y = y0 + (destination.y - y0) * e;
      onTransform({ k, x, y });
      tween = p < 1 ? requestAnimationFrame(step) : 0;
    };
    tween = requestAnimationFrame(step);
  }

  // -- gestures -------------------------------------------------------------

  function beginPan(clientX, clientY) {
    const p = toViewBox(clientX, clientY);
    gesture = { type: "pan", cx: (p.x - x) / k, cy: (p.y - y) / k };
  }

  function beginPinch() {
    const [a, b] = [...pointers.values()];
    const mid = toViewBox((a.x + b.x) / 2, (a.y + b.y) / 2);
    gesture = {
      type: "pinch",
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      zoom: k,
      cx: (mid.x - x) / k,
      cy: (mid.y - y) / k,
    };
  }

  function onPointerDown(event) {
    // Ignore secondary mouse buttons; touch and pen have no meaningful button.
    if (event.pointerType === "mouse" && event.button !== 0) return;

    stopTween();
    invalidateCTM();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      /* capture is a nicety, not a requirement */
    }

    if (pointers.size === 1) {
      travelled = 0;
      beginPan(event.clientX, event.clientY);
    } else if (pointers.size === 2) {
      beginPinch();
    }
  }

  function onPointerMove(event) {
    const tracked = pointers.get(event.pointerId);
    if (!tracked) return;

    travelled += Math.hypot(event.clientX - tracked.x, event.clientY - tracked.y);
    tracked.x = event.clientX;
    tracked.y = event.clientY;

    if (!gesture) return;

    if (gesture.type === "pan" && pointers.size === 1) {
      const p = toViewBox(event.clientX, event.clientY);
      set(k, p.x - gesture.cx * k, p.y - gesture.cy * k);
      return;
    }

    if (gesture.type === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = toViewBox((a.x + b.x) / 2, (a.y + b.y) / 2);
      // One update handles both halves of a pinch: the spread changes the
      // zoom, the midpoint drift pans.
      const next = clampZoom(gesture.zoom * (distance / gesture.distance));
      set(next, mid.x - gesture.cx * next, mid.y - gesture.cy * next);
    }
  }

  function onPointerUp(event) {
    const before = pointers.size;
    if (!pointers.delete(event.pointerId)) return;

    try {
      if (svg.hasPointerCapture(event.pointerId))
        svg.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }

    if (pointers.size === 1) {
      // Second finger lifted — resume panning from where the first one is,
      // otherwise the map would jump.
      const [remaining] = [...pointers.values()];
      beginPan(remaining.x, remaining.y);
      return;
    }

    if (pointers.size === 0) {
      if (before === 1 && travelled <= TAP_SLOP && event.type === "pointerup") {
        onTap(event);
      }
      gesture = null;
      travelled = 0;
    }
  }

  function onWheel(event) {
    event.preventDefault();
    stopTween();
    // deltaMode 0 = pixels, 1 = lines, 2 = pages.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
    const p = toViewBox(event.clientX, event.clientY);
    zoomAbout(Math.exp(-event.deltaY * unit * 0.0018), p.x, p.y);
  }

  // -- wiring ---------------------------------------------------------------

  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointercancel", onPointerUp);
  svg.addEventListener("wheel", onWheel, { passive: false });

  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(invalidateCTM)
      : null;
  resizeObserver?.observe(svg);
  addEventListener("scroll", invalidateCTM, { passive: true, capture: true });

  return {
    get transform() {
      return { k, x, y };
    },

    zoomIn: () => zoomStep(1.6),
    zoomOut: () => zoomStep(1 / 1.6),
    reset: () => animateTo(1, 0, 0),

    /** Brings a content-space box into view, without changing the zoom level. */
    panIntoView(box) {
      const left = -x / k;
      const top = -y / k;
      const right = (width - x) / k;
      const bottom = (height - y) / k;

      const visible =
        box.x >= left &&
        box.y >= top &&
        box.x + box.width <= right &&
        box.y + box.height <= bottom;
      if (visible) return;

      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      animateTo(k, width / 2 - cx * k, height / 2 - cy * k);
    },

    destroy() {
      stopTween();
      if (frame) cancelAnimationFrame(frame);
      svg.removeEventListener("pointerdown", onPointerDown);
      svg.removeEventListener("pointermove", onPointerMove);
      svg.removeEventListener("pointerup", onPointerUp);
      svg.removeEventListener("pointercancel", onPointerUp);
      svg.removeEventListener("wheel", onWheel);
      resizeObserver?.disconnect();
      removeEventListener("scroll", invalidateCTM, { capture: true });
    },
  };

  /** Buttons zoom about the middle of the frame, not the cursor. */
  function zoomStep(factor) {
    const px = width / 2;
    const py = height / 2;
    const next = clampZoom(target.k * factor);
    const ratio = next / target.k;
    animateTo(
      next,
      px - (px - target.x) * ratio,
      py - (py - target.y) * ratio
    );
  }
}
