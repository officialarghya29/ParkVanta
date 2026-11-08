#!/usr/bin/env node
// Fail the release when the built frontend grows past its gzip budget.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const ASSETS = "apps/web/dist/assets";
const BUDGETS = { js: 460 * 1024, css: 15 * 1024 };

let js = 0;
let css = 0;
let count = 0;

for (const name of readdirSync(ASSETS)) {
  if (!/\.(js|css)$/.test(name)) continue;
  const compressed = gzipSync(readFileSync(join(ASSETS, name)), { level: 9 }).length;
  if (name.endsWith(".js")) js += compressed;
  else css += compressed;
  count += 1;
}

if (count === 0) {
  console.error(`No JavaScript or CSS assets found in ${ASSETS}. Run the build first.`);
  process.exit(1);
}

const kb = (bytes) => (bytes / 1024).toFixed(1);
console.log(`Bundled gzip: JS ${kb(js)} KiB / ${kb(BUDGETS.js)} KiB budget`);
console.log(`Bundled gzip: CSS ${kb(css)} KiB / ${kb(BUDGETS.css)} KiB budget`);

const failures = [];
if (js > BUDGETS.js) failures.push(`JavaScript is ${kb(js - BUDGETS.js)} KiB over budget`);
if (css > BUDGETS.css) failures.push(`CSS is ${kb(css - BUDGETS.css)} KiB over budget`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`::error::${failure}`);
  process.exit(1);
}
