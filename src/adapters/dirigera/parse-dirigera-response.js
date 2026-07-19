export function parseDirigeraResponse(statusCode, body) {
  if (statusCode !== 200) {
    throw new Error(`Dirigera API returned ${statusCode}`);
  }
  return JSON.parse(body);
}
