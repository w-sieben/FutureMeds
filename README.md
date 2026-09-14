# FutureMeds study centre map

A framework-free `<futuremeds-map>` web component that shows the FutureMeds study centres on a
MapLibre map. It is embedded into the Webflow site with one `<script>` tag.

- **Data:** [`data/locations.csv`](data/locations.csv), edited directly in this repo. No CMS, no server.
- **Delivery:** jsDelivr serves both the widget and the CSV straight from GitHub
  (`w-sieben/FutureMeds`). The widget comes from an immutable release tag, the CSV from `@main`.
- **Basemap:** OpenFreeMap `positron`. No API key, no Google or Mapbox services, so no map
  consent banner is needed.

> **Webflow CMS warning:** Berlin and Offenbach are the only centres with full Webflow detail
> pages. **Keep those two in the CMS.** The other ~18 centres are pins-only and can be dropped
> from the CMS once this map is live.

## Editing centres (no build needed)

The widget fetches the CSV at runtime, so a committed CSV edit goes live in about a minute
(see [Auto-purge](#auto-purge)).

### CSV schema

| column    | required | notes                                                        |
|-----------|----------|--------------------------------------------------------------|
| `name`    | yes      | Shown in bold in the popup                                   |
| `address` | no       | One line. Leave empty to show the name only                  |
| `country` | yes      | Informational (not shown on the map)                         |
| `lat`     | yes      | Decimal degrees, -90..90                                     |
| `lng`     | yes      | Decimal degrees, -180..180                                   |

Rules:
- Wrap a value in double quotes if it contains a comma: `"Kopernika 32, 31-501 Kraków"`.
- A double quote inside a quoted value is written twice: `"Clinic ""Oberig"""`.
- Rows with a missing name or invalid coordinates (non-numeric, out of range, or `0,0`) are
  skipped and logged to the browser console.
- Get coordinates from Google Maps or OpenStreetMap: right-click the spot, copy the
  `lat, lng` numbers. Watch the order: **lat first, then lng**.

### Adding or editing a centre in GitHub's web UI

1. Open [`data/locations.csv`](data/locations.csv) on GitHub and click the pencil (Edit) icon.
2. Add a new line at the end (or change an existing one), for example:
   `FutureMeds Hamburg,"Musterstraße 1, 20095 Hamburg",Germany,53.5511,9.9937`
3. Click **Commit changes** and commit directly to `main`.
4. The *Purge jsDelivr cache* action runs automatically. Reload the Webflow page about a minute later.

## Local development

```sh
bun install
bun run dev        # builds, then serves http://localhost:4000/ (override with PORT=...)
```

`index.html` renders `<futuremeds-map data-src="./data/locations.csv">`, so edits to the local CSV
show on reload without rebuilding. Rebuild (`bun run build`) only after changing `src/`.

## Building and releasing widget code

`bun run build` bundles `src/futuremeds-map.js` with MapLibre, its CSS and papaparse into a
minified ESM file, `dist/futuremeds-map.js`, and copies two MapLibre v6 companion files next to it:

- `dist/maplibre-gl-shared.mjs`: code shared by the map and its worker (imported by the bundle).
- `dist/maplibre-gl-worker.mjs`: the tile-parsing web worker.

The browser loads these automatically from the same folder, so Webflow still needs only one
`<script type="module">`. **`dist/` is committed**; jsDelivr serves it from the repo.

Release steps:

```sh
bun run build
git add -A && git commit -m "Widget: describe change"
git push
git tag v1.0.1 && git push origin v1.0.1      # immutable release
git tag -f v1 && git push -f origin v1        # optional: move the major tag
```

Webflow references `@1`. jsDelivr resolves `@1` to the **highest `v1.x.x` tag**, so pushing a new
`v1.x.x` tag is what releases it. The purge workflow also purges the `@1` alias on every `v*` tag
push, so the new version shows within minutes instead of jsDelivr's multi-day alias cache.
A breaking change gets `v2.0.0` and a new embed URL with `@2`.

## Webflow embed

Add an **Embed** element where the map should appear:

```html
<script type="module"
  src="https://cdn.jsdelivr.net/gh/w-sieben/FutureMeds@1/dist/futuremeds-map.js"></script>
<futuremeds-map
  data-src="https://cdn.jsdelivr.net/gh/w-sieben/FutureMeds@main/data/locations.csv"
  data-height="560px"></futuremeds-map>
```

The widget is pinned to the release tag `@1`; the CSV comes from `@main` so edits go live.
The component uses Shadow DOM, so Webflow's global CSS cannot restyle the map and the widget's CSS
cannot leak into the page.

### Options

| attribute     | default                                   | effect                     |
|---------------|-------------------------------------------|----------------------------|
| `data-src`    | this repo's `@main` CSV on jsDelivr        | CSV URL                    |
| `data-height` | `520px`                                   | Any CSS height (`60vh`...) |
| `data-brand`  | `#0B2A4A` (FutureMeds navy)               | Pin colour                 |

Brand colour can also be set from page CSS via the custom property:

```css
futuremeds-map { --fm-brand: #C8102E; }
```

(`data-brand`, when present, wins over page CSS.)

## Auto-purge

jsDelivr caches `@main` files for hours, so a raw CSV edit would not show up on its own.
[`.github/workflows/purge-jsdelivr.yml`](.github/workflows/purge-jsdelivr.yml) fixes that:

- On a push to `main` touching `data/**` or `dist/**`, it calls the jsDelivr purge endpoint for
  each changed file at `@main`.
- On a `v*` tag push, it purges `dist/*` at the major alias (e.g. `@1`).
- Requests are spaced 3 seconds apart and retried, to stay within jsDelivr's purge rate limit.
- It can also be started by hand from the Actions tab (*Run workflow*), which purges everything.

Manual purge (open in a browser or `curl`):

```
https://purge.jsdelivr.net/gh/w-sieben/FutureMeds@main/data/locations.csv
https://purge.jsdelivr.net/gh/w-sieben/FutureMeds@1/dist/futuremeds-map.js
```

Browsers revalidate the CSV on every load (`cache: "no-cache"`), so once jsDelivr is purged a
normal reload shows the new pins.

## Swapping the basemap

The style URL is `STYLE_URL` in [`src/futuremeds-map.js`](src/futuremeds-map.js). OpenFreeMap also
offers `https://tiles.openfreemap.org/styles/bright` and `.../styles/liberty`. Any MapLibre style
JSON works, but before switching providers check that it needs no key and does not load from
Google or Mapbox (the no-consent-banner reason for OpenFreeMap). Then rebuild and release.

## Re-seeding from Webflow (one-off)

`scripts/from-webflow.ts` converts a raw Webflow CMS export into the clean CSV. It is only for
seeding; after that, `data/locations.csv` is the source of truth.

```sh
# save the Webflow export as data/_webflow_export.csv (git-ignored), then:
bun run seed:webflow
```

It drops archived and draft items, strips HTML from *Full Address*, maps
*Name / Full Address / Country / Latitude / Longitude* to the schema above, and skips rows with
invalid coordinates. **It overwrites `data/locations.csv`.**

## Note on the word "mapbox" in the code

No Mapbox service is used and no token exists. The word still appears in `bun.lock` and in
MapLibre's bundled code, because MapLibre depends on small open-source helper libraries published
under the `@mapbox/` npm scope (e.g. `@mapbox/point-geometry`) and supports a DEM encoding named
`mapbox`. None of these make network requests.
