// <futuremeds-map>: MapLibre map of FutureMeds study centres, data loaded from a CSV at runtime.
import {
  Map as MapLibreMap,
  Marker,
  Popup,
  NavigationControl,
  LngLatBounds,
  setWorkerUrl,
} from "maplibre-gl";
import maplibreCss from "maplibre-gl/dist/maplibre-gl.css" with { type: "text" };
import Papa from "papaparse";

const DEFAULT_SRC = "https://cdn.jsdelivr.net/gh/w-sieben/FutureMeds@main/data/locations.csv";
const DEFAULT_HEIGHT = "520px";
// FutureMeds navy (--futuremeds-dark-blue in the site's CSS). Used for control icons and accents.
const DEFAULT_BRAND = "#002068";
const BRAND_TINT = "#dfedff";
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

// Colours copied from the "Monochrome" Mapbox style that futuremeds.de/was-wir-machen used
// before this widget, so the OpenFreeMap basemap is recoloured to look the same.
const LAND = "#469ce8";
const WATER = "#081f64";
const ROAD = "hsl(227, 80%, 25%)";
const BUILDING = "hsl(227, 75%, 14%)";
const WATER_LABEL = "hsl(227, 78%, 36%)";
const ROAD_LABEL = "hsl(227, 80%, 67%)";
const DARK_HALO = "hsla(227, 79%, 4%, 0.5)";

// The site is German: label places in German where OpenStreetMap has a name, and translate
// MapLibre's built-in UI strings.
const GERMAN_NAME = ["coalesce", ["get", "name:de"], ["get", "name:latin"], ["get", "name"]];
const LOCALE = {
  "AttributionControl.ToggleAttribution": "Quellenangaben ein-/ausblenden",
  "NavigationControl.ZoomIn": "Vergrößern",
  "NavigationControl.ZoomOut": "Verkleinern",
  "Popup.Close": "Schließen",
  "CooperativeGesturesHandler.WindowsHelpText": "Strg + Scrollen zum Zoomen der Karte",
  "CooperativeGesturesHandler.MacHelpText": "⌘ + Scrollen zum Zoomen der Karte",
  "CooperativeGesturesHandler.MobileHelpText": "Karte mit zwei Fingern bewegen",
};

// MapLibre v6 runs its tile worker from a sibling file. The build copies it next to this
// bundle, so resolve it relative to wherever the bundle is served from (jsDelivr or local).
setWorkerUrl(new URL("./maplibre-gl-worker.mjs", import.meta.url).href);

// Recolours positron as plain JSON before it's first drawn, so there's no flash of the grey
// original. Matching by layer type/id prefix means new positron layers still get a sane colour.
function themeStyle(style) {
  const layers = [];
  for (const layer of style.layers) {
    const { id, type } = layer;
    // Road shields are sprite icons that clash with the flat monochrome look.
    if (id.includes("shield")) continue;
    const paint = { ...layer.paint };
    const layout = { ...layer.layout };
    if (type === "background") {
      paint["background-color"] = LAND;
    } else if (type === "fill") {
      // Parks, landcover and landuse are flattened into the land colour, as on the old map.
      paint["fill-color"] = id === "water" ? WATER : id === "building" ? BUILDING : LAND;
    } else if (type === "line") {
      paint["line-color"] = /^(water|boundary)/.test(id) ? WATER : ROAD;
    } else if (type === "symbol") {
      const isWater = id.startsWith("water");
      const isRoad = id.startsWith("highway");
      paint["text-color"] = isWater ? WATER_LABEL : isRoad ? ROAD_LABEL : "#ffffff";
      paint["text-halo-color"] = isWater || isRoad ? DARK_HALO : LAND;
      paint["text-halo-width"] = 1;
      if (layout["text-field"]) layout["text-field"] = GERMAN_NAME;
    }
    layers.push({ ...layer, paint, layout });
  }
  return { ...style, layers };
}

function maskIcon(path) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><path d="${path}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
// Paths from maplibre-gl.css's own zoom icons, re-rendered as masks so they follow --fm-brand.
const ZOOM_IN_ICON = maskIcon(
  "M14.5 8.5c-.75 0-1.5.75-1.5 1.5v3h-3c-.75 0-1.5.75-1.5 1.5S9.25 16 10 16h3v3c0 .75.75 1.5 1.5 1.5S16 19.75 16 19v-3h3c.75 0 1.5-.75 1.5-1.5S19.75 13 19 13h-3v-3c0-.75-.75-1.5-1.5-1.5"
);
const ZOOM_OUT_ICON = maskIcon("M10 13c-.75 0-1.5.75-1.5 1.5S9.25 16 10 16h9c.75 0 1.5-.75 1.5-1.5S19.75 13 19 13z");

const WIDGET_CSS = `
:host {
  --fm-brand: ${DEFAULT_BRAND};
  --fm-pin: #ffffff;
  display: block;
  position: relative;
  width: 100%;
  height: var(--fm-height, ${DEFAULT_HEIGHT});
}
.fm-map {
  position: absolute;
  inset: 0;
  background: ${LAND}; /* no white flash while the style loads */
  border-radius: 16px;
  overflow: hidden;
}

/* Set by _updateInsets() when a parent clips the map (e.g. the half circle on /was-wir-machen),
   so the controls and attribution stay in the visible part. */
.maplibregl-ctrl-top-right { top: var(--fm-inset-top, 0px); }
.maplibregl-ctrl-bottom-right { bottom: var(--fm-inset-bottom, 0px); }

/* Plain white dots like the old map. The inner dot scales on hover because MapLibre owns the
   marker element's transform. */
.fm-pin { width: 16px; height: 16px; cursor: pointer; }
.fm-pin::after {
  content: "";
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: var(--fm-pin);
  transition: transform .15s ease;
}
.fm-pin:hover::after, .fm-pin:focus-visible::after { transform: scale(1.25); }
.fm-pin:focus-visible { outline: none; }
.fm-pin:focus-visible::after { box-shadow: 0 0 0 3px ${WATER}, 0 0 0 5px #fff; }

/* maplibre-gl.css hardcodes "Helvetica Neue"; inherit instead so the widget uses the page's
   font (Red Hat Display on futuremeds.de) across the shadow boundary. */
.maplibregl-map,
.maplibregl-popup-content,
.maplibregl-ctrl-attrib,
.maplibregl-cooperative-gesture-screen {
  font-family: inherit;
}

/* Matches the popup CSS the site already had for its Mapbox map. */
.maplibregl-popup-content {
  color: #161616;
  background: #fff;
  font-size: 16px;
  line-height: 1.5;
  padding: 12px 16px;
  border-radius: 4px;
  box-shadow: none;
}
.maplibregl-popup-close-button + .fm-name { padding-right: 20px; }
.fm-name { font-weight: 700; }
.fm-address { margin-top: 4px; }
.maplibregl-popup-close-button {
  width: 28px;
  height: 28px;
  font-size: 18px;
  color: #667085;
  border-radius: 0 4px 0 0;
}
.maplibregl-popup-close-button:hover { background-color: ${BRAND_TINT}; color: var(--fm-brand); }

.maplibregl-ctrl-group { border-radius: 8px; overflow: hidden; }
.maplibregl-ctrl-group button:hover { background-color: ${BRAND_TINT}; }
.maplibregl-ctrl-zoom-in .maplibregl-ctrl-icon, .maplibregl-ctrl-zoom-out .maplibregl-ctrl-icon {
  background-image: none;
  background-color: var(--fm-brand);
  -webkit-mask-position: 50%;
  mask-position: 50%;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
.maplibregl-ctrl-zoom-in .maplibregl-ctrl-icon {
  -webkit-mask-image: ${ZOOM_IN_ICON};
  mask-image: ${ZOOM_IN_ICON};
}
.maplibregl-ctrl-zoom-out .maplibregl-ctrl-icon {
  -webkit-mask-image: ${ZOOM_OUT_ICON};
  mask-image: ${ZOOM_OUT_ICON};
}
.maplibregl-ctrl-attrib.maplibregl-compact { border-radius: 999px; }
.maplibregl-ctrl-attrib a { color: #475467; }

.maplibregl-cooperative-gesture-screen { background: rgba(0, 32, 104, .6); }
`;

// Constructable stylesheets are shared across all instances; <style> is the fallback.
let sharedSheets;
function adoptStyles(root) {
  const css = maplibreCss + WIDGET_CSS;
  if ("adoptedStyleSheets" in root && typeof CSSStyleSheet.prototype.replaceSync === "function") {
    if (!sharedSheets) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      sharedSheets = [sheet];
    }
    root.adoptedStyleSheets = sharedSheets;
  } else {
    const style = document.createElement("style");
    style.textContent = css;
    root.appendChild(style);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function pinElement(name) {
  const el = document.createElement("div");
  el.className = "fm-pin";
  el.setAttribute("aria-label", name);
  return el;
}

function parseRows(text) {
  const { data } = Papa.parse(text, { header: true, skipEmptyLines: true });
  const rows = [];
  for (const row of data) {
    const name = (row.name || "").trim();
    const lat = Number.parseFloat(row.lat);
    const lng = Number.parseFloat(row.lng);
    const valid =
      name &&
      Number.isFinite(lat) && Number.isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
      !(lat === 0 && lng === 0);
    if (valid) rows.push({ name, address: (row.address || "").trim(), lat, lng });
    else console.warn("[futuremeds-map] skipping invalid row", row);
  }
  return rows;
}

// data-center="lng,lat" + data-zoom="3.8" pin the initial view; otherwise we fit to the pins.
// data-zoom-mobile applies below 480px, the breakpoint the old site map used.
function parseView(el) {
  const [lng, lat] = (el.getAttribute("data-center") || "").split(",").map(Number.parseFloat);
  const mobileZoom = Number.parseFloat(el.getAttribute("data-zoom-mobile"));
  const useMobile = Number.isFinite(mobileZoom) && window.matchMedia("(max-width: 479px)").matches;
  const zoom = useMobile ? mobileZoom : Number.parseFloat(el.getAttribute("data-zoom"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(zoom)) return null;
  return { center: [lng, lat], zoom };
}

class FutureMedsMap extends HTMLElement {
  static observedAttributes = ["data-src", "data-height", "data-brand"];

  connectedCallback() {
    if (this._map) return;
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    if (!this.shadowRoot.childElementCount) adoptStyles(root);
    this._applyStyleAttributes();

    this._container = document.createElement("div");
    this._container.className = "fm-map";
    root.appendChild(this._container);

    const view = parseView(this);
    this._map = new MapLibreMap({
      container: this._container,
      center: view?.center ?? [15, 50],
      zoom: view?.zoom ?? 3,
      cooperativeGestures: true,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      locale: LOCALE,
    });
    this._map.setStyle(STYLE_URL, { transformStyle: (_previous, next) => themeStyle(next) });
    this._map.touchZoomRotate.disableRotation();
    this._map.keyboard.disableRotation();
    this._map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    // Webflow tabs/modals can reveal the element after init, and breakpoints change how much of
    // the map a parent clips; keep the canvas sized and the insets current.
    this._onResize = () => {
      this._map?.resize();
      this._updateInsets();
    };
    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(this);
    window.addEventListener("resize", this._onResize);
    this._updateInsets();

    this._loadMarkers();
  }

  // Measures how much of the map is cut off at the top and bottom by ancestors with
  // overflow clipping, so the page embed needs no layout-specific CSS.
  _updateInsets() {
    if (!this._container) return;
    const host = this.getBoundingClientRect();
    let top = host.top;
    let bottom = host.bottom;
    for (let el = this.parentElement; el && el !== document.body; el = el.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(el);
      if (overflowX === "visible" && overflowY === "visible") continue;
      const rect = el.getBoundingClientRect();
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
    let insetTop = Math.max(0, Math.round(top - host.top));
    let insetBottom = Math.max(0, Math.round(host.bottom - bottom));
    // Hidden, or clipped so hard the controls can't fit: fall back to the plain layout.
    if (host.height - insetTop - insetBottom < 120) insetTop = insetBottom = 0;
    this._container.style.setProperty("--fm-inset-top", `${insetTop}px`);
    this._container.style.setProperty("--fm-inset-bottom", `${insetBottom}px`);
  }

  disconnectedCallback() {
    window.removeEventListener("resize", this._onResize);
    this._resizeObserver?.disconnect();
    this._map?.remove();
    this._container?.remove();
    this._map = this._container = this._resizeObserver = null;
    this._markers = [];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (!this._map || oldValue === newValue) return;
    if (name === "data-src") this._loadMarkers();
    else this._applyStyleAttributes();
  }

  _applyStyleAttributes() {
    const height = this.getAttribute("data-height");
    const brand = this.getAttribute("data-brand");
    if (height) this.style.setProperty("--fm-height", height);
    else this.style.removeProperty("--fm-height");
    if (brand) this.style.setProperty("--fm-brand", brand);
    else this.style.removeProperty("--fm-brand");
  }

  async _loadMarkers() {
    const src = this.getAttribute("data-src") || DEFAULT_SRC;
    const loadId = (this._loadId = (this._loadId || 0) + 1);
    let rows;
    try {
      // no-cache revalidates with the CDN so purged CSV edits show on the next reload.
      const res = await fetch(src, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rows = parseRows(await res.text());
    } catch (err) {
      console.error(`[futuremeds-map] could not load locations from ${src}`, err);
      return;
    }
    // Ignore stale responses (element removed or data-src changed mid-flight).
    if (!this._map || loadId !== this._loadId) return;

    for (const marker of this._markers || []) marker.remove();
    this._markers = [];
    const bounds = new LngLatBounds();
    const map = this._map;

    for (const { name, address, lat, lng } of rows) {
      const html =
        `<div class="fm-name">${escapeHtml(name)}</div>` +
        (address ? `<div class="fm-address">${escapeHtml(address)}</div>` : "");
      const el = pinElement(name);
      const marker = new Marker({ element: el, anchor: "center" })
        .setLngLat([lng, lat])
        .setPopup(new Popup({ offset: 12 }).setHTML(html))
        .addTo(map);

      // Like the old map: a lightweight preview on mouse hover, the full popup on click/tap.
      const preview = new Popup({ offset: 12, closeButton: false, closeOnClick: false }).setHTML(html);
      el.addEventListener("mouseenter", () => {
        if (!marker.getPopup().isOpen()) preview.setLngLat(marker.getLngLat()).addTo(map);
      });
      el.addEventListener("mouseleave", () => preview.remove());
      // Glide the clicked centre to the middle, as the old map did. Besides matching it, this
      // keeps the popup out of the parts of the map the half-circle layout hides.
      el.addEventListener("click", () => {
        preview.remove();
        map.flyTo({ center: marker.getLngLat(), speed: 0.5, curve: 1, easing: (t) => t });
      });

      this._markers.push(marker);
      bounds.extend([lng, lat]);
    }

    if (rows.length && !parseView(this)) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 11, duration: 0 });
    }
  }
}

if (!customElements.get("futuremeds-map")) {
  customElements.define("futuremeds-map", FutureMedsMap);
}
