import { createServer as createHttpServer } from "node:http";
import { handleList } from "./handle-list.js";
import { handleGet } from "./handle-get.js";
import { handleSubscribe } from "./handle-subscribe.js";
import { handleReport } from "./handle-report.js";
import { serveWebScanPage } from "./serve-web-scan-page.js";

export function createServer(registry) {
  return createHttpServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/devices") {
      return handleList(registry, req, res);
    }

    if (req.method === "GET" && url.pathname === "/events") {
      return handleSubscribe(registry, req, res);
    }

    if (req.method === "GET" && url.pathname === "/web-scan") {
      return serveWebScanPage(req, res);
    }

    const deviceMatch = url.pathname.match(/^\/devices\/([^/]+)$/);
    if (req.method === "GET" && deviceMatch) {
      return handleGet(registry, decodeURIComponent(deviceMatch[1]), req, res);
    }
    if (req.method === "POST" && deviceMatch) {
      return handleReport(registry, decodeURIComponent(deviceMatch[1]), req, res);
    }

    res.writeHead(404).end();
  });
}
