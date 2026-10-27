import { test } from "node:test";
import assert from "node:assert/strict";
import { ZohoClient } from "../server/zoho.ts";
const cfg = {
  ZOHO_ACCOUNTS_URL: "https://accounts.zoho.in",
  ZOHO_API_URL: "https://www.zohoapis.in",
  ZOHO_ACCESS_TOKEN: "fixture",
  ZOHO_PAID_STAGE: "Closed Won",
};
const job = {
  purchase_id: "purchase-1",
  zoho_deal_id: "101",
  stripe_session_id: "cs_test_1",
};
test("CRM write preserves existing description, uses conditional version and suppresses workflows", async () => {
  const calls: any[] = [];
  const http = (async (url: any, init: any) => {
    calls.push({ url, init });
    return Response.json(
      init.method === "PUT"
        ? { data: [{ code: "SUCCESS" }] }
        : {
            data: [
              {
                Description: "Existing notes",
                Stage: "Qualification",
                Modified_Time: "2026-10-27T12:00:00+00:00",
              },
            ],
          },
    );
  }) as typeof fetch;
  await new ZohoClient(cfg, http).markPaid(job);
  assert.equal(calls.length, 2);
  const request = calls[1].init;
  const body = JSON.parse(request.body);
  assert.ok(body.data[0].Description.startsWith("Existing notes"));
  assert.ok(body.data[0].Description.includes("[PAC_PAID:purchase-1]"));
  assert.deepEqual(body.trigger, []);
  assert.ok(request.headers["If-Unmodified-Since"]);
});
test("ambiguous previous success is reconciled without a second update", async () => {
  let calls = 0;
  const http = (async () => {
    calls++;
    return Response.json({
      data: [{ Description: "[PAC_PAID:purchase-1]", Stage: "Closed Won" }],
    });
  }) as typeof fetch;
  await new ZohoClient(cfg, http).markPaid(job);
  assert.equal(calls, 1);
});
test("Zoho HTTP failures and per-record failures remain errors for retry", async () => {
  await assert.rejects(
    new ZohoClient(
      cfg,
      (async () => new Response("", { status: 503 })) as typeof fetch,
    ).markPaid(job),
    /503/,
  );
  const http = (async (_url: any, init: any) =>
    Response.json(
      init.method === "PUT"
        ? { data: [{ status: "error", code: "RECORD_LOCKED" }] }
        : { data: [{ Modified_Time: "2026-10-27", Description: "" }] },
    )) as typeof fetch;
  await assert.rejects(
    new ZohoClient(cfg, http).markPaid(job),
    /RECORD_LOCKED/,
  );
});
