import "dotenv/config";
import { spawn } from "node:child_process";
// Starts in the foreground so the operator sees Stripe delivery confirmations.
const child = spawn(
  "stripe",
  [
    "listen",
    "--api-key",
    process.env.STRIPE_SECRET_KEY,
    "--events",
    "checkout.session.completed,checkout.session.async_payment_succeeded",
    "--forward-to",
    `${process.env.APP_URL || "http://localhost:4242"}/api/webhook`,
  ],
  { stdio: "inherit", windowsHide: true },
);
child.on("error", () => {
  console.error("Install the official Stripe CLI first.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code || 0;
});
