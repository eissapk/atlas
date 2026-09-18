/**
 * Geographic markers.
 *
 * Markers live inside the same transformed group as the countries, so panning
 * and zooming carry them along for free and they stay pinned to their
 * coordinates. The one thing they must not inherit is the *scale*: a pin that
 * grows to eight times its size is unusable. Each marker therefore carries a
 * counter-scale, refreshed only when the zoom level actually changes.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

export function createMarkerLayer({ layer, project, onMarkerClick }) {
  const markers = new Map();
  let zoom = 1;

  function place(entry) {
    const { x, y } = entry.position;
    entry.element.setAttribute(
      "transform",
      `translate(${x} ${y}) scale(${1 / zoom})`
    );
  }

  return {
    add(marker) {
      if (marker == null || marker.id == null) {
        throw new Error("A marker needs an id");
      }
      if (markers.has(marker.id)) this.remove(marker.id);

      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("class", "wm-marker");
      group.dataset.markerId = marker.id;

      if (marker.element) {
        // Caller-supplied artwork. It is used as-is, so it can be anything
        // from an <image> to a whole icon group.
        group.append(marker.element);
      } else {
        const dot = document.createElementNS(SVG_NS, "circle");
        dot.setAttribute("class", "wm-marker-dot");
        dot.setAttribute("r", String(marker.radius ?? 4));
        group.append(dot);

        if (marker.label) {
          const text = document.createElementNS(SVG_NS, "text");
          text.setAttribute("class", "wm-marker-label");
          text.setAttribute("x", String((marker.radius ?? 4) + 3));
          text.setAttribute("y", "3.5");
          text.textContent = marker.label;
          group.append(text);
        }
      }

      if (marker.label) {
        const title = document.createElementNS(SVG_NS, "title");
        title.textContent = marker.label;
        group.prepend(title);
      }
      if (onMarkerClick) {
        group.classList.add("is-clickable");
        group.setAttribute("tabindex", "0");
        group.setAttribute("role", "button");
        if (marker.label) group.setAttribute("aria-label", marker.label);
      }

      const entry = {
        marker,
        element: group,
        position: project(marker.lat, marker.lon),
      };
      markers.set(marker.id, entry);
      place(entry);
      layer.append(group);
      return marker;
    },

    remove(id) {
      const entry = markers.get(id);
      if (!entry) return false;
      entry.element.remove();
      markers.delete(id);
      return true;
    },

    get(id) {
      return markers.get(id)?.marker ?? null;
    },

    /** Called on every zoom change so markers keep a constant screen size. */
    setZoom(next) {
      if (next === zoom) return;
      zoom = next;
      for (const entry of markers.values()) place(entry);
    },

    clear() {
      for (const entry of markers.values()) entry.element.remove();
      markers.clear();
    },
  };
}
