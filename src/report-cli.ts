// npm run report — отчёт по реплаям прямо в терминал, без бота.

import { readFileSync } from "node:fs";
import { fetchReport } from "./report.ts";
import { loadState } from "./state.ts";
import { RealX } from "./x.ts";

const { me } = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
const x = new RealX(process.env.X_BEARER_TOKEN ?? "");
console.log((await fetchReport(x, me, loadState())).replace(/<[^>]+>/g, ""));
console.log(`\nстоимость отчёта: $${x.spentUsd.toFixed(3)}`);
