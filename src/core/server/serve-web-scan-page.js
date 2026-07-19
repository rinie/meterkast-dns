import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PAGE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public", "web-scan.html");

export async function serveWebScanPage(req, res) {
  const html = await readFile(PAGE_PATH, "utf8");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}
