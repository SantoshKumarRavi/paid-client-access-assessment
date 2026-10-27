import { db, checked } from "./db.ts";
import { ZohoClient } from "./zoho.ts";
import { config, crmEnvironment } from "./config.ts";
const zoho = new ZohoClient(config);
export async function syncOne(
  purchaseId?: string,
  crm: Pick<ZohoClient, "markPaid"> = zoho,
) {
  const jobs = checked(
    await db.rpc("pac_claim_job", {
      p_purchase: purchaseId || null,
      p_environment: crmEnvironment,
    }),
  );
  const job = jobs[0];
  if (!job) return { claimed: false };
  let error: string | null = null;
  try {
    await crm.markPaid(job);
  } catch (err) {
    error = err instanceof Error ? err.message : "CRM request failed";
  }
  const saved = checked(
    await db.rpc("pac_finish_job", {
      p_purchase: job.purchase_id,
      p_lease: job.lease_token,
      p_error: error,
    }),
  );
  const result = saved ? (error ? "pending" : "synced") : "lease_lost";
  console.info(
    JSON.stringify({
      event: "crm_attempt",
      purchaseId: job.purchase_id,
      attempt: job.attempts,
      result,
    }),
  );
  return { claimed: true, status: result };
}
export function startWorker() {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      for (let i = 0; i < 5; i++) {
        if (!(await syncOne()).claimed) break;
      }
    } catch {
      console.error("CRM worker database error");
    } finally {
      running = false;
    }
  }, 5000);
  timer.unref();
  return () => clearInterval(timer);
}
