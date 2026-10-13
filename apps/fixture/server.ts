import express from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
export function startFixture(port = 4174) {
  const app = express();
  let mutations = 0,
    requests = 0,
    errors = 0,
    responseBytes = 0;
  app.use((req, res, next) => {
    if (req.path !== "/api/metrics") {
      requests++;
      res.on("finish", () => {
        if (res.statusCode >= 500) errors++;
        responseBytes += Number(res.getHeader("content-length") || 0);
      });
    }
    next();
  });
  app.get("/robots.txt", (_req, res) =>
    res.type("text").send("User-agent: *\nDisallow: /robots-blocked\n"),
  );
  app.get("/robots-blocked", (_req, res) => {
    mutations++;
    res.send("Must not be visited");
  });
  app.post("/api/delete", (_req, res) => {
    mutations++;
    res.json({ deleted: true });
  });
  app.get("/api/metrics", (_req, res) =>
    res.json({ mutations, requests, errors, responseBytes }),
  );
  app.get("/download", (_req, res) =>
    res.attachment("sample.txt").send("Atlas sample report"),
  );
  app.use((_req, res) =>
    res
      .type("html")
      .send(readFileSync(resolve("apps/fixture/index.html"), "utf8")),
  );
  return app.listen(port, process.env.HOST || "127.0.0.1", (error?: Error) => {
    if (error) throw error;
    console.log(`Fixture: http://127.0.0.1:${port}`);
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  startFixture(Number(process.env.FIXTURE_PORT) || 4174);
