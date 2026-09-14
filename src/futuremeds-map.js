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
const DEFAULT_BRAND = "#0B2A4A";
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

// MapLibre v6 runs its tile worker from a sibling file. The build copies it next to this
// bundle, so resolve it relative to wherever the bundle is served from (jsDelivr or local).
setWorkerUrl(new URL("./maplibre-gl-worker.mjs", import.meta.url).href);

const WIDGET_CSS = `
:host {
  --fm-brand: ${DEFAULT_BRAND};
  display: block;
  position: relative;
  width: 100%;
  height: var(--fm-height, ${DEFAULT_HEIGHT});
}
.fm-map { position: absolute; inset: 0; }
.fm-pin { cursor: pointer; line-height: 0; }
.fm-pin svg {
  display: block;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.3));
  transition: transform 150ms ease;
}
.fm-pin:hover svg, .fm-pin:focus-visible svg { transform: translateY(-3px); }
.fm-pin path { fill: var(--fm-brand); stroke: #fff; stroke-width: 2; }
.fm-pin circle { fill: #fff; }
.maplibregl-popup-content {
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #1a1a1a;
  padding: 10px 28px 10px 12px;
  border-radius: 6px;
}
.fm-name { font-weight: 700; }
.fm-address { margin-top: 2px; color: #555; }
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
  el.innerHTML =
    '<svg width="26" height="36" viewBox="0 0 26 36" aria-hidden="true">' +
    '<path d="M13 1C6.4 1 1 6.3 1 12.9 1 21.8 13 35 13 35s12-13.2 12-22.1C25 6.3 19.6 1 13 1z"/>' +
    '<circle cx="13" cy="13" r="4.5"/></svg>';
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

    this._map = new MapLibreMap({
      container: this._container,
      style: STYLE_URL,
      center: [15, 50],
      zoom: 3,
      cooperativeGestures: true,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    this._map.touchZoomRotate.disableRotation();
    this._map.keyboard.disableRotation();
    this._map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    // Webflow tabs/modals can reveal the element after init; keep the canvas sized.
    this._resizeObserver = new ResizeObserver(() => this._map?.resize());
    this._resizeObserver.observe(this);

    this._loadMarkers();
  }

  disconnectedCallback() {
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

    for (const { name, address, lat, lng } of rows) {
      const html =
        `<div class="fm-name">${escapeHtml(name)}</div>` +
        (address ? `<div class="fm-address">${escapeHtml(address)}</div>` : "");
      const marker = new Marker({ element: pinElement(name), anchor: "bottom" })
        .setLngLat([lng, lat])
        .setPopup(new Popup({ offset: 24 }).setHTML(html))
        .addTo(this._map);
      this._markers.push(marker);
      bounds.extend([lng, lat]);
    }

    if (rows.length) this._map.fitBounds(bounds, { padding: 60, maxZoom: 11, duration: 0 });
  }
}

if (!customElements.get("futuremeds-map")) {
  customElements.define("futuremeds-map", FutureMedsMap);
}
