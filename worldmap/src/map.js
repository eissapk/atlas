/**
 * WorldMap — a small vanilla SVG map engine.
 *
 * The engine knows about geometry, interaction and state. It knows nothing
 * about *your* data: whatever you put in `options.data` is handed straight back
 * to your callbacks untouched, apart from two fields it reads by name —
 * `name` (used for labels and tooltips) and `disabled`.
 */

import { createProjection } from "./projection.js";
import { createInteraction } from "./interaction.js";
import { createMarkerLayer } from "./markers.js";
import { createTooltip } from "./tooltip.js";

const SVG_NS = "http://www.w3.org/2000/svg";
let instanceCount = 0;

const svgEl = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
};

export class WorldMap {
  /**
   * @param {Element} element  Container. It is emptied and takes over layout.
   * @param {object}  options
   * @param {object}  options.geometry  Parsed `world-*.json` from /data.
   * @param {object}  [options.data]    Keyed by ISO numeric id.
   * @param {Function}[options.onCountryClick] (country|null, event)
   * @param {Function}[options.onCountryHover] (country|null, event)
   * @param {Function}[options.onMarkerClick]  (marker, event)
   * @param {boolean|Function} [options.tooltip=true] `false`, or a formatter.
   * @param {number}  [options.minZoom=1]
   * @param {number}  [options.maxZoom=8]
   * @param {boolean} [options.ocean=true]
   * @param {string}  [options.label="World map"] Accessible name.
   */
  constructor(element, options = {}) {
    const container =
      typeof element === "string" ? document.querySelector(element) : element;
    if (!container) throw new Error("WorldMap: container not found");

    const { geometry } = options;
    if (!geometry?.countries) {
      throw new Error(
        "WorldMap: options.geometry is required — load a file from /data first"
      );
    }

    this.element = container;
    this.options = options;
    this._geometry = geometry;
    this._data = options.data ?? {};
    this._selected = null;
    this._hovered = null;
    this._paths = new Map();
    // Indexed once: getCountry runs on every hover, and _syncData runs it for
    // every country, so a linear scan here would be quadratic.
    this._byId = new Map(geometry.countries.map((c) => [c.id, c]));
    this._uid = `wm${++instanceCount}`;
    this._destroyed = false;

    /** `project(lat, lon) -> {x, y}`, in the same space as the country paths. */
    this.project = createProjection(geometry.projection);

    this._buildDom();
    this._renderCountries();
    this._bindEvents();

    this._interaction = createInteraction({
      svg: this._svg,
      width: geometry.width,
      height: geometry.height,
      minZoom: options.minZoom ?? 1,
      maxZoom: options.maxZoom ?? 8,
      onTransform: (t) => this._applyTransform(t),
      onTap: (event) => this._handleTap(event),
    });

    this._markers = createMarkerLayer({
      layer: this._markerLayer,
      project: this.project,
      onMarkerClick: options.onMarkerClick,
    });

    this._applyTransform({ k: 1, x: 0, y: 0 });
  }

  // -- construction ---------------------------------------------------------

  _buildDom() {
    const { width, height } = this._geometry;
    const container = this.element;
    container.classList.add("wm-root");
    container.replaceChildren();

    // viewBox + preserveAspectRatio is the whole responsive story: the map
    // scales to whatever box CSS gives it, at any aspect ratio, with no
    // JavaScript resize handling and no fixed pixel sizes anywhere.
    const svg = svgEl("svg", {
      class: "wm-svg",
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: "xMidYMid meet",
      "aria-label": this.options.label ?? "World map",
    });

    const title = svgEl("title");
    title.textContent = this.options.label ?? "World map";
    svg.append(title);

    // Disabled countries are hatched as well as greyed, so the state survives
    // greyscale, low contrast and colour-blind viewing.
    const patternId = `${this._uid}-disabled`;
    const defs = svgEl("defs");
    const pattern = svgEl("pattern", {
      id: patternId,
      width: 6,
      height: 6,
      patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)",
    });
    pattern.append(
      svgEl("rect", { width: 6, height: 6, class: "wm-hatch-bg" }),
      svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 6, class: "wm-hatch-line" })
    );
    defs.append(pattern);
    svg.append(defs);
    this._pattern = pattern;
    this._patternZoom = null;
    this._disabledFill = `url(#${patternId})`;

    // The ocean is a CSS background on the container rather than a <rect>.
    // A rect can only cover the viewBox, so whenever the container's aspect
    // ratio differs from the map's — which is always, once the map fills a
    // window — preserveAspectRatio letterboxes it and the bands would show
    // the page behind. A background covers the whole frame at any ratio.
    container.classList.toggle("wm-has-ocean", this.options.ocean !== false);

    this._viewport = svgEl("g", { class: "wm-viewport" });
    this._countryLayer = svgEl("g", {
      class: "wm-countries",
      role: "listbox",
      "aria-label": "Countries",
    });
    this._borderLayer = svgEl("path", {
      class: "wm-borders",
      // Borders arrive as [countryA, countryB, path] triples so that merging
      // can drop the ones between merged countries; drawing just needs them
      // concatenated.
      d: Array.isArray(this._geometry.borders)
        ? this._geometry.borders.map((segment) => segment[2]).join("")
        : (this._geometry.borders ?? ""),
    });
    this._markerLayer = svgEl("g", { class: "wm-markers" });

    this._viewport.append(this._countryLayer, this._borderLayer, this._markerLayer);
    svg.append(this._viewport);
    container.append(svg);
    this._svg = svg;

    this._tooltip =
      this.options.tooltip === false ? null : createTooltip(container);
  }

  _renderCountries() {
    const fragment = document.createDocumentFragment();

    for (const country of this._geometry.countries) {
      const path = svgEl("path", { class: "wm-country", d: country.d });
      path.dataset.countryId = country.id;
      // A merged country is the concatenation of its members' outlines, so its
      // own stroke would still trace the boundary between them. The border
      // layer already draws the group's edges against its neighbours, so the
      // stroke is dropped instead (see .wm-country[data-merged] in the CSS).
      if (country.members) path.dataset.merged = country.members.join(" ");
      path.setAttribute("role", "option");
      path.setAttribute("aria-selected", "false");
      path.setAttribute("tabindex", "-1");
      this._paths.set(country.id, path);
      fragment.append(path);
    }

    this._countryLayer.append(fragment);
    this._syncData();
  }

  /** Re-applies everything derived from application data. */
  _syncData() {
    this._focusOrder = [];

    for (const [id, path] of this._paths) {
      const country = this.getCountry(id);
      const disabled = country?.disabled === true;

      path.setAttribute("aria-label", country?.name ?? id);
      path.classList.toggle("is-disabled", disabled);

      if (disabled) {
        path.setAttribute("aria-disabled", "true");
        // Inline style, not a `fill` attribute: the stylesheet's
        // `.wm-country { fill: … }` rule would win against a presentation
        // attribute and the hatch would never show.
        path.style.fill = this._disabledFill;
      } else {
        path.removeAttribute("aria-disabled");
        path.style.fill = "";
        this._focusOrder.push(id);
      }
      path.setAttribute("tabindex", "-1");
    }

    // Roving tabindex: the whole map is a single tab stop and the arrow keys
    // move within it, rather than dropping 200-odd stops into the page.
    const first = this._focusOrder[0];
    if (first) this._paths.get(first).setAttribute("tabindex", "0");
  }

  // -- events ---------------------------------------------------------------

  _bindEvents() {
    this._onPointerMove = (event) => {
      // Touch has no hover; a tap would otherwise leave a country stuck in the
      // hovered state after the finger lifts.
      if (event.pointerType !== "mouse") return;
      // Disabled countries still report hover and still get a tooltip: saying
      // "unavailable" is more useful than silence. They just cannot be
      // selected — that is enforced in _handleTap.
      const path = event.target.closest?.("[data-country-id]");
      const id = path ? path.dataset.countryId : null;

      if (id !== this._hovered) this._setHover(id, event);
      else if (id) this._tooltip?.move(event);
    };

    this._onPointerLeave = (event) => this._setHover(null, event);

    this._onKeyDown = (event) => {
      const path = event.target.closest?.("[data-country-id]");
      if (!path) return;
      const index = this._focusOrder.indexOf(path.dataset.countryId);
      if (index === -1) return;

      const step = (delta) => {
        event.preventDefault();
        const next =
          (index + delta + this._focusOrder.length) % this._focusOrder.length;
        this._focus(this._focusOrder[next]);
      };

      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          return step(1);
        case "ArrowLeft":
        case "ArrowUp":
          return step(-1);
        case "Home":
          event.preventDefault();
          return this._focus(this._focusOrder[0]);
        case "End":
          event.preventDefault();
          return this._focus(this._focusOrder.at(-1));
        case "Enter":
        case " ":
          event.preventDefault();
          this.selectCountry(path.dataset.countryId);
          return this.options.onCountryClick?.(
            this.getCountry(path.dataset.countryId),
            event
          );
        case "Escape":
          event.preventDefault();
          return this.clearSelection();
        default:
      }
    };

    // Focus follows the keyboard, so the tooltip and hover styling should too.
    this._onFocusIn = (event) => {
      const path = event.target.closest?.("[data-country-id]");
      if (!path) return;
      this._setRoving(path.dataset.countryId);
      this._interaction?.panIntoView(path.getBBox());
    };

    this._svg.addEventListener("pointermove", this._onPointerMove);
    this._svg.addEventListener("pointerleave", this._onPointerLeave);
    this._countryLayer.addEventListener("keydown", this._onKeyDown);
    this._countryLayer.addEventListener("focusin", this._onFocusIn);

    if (this.options.onMarkerClick) {
      this._onMarkerKey = (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const group = event.target.closest?.("[data-marker-id]");
        if (!group) return;
        event.preventDefault();
        this.options.onMarkerClick(
          this._markers.get(group.dataset.markerId),
          event
        );
      };
      this._markerLayer.addEventListener("keydown", this._onMarkerKey);
    }
  }

  /**
   * A tap is a press and release that did not turn into a drag — the
   * interaction controller decides that, which is what keeps "select a
   * country" and "pan the map" from competing on touch.
   */
  _handleTap(event) {
    // Pointer capture retargets the event to the <svg>, so the element under
    // the finger has to be looked up by coordinate.
    const under = document.elementFromPoint(event.clientX, event.clientY);

    const markerEl = under?.closest?.("[data-marker-id]");
    if (markerEl && this.options.onMarkerClick) {
      this.options.onMarkerClick(
        this._markers.get(markerEl.dataset.markerId),
        event
      );
      return;
    }

    const path = under?.closest?.("[data-country-id]");
    if (!path || path.classList.contains("is-disabled")) {
      this.clearSelection();
      this.options.onCountryClick?.(null, event);
      return;
    }

    const id = path.dataset.countryId;
    this.selectCountry(id);
    this.options.onCountryClick?.(this.getCountry(id), event);
  }

  _setHover(id, event) {
    if (this._hovered === id) return;

    if (this._hovered) {
      this._paths.get(this._hovered)?.classList.remove("is-hover");
    }
    this._hovered = id;

    if (!id) {
      this._tooltip?.hide();
      this.options.onCountryHover?.(null, event);
      return;
    }

    // Exactly one element is touched per hover change — no sweep over the
    // other 238 paths.
    this._paths.get(id)?.classList.add("is-hover");

    const country = this.getCountry(id);
    if (this._tooltip) {
      const { tooltip } = this.options;
      const content =
        typeof tooltip === "function" ? tooltip(country) : country?.name;
      this._tooltip.show(content, event);
    }
    this.options.onCountryHover?.(country, event);
  }

  _setRoving(id) {
    for (const otherId of this._focusOrder) {
      this._paths
        .get(otherId)
        ?.setAttribute("tabindex", otherId === id ? "0" : "-1");
    }
  }

  _focus(id) {
    const path = this._paths.get(id);
    if (!path) return;
    this._setRoving(id);
    path.focus();
  }

  _applyTransform({ k, x, y }) {
    const round = (v) => Math.round(v * 1000) / 1000;
    this._viewport.setAttribute(
      "transform",
      `translate(${round(x)} ${round(y)}) scale(${round(k)})`
    );
    // Zoom-only work, skipped while panning. The hatch is in user space, so
    // without this counter-scale it would balloon into slabs at high zoom —
    // the same problem the markers have.
    if (k !== this._patternZoom) {
      this._patternZoom = k;
      this._pattern.setAttribute(
        "patternTransform",
        `rotate(45) scale(${(1 / k).toFixed(4)})`
      );
    }
    this._markers?.setZoom(k);
  }

  // -- public API -----------------------------------------------------------

  /**
   * Normalises an id to the way the geometry stores it. ISO numeric codes are
   * zero-padded strings ("036"), so accepting the number 36 as well saves
   * callers from a class of silent misses.
   */
  _key(id) {
    if (id == null) return null;
    const key = String(id);
    if (this._byId.has(key)) return key;
    const padded = key.padStart(3, "0");
    return this._byId.has(padded) ? padded : key;
  }

  /** The merged view of geometry + your data, or `null` for an unknown id. */
  getCountry(id) {
    const key = this._key(id);
    const base = key == null ? null : this._byId.get(key);
    if (!base) return null;
    return { id: key, name: base.name, ...this._data[key] };
  }

  /** Selects a country, or clears the selection when given `null`. */
  selectCountry(id) {
    const key = this._key(id);

    if (this._selected) {
      const previous = this._paths.get(this._selected);
      previous?.classList.remove("is-selected");
      previous?.setAttribute("aria-selected", "false");
    }

    this._selected = null;
    if (key == null) return null;

    const path = this._paths.get(key);
    if (!path || path.classList.contains("is-disabled")) return null;

    this._selected = key;
    path.classList.add("is-selected");
    path.setAttribute("aria-selected", "true");
    // Selecting from code (a search box, a deep link) should not leave the
    // country off-screen.
    this._interaction?.panIntoView(path.getBBox());
    return this.getCountry(key);
  }

  clearSelection() {
    return this.selectCountry(null);
  }

  /** The currently selected country, or `null`. */
  get selection() {
    return this._selected ? this.getCountry(this._selected) : null;
  }

  /** Replaces the application data. Geometry is untouched. */
  setData(data) {
    this._data = data ?? {};
    this._syncData();
    // A country that just became disabled cannot stay selected.
    if (this._selected && this.getCountry(this._selected)?.disabled) {
      this.clearSelection();
    }
    return this;
  }

  addMarker(marker) {
    return this._markers.add(marker);
  }

  removeMarker(id) {
    return this._markers.remove(id);
  }

  zoomIn() {
    this._interaction.zoomIn();
    return this;
  }

  zoomOut() {
    this._interaction.zoomOut();
    return this;
  }

  reset() {
    this._interaction.reset();
    return this;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    this._svg.removeEventListener("pointermove", this._onPointerMove);
    this._svg.removeEventListener("pointerleave", this._onPointerLeave);
    this._countryLayer.removeEventListener("keydown", this._onKeyDown);
    this._countryLayer.removeEventListener("focusin", this._onFocusIn);
    if (this._onMarkerKey) {
      this._markerLayer.removeEventListener("keydown", this._onMarkerKey);
    }

    this._interaction.destroy();
    this._markers.clear();
    this._tooltip?.destroy();

    this.element.classList.remove("wm-root", "wm-has-ocean");
    this.element.replaceChildren();
    this._paths.clear();
  }
}
