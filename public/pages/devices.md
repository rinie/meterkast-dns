# All Devices

Every entry in the local playlist, resolved or not -- the same data
`GET /devices` returns. Select a row to see its full detail below: a few
curated readings first (see `display-fields/`, a few lines mirroring
a device's own physical console, where a transport has one configured),
optionally narrowed further per device
(`displayFields`/`excludeDisplayFields` in `device-playlist.toml`) --
anything narrowed out stays checkable under "Hidden fields" below, not
gone -- then the raw `meta` a live adapter reading carries in full.

:::form

| .detail | 1fr | 1fr | 1fr |
| Name [name] = | Transport [transport] = | Address [address] = |
| Meta [meta] = |||

:::

<div id="display-fields"></div>

<details id="display-fields-hidden-details" hidden>
<summary>Hidden fields</summary>
<div id="display-fields-hidden"></div>
</details>

```datatable
{"endpoint": "/devices", "columns": ["name", "transport", "address"], "sort": "name"}
```
