# Discover Devices

Real devices that exist but aren't in the playlist yet -- an unrecognized
Dirigera device, an unpaired Smartbridge/ICS2000 device, an unclaimed
local DNS hostname -- found by scanning and subtracting what's already
claimed. Click Scan to hit the real API/network (nothing runs
automatically or on an interval; this only scans when asked).
"Add to playlist" writes the device into `device-playlist.toml` (a real
file write, with a backup, same as any hand-edit) and it shows up in
`GET /devices` immediately -- but it only starts *polling* after the next
`meterkastd` restart, since the playlist is read once at startup.

## Dirigera

```datatable
{"discover": true, "endpoint": "/discover/dirigera", "buttonLabel": "Scan Dirigera Hub", "columns": ["suggestedName", "deviceType", "address"]}
```

## Smartbridge

```datatable
{"discover": true, "endpoint": "/discover/smartbridge", "buttonLabel": "Scan Smartbridge", "columns": ["suggestedName", "address"]}
```

## DNS

A reverse-PTR sweep of your own local subnet -- plain DNS has no
"browse" the way mDNS does, so this is the only discovery mechanism it
actually has. Enter your LAN's subnet (e.g. `192.168.1.0/24`); capped at
`/22` (1024 addresses) so a typo can't accidentally sweep something much
larger. Most addresses have no PTR record at all -- that's the normal,
expected outcome for most of a subnet, not an error.

```datatable
{"discover": true, "endpoint": "/discover/dns", "buttonLabel": "Scan Subnet", "cidrInput": true, "columns": ["suggestedName", "address"]}
```
