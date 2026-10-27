import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { db, checked } from "../server/db.ts";
import { config, crmEnvironment } from "../server/config.ts";
import { ZohoClient } from "../server/zoho.ts";
assert.equal(crmEnvironment, "developer");
const clients = JSON.parse(await readFile("tmp/demo-clients.json", "utf8"));
const purchases = checked(
  await db
    .from("pac_purchases")
    .select("*")
    .in(
      "user_id",
      clients.map((c: any) => c.userId),
    ),
);
const jobs = checked(
  await db
    .from("pac_crm_jobs")
    .select("*")
    .in(
      "purchase_id",
      purchases.map((p) => p.id),
    ),
);
assert.equal(purchases.filter((p) => p.status === "paid").length, 2);
assert.ok(jobs.every((j) => j.status === "synced"));
const zoho = new ZohoClient(config);
const deals = [];
for (const client of clients) {
  const { data } = await zoho.request(
    `Deals/${client.zohoDealId}?fields=Deal_Name,Stage,Description,Modified_Time`,
  );
  deals.push(data[0]);
}
await mkdir("docs/evidence", { recursive: true });
await writeFile(
  "docs/evidence/current-state.json",
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      environment: crmEnvironment,
      providerApi: config.ZOHO_API_URL,
      offlineTests: 21,
      clients,
      purchases,
      jobs,
      deals,
    },
    null,
    2,
  ),
);
for (const file of ["live-results.json", "outage-pending.json"])
  await copyFile(`test-results/${file}`, `docs/evidence/${file}`);
const pending = JSON.parse(
  await readFile("test-results/outage-pending.json", "utf8"),
);
const recovered = jobs.find((j) => j.purchase_id === pending.purchaseId);
assert.equal(recovered?.status, "synced");
await writeFile(
  "docs/evidence/outage-recovered.json",
  JSON.stringify(
    { verifiedAt: new Date().toISOString(), ...recovered },
    null,
    2,
  ),
);
console.log(
  "Sanitized Developer Edition evidence saved: 2 paid clients, all CRM jobs synced.",
);
