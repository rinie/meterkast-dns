export function suffixFromCounter(existingNames, base) {
  if (!existingNames.includes(base)) return "";
  let n = 2;
  while (existingNames.includes(`${base}${n}`)) n++;
  return String(n);
}
