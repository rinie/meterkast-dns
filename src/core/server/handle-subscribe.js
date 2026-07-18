import { subscribe } from "../registry/subscribe.js";

export function handleSubscribe(registry, req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(": connected\n\n"); // force headers onto the wire now, not on first event
  const unsubscribe = subscribe(registry, (event) => {
    res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
  });
  req.on("close", unsubscribe);
}
