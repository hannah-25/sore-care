import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schedulesDir = path.resolve(__dirname, "..", "data", "schedules");
const manifestPath = path.join(schedulesDir, "index.json");

const entries = await readdir(schedulesDir, { withFileTypes: true });
const files = entries
  .filter(entry => entry.isFile())
  .map(entry => entry.name)
  .filter(name => name.endsWith(".json") && name !== "index.json" && name !== "sample.json")
  .sort((a, b) => a.localeCompare(b, "ko"));

await writeFile(manifestPath, `${JSON.stringify(files, null, 2)}\n`, "utf8");
console.log(`Wrote ${path.relative(process.cwd(), manifestPath)} (${files.length} schedules)`);
