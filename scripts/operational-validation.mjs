import { readFile } from "node:fs/promises";
import { runOperationalManifest } from "../dist/src/operational/validation.js";

const manifestFile = process.argv[2];
if (!manifestFile) throw new Error("usage: node scripts/operational-validation.mjs <manifest.json>");
const report = await runOperationalManifest(JSON.parse(await readFile(manifestFile, "utf8")));
process.stdout.write(`${JSON.stringify(report.summary)}\n`);
if (report.summary.failed > 0) process.exitCode = 1;
