// Ecowitt wraps success/failure in the body itself, not just HTTP status:
// {code: 0, msg: "success", data: {...}}. code !== 0 is a real API-level
// error even when HTTP itself returned 200.
export function parseEcowittResponse(statusCode, body) {
  if (statusCode !== 200) {
    throw new Error(`Ecowitt API returned HTTP ${statusCode}`);
  }
  const parsed = JSON.parse(body);
  if (parsed.code !== 0) {
    throw new Error(`Ecowitt API error: ${parsed.msg} (code ${parsed.code})`);
  }
  return parsed.data;
}
