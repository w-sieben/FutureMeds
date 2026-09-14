// One-off seeding: raw Webflow CMS export (data/_webflow_export.csv) -> clean data/locations.csv.
// After seeding, data/locations.csv is the source of truth; do not re-run casually.
import Papa from "papaparse";
import { join } from "node:path";

const dataDir = join(import.meta.dir, "..", "data");
const inputPath = join(dataDir, "_webflow_export.csv");
const outputPath = join(dataDir, "locations.csv");

type WebflowRow = Record<string, string | undefined>;

function cleanAddress(html = ""): string {
  return html
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*(,\s*)+/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();
}

const input = Bun.file(inputPath);
if (!(await input.exists())) {
  console.error(`Missing ${inputPath}. Export the Webflow collection as CSV and save it there.`);
  process.exit(1);
}

const { data, errors } = Papa.parse<WebflowRow>(await input.text(), {
  header: true,
  skipEmptyLines: true,
});
if (errors.length) console.warn("CSV parse warnings:", errors);

const rows: { name: string; address: string; country: string; lat: string; lng: string }[] = [];
let skipped = 0;

for (const row of data) {
  const flag = (key: string) => (row[key] ?? "").trim().toLowerCase() === "true";
  if (flag("Archived") || flag("Draft")) continue;

  const name = (row["Name"] ?? "").trim();
  const lat = Number.parseFloat(row["Latitude"] ?? "");
  const lng = Number.parseFloat(row["Longitude"] ?? "");
  const validCoords =
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0);

  if (!name || !validCoords) {
    console.warn(`Skipping "${name || "(no name)"}": invalid coordinates ${row["Latitude"]}, ${row["Longitude"]}`);
    skipped++;
    continue;
  }

  rows.push({
    name,
    address: cleanAddress(row["Full Address"]),
    country: (row["Country"] ?? "").trim(),
    lat: String(lat),
    lng: String(lng),
  });
}

const csv = Papa.unparse(rows, {
  columns: ["name", "address", "country", "lat", "lng"],
  newline: "\n",
});
await Bun.write(outputPath, csv + "\n");
console.log(`Wrote ${rows.length} centres to ${outputPath} (${skipped} skipped).`);
