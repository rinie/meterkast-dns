export function suffixFromIp(ipv4) {
  const parts = ipv4.split(".");
  if (parts.length !== 4) return null;
  return parts[3];
}
