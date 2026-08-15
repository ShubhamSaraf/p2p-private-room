/* global URL, console */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const assetsDirectory = fileURLToPath(new URL("../apps/web/dist/assets/", import.meta.url));
const files = await readdir(assetsDirectory);
const mainScripts = files.filter((file) => file.startsWith("index-") && file.endsWith(".js"));
const stylesheets = files.filter((file) => file.endsWith(".css"));

await assertBudget(mainScripts, 330 * 1024, "initial JavaScript");
await assertBudget(stylesheets, 30 * 1024, "CSS");

async function assertBudget(assetNames, maximumBytes, label) {
  if (assetNames.length !== 1)
    throw new Error(`Expected one ${label} asset, found ${assetNames.length}.`);
  const size = (await stat(join(assetsDirectory, assetNames[0]))).size;
  if (size > maximumBytes) {
    throw new Error(`${label} is ${size} bytes; budget is ${maximumBytes} bytes.`);
  }
  console.log(`${label}: ${size} / ${maximumBytes} bytes`);
}
