import { app } from "./app.ts";
import { config } from "./config.ts";
import { startWorker } from "./worker.ts";
import express from "express";
import path from "node:path";
import { createServer as createHttpServer } from "node:http";
const server = createHttpServer(app);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
server.listen(config.PORT, "127.0.0.1", () =>
  console.info(`Fieldnotes portal: ${config.APP_URL} (Stripe TEST mode)`),
);
const stop = config.CRM_WORKER_ENABLED === "true" ? startWorker() : () => {};
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    stop();
    server.close(() => process.exit(0));
  });
