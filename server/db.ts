import { createClient } from "@supabase/supabase-js";
import { config } from "./config.ts";
export const db = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
export function checked<T>({
  data,
  error,
}: {
  data: T;
  error: unknown;
}): NonNullable<T> {
  if (error) throw error;
  if (data == null) throw Error("Database returned no data");
  return data;
}
export function userDb(token: string) {
  return createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
