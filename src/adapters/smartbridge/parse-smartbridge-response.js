export function parseSmartbridgeResponse(statusCode, body) {
  if (statusCode !== 200) {
    throw new Error(`Smartbridge API returned HTTP ${statusCode}`);
  }
  return JSON.parse(body);
}
