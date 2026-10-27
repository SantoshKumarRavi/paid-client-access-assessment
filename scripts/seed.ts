import { randomBytes } from "node:crypto";
import { appendFile, writeFile, mkdir, readFile } from "node:fs/promises";
import { db, checked } from "../server/db.ts";
import { config, crmEnvironment } from "../server/config.ts";
import { ZohoClient } from "../server/zoho.ts";
const zoho = new ZohoClient(config);
let password = process.env.DEMO_PASSWORD;
if (!password) {
  password = `Pac!${randomBytes(18).toString("base64url")}`;
  await appendFile(".env", `\nDEMO_PASSWORD=${password}\n`);
}
const users = [];
const prefix =
  process.argv.find((arg) => arg.startsWith("--prefix="))?.slice(9) ??
  process.env.DEMO_EMAIL_PREFIX ??
  "";
if (!/^[a-z0-9-]*$/.test(prefix))
  throw Error(
    "Client prefix must contain lowercase letters, numbers or hyphens",
  );
for (const [alias, name] of [
  ["alice", "Alice Morgan"],
  ["bob", "Bob Parker"],
  ["charlie", "Charlie Reed"],
]) {
  const email = `${prefix}${alias}@example.test`;
  let user: any;
  for (let page = 1; !user; page++) {
    const result = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw result.error;
    user = result.data.users.find((u) => u.email === email);
    if (result.data.users.length < 1000) break;
  }
  if (!user) {
    const created = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    });
    if (created.error) throw created.error;
    user = created.data.user;
  }
  const existing = checked(
    await db.from("pac_clients").select("*").eq("user_id", user.id),
  );
  let dealId = existing[0]?.zoho_deal_id;
  if (existing[0] && existing[0].zoho_environment !== crmEnvironment)
    throw Error("Use a fresh --prefix for a different CRM environment");
  if (!dealId) {
    const dealName = `PAC Assessment - ${name} - ${user.id.slice(0, 8)}`;
    // Recover a previous successful insert if a seed process failed before saving the mapping.
    let matches: any[] = [];
    try {
      matches =
        (
          await zoho.request(
            `Deals/search?criteria=${encodeURIComponent(`(Deal_Name:equals:${dealName})`)}&fields=Deal_Name`,
          )
        ).data || [];
    } catch (e) {
      if (!String(e).includes("204")) throw e;
    }
    if (matches.length > 1)
      throw Error("Ambiguous seed Deal; resolve before continuing");
    dealId = matches[0]?.id;
    if (!dealId) {
      const result = await zoho.request("Deals", {
        method: "POST",
        body: JSON.stringify({
          data: [
            {
              Deal_Name: dealName,
              Stage: "Qualification",
              Closing_Date: "2026-12-31",
              Amount: 19,
              Description: `Fictional assessment client. Supabase user: ${user.id}. Stripe TEST purchases only.`,
            },
          ],
          trigger: [],
        }),
      });
      if (result.data?.[0]?.code !== "SUCCESS")
        throw Error("Zoho did not confirm Deal creation");
      dealId = result.data[0].details.id;
    }
    checked(
      await db
        .from("pac_clients")
        .insert({
          user_id: user.id,
          zoho_deal_id: dealId,
          display_name: name,
          zoho_environment: crmEnvironment,
        })
        .select("user_id")
        .single(),
    );
  }
  users.push({
    alias,
    name,
    email,
    userId: user.id,
    zohoDealId: dealId,
    zohoEnvironment: crmEnvironment,
  });
  console.info(`Ready: ${alias} -> Supabase identity -> Zoho Deal ${dealId}`);
}
await mkdir("tmp", { recursive: true });
await writeFile("tmp/demo-clients.json", JSON.stringify(users, null, 2));
console.info(
  "Demo clients are ready. The shared test password is DEMO_PASSWORD in ignored .env.",
);
