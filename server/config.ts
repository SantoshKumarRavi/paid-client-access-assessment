import "dotenv/config";
import { z } from "zod";
function jwtRole(key: string) {
  try {
    return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString())
      .role;
  } catch {
    return null;
  }
}
const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4242),
  APP_URL: z.url(),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(20)
    .refine(
      (key) => key.startsWith("sb_publishable_") || jwtRole(key) === "anon",
      "Browser key must be publishable or legacy anon",
    ),
  SUPABASE_SECRET_KEY: z
    .string()
    .min(20)
    .refine(
      (key) => key.startsWith("sb_secret_") || jwtRole(key) === "service_role",
      "Server key must be secret or legacy service_role",
    ),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_test_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  ZOHO_ACCOUNTS_URL: z
    .enum([
      "https://accounts.zoho.in",
      "https://accounts.zoho.com",
      "https://accounts.zoho.eu",
    ])
    .default("https://accounts.zoho.in"),
  ZOHO_API_URL: z
    .enum([
      "https://www.zohoapis.in",
      "https://www.zohoapis.com",
      "https://www.zohoapis.eu",
      "https://developer.zohoapis.in",
      "https://developer.zohoapis.com",
      "https://developer.zohoapis.eu",
    ])
    .default("https://developer.zohoapis.in"),
  ZOHO_CLIENT_ID: z.string().optional(),
  ZOHO_CLIENT_SECRET: z.string().optional(),
  ZOHO_REFRESH_TOKEN: z.string().optional(),
  ZOHO_ACCESS_TOKEN: z.string().optional(),
  ZOHO_PAID_STAGE: z.string().default("Closed Won"),
  CRON_SECRET: z.string().min(32).optional(),
  CRM_WORKER_ENABLED: z.enum(["true", "false"]).default("true"),
});
export const config = schema.parse(process.env);
export const crmEnvironment = new URL(config.ZOHO_API_URL).hostname.startsWith(
  "developer.",
)
  ? "developer"
  : "production";
if (new URL(config.APP_URL).origin !== config.APP_URL)
  throw Error("APP_URL must be an origin without trailing slash");
