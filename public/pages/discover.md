# Discover Devices

Real devices that exist but aren't in the playlist yet -- an unrecognized
Dirigera device, an unpaired Smartbridge/ICS2000 device -- found by
scanning a hub or cloud API's own full inventory and subtracting what's
already claimed. Click Scan to hit the real API (nothing runs
automatically or on an interval; this only fetches when asked).
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
