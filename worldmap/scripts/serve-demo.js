/**
 * Minimal static file server, so the demo can run with no network and no
 * third-party tooling:  node worldmap/scripts/serve-demo.js
 *
 * ES modules and fetch() are both blocked on file:// URLs, so the demo needs
 * to be served over http — but it does not need anything more than this.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

http
  .createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");

    // Redirect rather than serve the page's content at "/": the demo's own
    // relative URLs (./demo.js, ../data/…) resolve against the address bar, so
    // serving /demo/index.html at / would break every one of them.
    if (url.pathname === "/") {
      response.writeHead(302, { Location: "/demo/" }).end();
      return;
    }

    const requested = url.pathname.endsWith("/")
      ? `${url.pathname}index.html`
      : url.pathname;

    // Resolve, then confirm the result is still inside ROOT before reading it.
    const file = path.join(ROOT, decodeURIComponent(requested));
    if (!file.startsWith(ROOT + path.sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    fs.readFile(file, (error, body) => {
      if (error) {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      response.end(body);
    });
  })
  .listen(PORT, () => {
    console.log(`WorldMap demo  ->  http://localhost:${PORT}/`);
  });
