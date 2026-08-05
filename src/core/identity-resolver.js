// Time-scoped device-alias resolution -- ported from a design worked out
// in a separate conversation (see IMPLEMENTATION.md's own write-up for
// the full origin story), adapted to this project's own conventions.
//
// The problem: a playlist entry's `address` is a single, static value, but
// raw device identifiers aren't stable facts -- a BLE MAC rotates under an
// OS privacy policy, a DHCP lease reassigns an IP, a board gets reflashed
// with a shared default hostname. When that happens today, the entry just
// silently stops resolving, with no way to say "this is still the same
// device, it just has a new address as of such-and-such date."
//
// First attempt at a fix (in the originating conversation) was a plain
// `Map<rawKey, canonicalId>` -- one key, one permanent owner. Wrong: that's
// a folder tree, the same mistake as a physical mbox file vs. a Gmail
// label. Corrected model, implemented here: aliases are time-scoped
// observations (`validFrom`/`validTo`), a raw key can resolve to more than
// one live device at once (surfaced as `ambiguous`, never silently
// guessed), and one device can own several alias types at once.
//
// This project's own playlist name already *is* both the lookup key and
// the displayed label (README's "keys are always Semantic" rule) -- unlike
// the originating design, there's no separate canonicalId/display-name
// split to carry here; resolving to a name is resolving to the canonical
// device.

// Only transports this phase's adapters actually query against need an
// implicit alias type -- a record with no `aliases` array (every existing
// playlist entry, today) still resolves via its own plain `address`,
// inferred from its `transport`. Extending to mDNS/DNS later is just
// adding those adapters' own resolveCandidates("hostname", ...) calls;
// the type is already indexed here, ready to be queried.
const IMPLICIT_ALIAS_TYPE_BY_TRANSPORT = {
  bluetooth: "mac",
  "ble-gatt": "mac",
  mdns: "hostname",
  dns: "hostname",
};

function normalizeKey(type, rawValue) {
  return `${type}:${String(rawValue).toLowerCase()}`;
}

// One record's own aliases, normalized -- shared by buildAliasIndex
// (indexing every record's aliases for reverse rawKey -> name lookup) and
// currentAliasValue (below, forward name -> currently-live raw value
// lookup for one record) so both use the exact same explicit-array-or-
// implicit-fallback and time-scoping rules, never two copies to drift.
function recordAliases(record) {
  if (Array.isArray(record.aliases)) {
    return record.aliases.map((alias) => ({
      type: alias.type,
      value: alias.value,
      validFrom: alias.validFrom ? new Date(alias.validFrom) : new Date(0),
      validTo: alias.validTo ? new Date(alias.validTo) : null,
      confidence: alias.confidence ?? 1,
    }));
  }

  // No `aliases` array -- every playlist entry as it exists today.
  // Treated as one implicit, always-valid alias so nothing has to change
  // for a device that's never had its address rotate.
  const impliedType = IMPLICIT_ALIAS_TYPE_BY_TRANSPORT[record.transport];
  if (!impliedType || !record.address) return [];
  return [{ type: impliedType, value: record.address, validFrom: new Date(0), validTo: null, confidence: 1 }];
}

// records: the flat {name: record} shape recordsAsObject(registry) (or
// the playlist itself) already produces everywhere else in this project.
// Returns Map<'type:rawKey', Array<{name, validFrom, validTo, confidence}>>.
export function buildAliasIndex(records) {
  const index = new Map();
  for (const [name, record] of Object.entries(records)) {
    for (const alias of recordAliases(record)) {
      const key = normalizeKey(alias.type, alias.value);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ name, validFrom: alias.validFrom, validTo: alias.validTo, confidence: alias.confidence });
    }
  }
  return index;
}

// The forward direction: given one already-known record (not the whole
// index), which of its own aliases of `type` is live right now? Needed
// for a GATT connect-style read, which has to pick one definite address
// to dial *before* anything comes back to reverse-resolve against --
// unlike an advertisement scan, which naturally sees many raw addresses
// at once and can reverse-resolve each one via resolveCandidates instead.
// Returns the first live value (a record legitimately having more than
// one simultaneously-valid alias of the same type is a real but rare
// case this doesn't try to disambiguate further -- either would connect
// to the same physical device).
export function currentAliasValue(record, type, observedAt = new Date()) {
  const live = recordAliases(record).find(
    (alias) => alias.type === type && observedAt >= alias.validFrom && (!alias.validTo || observedAt <= alias.validTo),
  );
  return live?.value;
}

// Returns one of:
//   { status: 'unknown' }
//   { status: 'resolved', name }
//   { status: 'ambiguous', candidates: [{ name, confidence }] }
// `candidates` on an ambiguous result is a real, live overlap -- two
// devices' aliases both valid for the same raw key at the same instant
// (a MAC collision, a reused IP before an old lease actually expired) --
// surfaced for a caller to log and skip, never silently picked.
export function resolveCandidates(index, type, rawValue, observedAt = new Date()) {
  const entries = index.get(normalizeKey(type, rawValue));
  if (!entries || entries.length === 0) return { status: "unknown" };

  const live = entries.filter((e) => observedAt >= e.validFrom && (!e.validTo || observedAt <= e.validTo));
  if (live.length === 0) return { status: "unknown" };
  if (live.length === 1) return { status: "resolved", name: live[0].name };

  return { status: "ambiguous", candidates: live.map((e) => ({ name: e.name, confidence: e.confidence })) };
}

// A discovery-time convenience for the common "is this raw value already
// claimed by some configured device" check -- resolved and ambiguous both
// count as claimed (an ambiguous raw key still genuinely belongs to
// configured devices, just not unambiguously one of them; it's not a free,
// unclaimed value either way). Shared across every adapter's own
// unclaimed-candidate function rather than each reimplementing the same
// "status !== 'unknown'" check.
export function isClaimed(index, type, rawValue, observedAt = new Date()) {
  return resolveCandidates(index, type, rawValue, observedAt).status !== "unknown";
}
