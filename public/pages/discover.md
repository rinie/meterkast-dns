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
expected outcome for most of a subnet, not an error. Set
`METERKAST_DNS_CIDR` in `.env` to pre-fill this with your real subnet
(it doesn't change scan to scan) -- still editable for a one-off scan of
somewhere else.

```datatable
{"discover": true, "endpoint": "/discover/dns", "buttonLabel": "Scan Subnet", "cidrInput": true, "cidrDefaultEndpoint": "/discover/dns/default-cidr", "columns": ["suggestedName", "address"]}
```

## USB (Windows)

An `lsusb`-equivalent for Windows -- every USB device Windows currently
sees (`Get-PnpDevice`), no native Node addon and no build toolchain
required. This lists real hardware, not just what WebUSB could reach:
mice, hubs, printers, anything plugged in, regardless of which driver
claimed it. Many of these are claimed by their own Windows class driver
(HID, storage, printer, ...) and WebUSB categorically cannot open them no
matter how the playlist entry is configured afterward -- this only
confirms a device with this VID:PID is real and currently attached, the
same as `lsusb` would. Windows-only; the scan fails clearly on any other
OS.

```datatable
{"discover": true, "endpoint": "/discover/usb", "buttonLabel": "Scan USB Devices", "columns": ["suggestedName", "address"]}
```

## Bluetooth (Windows, Paired)

Every Bluetooth device Windows has already paired/bonded with
(`Get-PnpDevice`), fast -- a couple seconds. A real MAC address, not
WebBluetooth's opaque `device.id` (Web Bluetooth deliberately never
exposes a device's true address to page JS). Windows-only.

```datatable
{"discover": true, "endpoint": "/discover/bluetooth-paired", "buttonLabel": "Scan Paired Bluetooth", "columns": ["suggestedName", "address"]}
```

## Bluetooth (Windows, Nearby)

Devices Windows can currently see advertising nearby but hasn't paired
with -- a real scan, not a cached list, using a one-shot WinRT call (no
compiled helper, no native Node addon). **Takes about 30 seconds** --
that's a real discovery window Windows itself runs, not something this
page controls or can speed up. (The more obvious API for this,
`BluetoothLEAdvertisementWatcher`'s own live event stream, doesn't work
here at all: Windows PowerShell can't subscribe to WinRT events --
confirmed directly, not assumed -- so this uses a different, one-shot
WinRT call instead.) Windows-only.

```datatable
{"discover": true, "endpoint": "/discover/bluetooth-nearby", "buttonLabel": "Scan Nearby Bluetooth (~30s)", "columns": ["suggestedName", "address"]}
```

## mDNS (via proxy)

Previously parked entirely -- this machine's own local mDNS is
firewall-blocked outright, not just slow, so there was no way to browse
at all. A [meterkast-proxy](https://github.com/rinie/meterkast-proxy)
board on the same LAN does the actual browsing and exposes what it's seen
as JSON; every proxy in `METERKAST_PROXY_HOSTS` (.env) is queried in
parallel. Fails clearly if `METERKAST_PROXY_HOSTS` isn't set -- no silent
empty result.

```datatable
{"discover": true, "endpoint": "/discover/mdns", "buttonLabel": "Scan mDNS (via proxy)", "columns": ["suggestedName", "address"]}
```

## Bluetooth (via proxy)

A real NimBLE scan running on a
[meterkast-proxy](https://github.com/rinie/meterkast-proxy) board --
real MAC addresses, same as the Windows-native paths above, unlike
WebBluetooth's deliberately opaque `device.id`. Useful when this laptop
isn't near the device you're after, or alongside the Windows-native scans
for a second vantage point. Also fails clearly if `METERKAST_PROXY_HOSTS`
isn't set.

```datatable
{"discover": true, "endpoint": "/discover/bluetooth-proxy", "buttonLabel": "Scan Bluetooth (via proxy)", "columns": ["suggestedName", "address"]}
```
