import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
const db = new PGlite();
const alice = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  bob = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  doc = "11111111-1111-4111-8111-111111111111";
let purchase: string;
before(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth; create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated;insert into auth.users values('${alice}'),('${bob}');`,
  );
  await db.exec(
    await readFile("supabase/migrations/001_paid_access.sql", "utf8"),
  );
  await db.exec(
    await readFile("supabase/migrations/002_crm_environment.sql", "utf8"),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/003_strict_payment_validation.sql",
      "utf8",
    ),
  );
  await db.exec(
    `insert into pac_clients(user_id,zoho_deal_id,display_name) values('${alice}','101','Alice Test'),('${bob}','102','Bob Test')`,
  );
});
after(() => db.close());
async function asUser<T>(user: string, query: string) {
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${user}'`);
  try {
    return (await db.query<T>(query)).rows;
  } finally {
    await db.exec("reset role");
  }
}
test("unpaid clients cannot read premium content", async () => {
  assert.equal(
    (await asUser(alice, "select * from pac_document_content")).length,
    0,
  );
});
test("CRM environment is validated before checkout and workers claim only their environment", async () => {
  await assert.rejects(
    db.query("select pac_begin_purchase($1,$2,'developer')", [alice, doc]),
    /environment mismatch/,
  );
  await assert.rejects(
    db.query("select pac_begin_purchase($1,$2,null)", [alice, doc]),
    /environment mismatch/,
  );
  assert.equal(
    (await db.query("select * from pac_claim_job(null,'developer')")).rows
      .length,
    0,
  );
});
test("checkout reuses one pending purchase and immutable mapping", async () => {
  const a = await db.query<any>("select (pac_begin_purchase($1,$2)).*", [
    alice,
    doc,
  ]);
  purchase = a.rows[0].id;
  const b = await db.query<any>("select (pac_begin_purchase($1,$2)).*", [
    alice,
    doc,
  ]);
  assert.equal(b.rows[0].id, purchase);
  assert.equal(b.rows[0].zoho_deal_id, "101");
  await db.exec(
    `update pac_purchases set stripe_session_id='cs_test_alice' where id='${purchase}'`,
  );
});
test("mismatched amount atomically rolls back receipt and access", async () => {
  await assert.rejects(
    db.query(
      `select pac_fulfill('evt_bad',$1,'cs_test_alice',$2,'101',$3,1,'usd')`,
      [purchase, alice, doc],
    ),
    /mismatch/,
  );
  assert.equal(
    (await db.query("select * from pac_webhook_events")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from pac_entitlements")).rows.length,
    0,
  );
});
test("null identity and wrong environment cannot bypass transactional payment validation", async () => {
  await assert.rejects(
    db.query(
      "select pac_fulfill('evt_null',$1,'cs_test_alice',null,'101',$2,1900,'usd')",
      [purchase, doc],
    ),
    /mismatch/,
  );
  await assert.rejects(
    db.query(
      "select pac_fulfill('evt_env',$1,'cs_test_alice',$2,'101',$3,1900,'usd','developer')",
      [purchase, alice, doc],
    ),
    /mismatch/,
  );
  assert.equal(
    (await db.query("select * from pac_entitlements")).rows.length,
    0,
  );
});
test("valid payment grants access, event replay and alternate event do not duplicate work", async () => {
  const args = [purchase, alice, doc];
  for (const event of ["evt_paid", "evt_paid", "evt_paid_alternate"])
    await db.query(
      `select pac_fulfill('${event}',$1,'cs_test_alice',$2,'101',$3,1900,'usd')`,
      args,
    );
  assert.equal(
    (await db.query("select * from pac_entitlements")).rows.length,
    1,
  );
  assert.equal((await db.query("select * from pac_crm_jobs")).rows.length, 1);
  assert.equal(
    (await asUser(alice, "select * from pac_document_content")).length,
    1,
  );
  await assert.rejects(
    db.query("select pac_begin_purchase($1,$2)", [alice, doc]),
    /Already entitled/,
  );
});
test("other client cannot retrieve paid client purchase, job, entitlement or document", async () => {
  for (const table of [
    "pac_purchases",
    "pac_crm_jobs",
    "pac_entitlements",
    "pac_document_content",
  ])
    assert.equal(
      (await asUser(bob, `select * from ${table}`)).length,
      0,
      table,
    );
  assert.equal((await asUser(bob, "select * from pac_clients")).length, 1);
});
test("client cannot self grant access, change mapping, price or call server RPCs", async () => {
  for (const sql of [
    `insert into pac_entitlements values('${bob}','${doc}','${purchase}')`,
    `update pac_clients set zoho_deal_id='101'`,
    `update pac_documents set price_cents=1`,
    `select pac_claim_job(null)`,
    `select pac_begin_purchase('${bob}','${doc}')`,
  ])
    await assert.rejects(asUser(bob, sql), /permission denied/);
});
test("CRM leasing prevents concurrent claim; failure retains access; fencing rejects stale completion", async () => {
  const first = (await db.query<any>("select * from pac_claim_job(null)"))
    .rows[0];
  assert.ok(first.lease_token);
  assert.equal(
    (await db.query("select * from pac_claim_job(null)")).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query<any>(
        `select pac_finish_job($1,'00000000-0000-4000-8000-000000000000',null) as ok`,
        [purchase],
      )
    ).rows[0].ok,
    false,
  );
  await db.query("select pac_finish_job($1,$2,$3)", [
    purchase,
    first.lease_token,
    "CRM HTTP 503",
  ]);
  assert.equal(
    (await asUser(alice, "select * from pac_document_content")).length,
    1,
  );
  assert.equal(
    (await db.query("select * from pac_claim_job(null)")).rows.length,
    0,
  );
  const retry = (
    await db.query<any>("select * from pac_claim_job($1)", [purchase])
  ).rows[0];
  assert.equal(retry.attempts, 2);
  await db.query("select pac_finish_job($1,$2,null)", [
    purchase,
    retry.lease_token,
  ]);
  assert.equal(
    (await db.query("select * from pac_claim_job($1)", [purchase])).rows.length,
    0,
  );
});
test("expired leases recover after worker crash", async () => {
  const p = (
    await db.query<any>("select (pac_begin_purchase($1,$2)).*", [bob, doc])
  ).rows[0];
  await db.query(
    `update pac_purchases set stripe_session_id='cs_test_bob' where id=$1`,
    [p.id],
  );
  await db.query(
    `select pac_fulfill('evt_bob',$1,'cs_test_bob',$2,'102',$3,1900,'usd')`,
    [p.id, bob, doc],
  );
  const a = (await db.query<any>("select * from pac_claim_job(null)")).rows[0];
  await db.query(
    `update pac_crm_jobs set lease_until=now()-interval '1 second' where purchase_id=$1`,
    [p.id],
  );
  const b = (await db.query<any>("select * from pac_claim_job(null)")).rows[0];
  assert.notEqual(a.lease_token, b.lease_token);
  assert.equal(
    (
      await db.query<any>("select pac_finish_job($1,$2,null) as ok", [
        p.id,
        a.lease_token,
      ])
    ).rows[0].ok,
    false,
  );
});
