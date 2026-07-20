# All Devices

Every entry in the local playlist, resolved or not -- the same data
`GET /devices` returns. Select a row to see its full detail below: a few
curated readings first (see `display-fields.toml`, a few lines mirroring
a device's own physical console, where a transport has one configured),
then the raw `meta` a live adapter reading carries in full.

:::form

| .detail | 1fr | 1fr | 1fr |
| Name [name] = | Transport [transport] = | Address [address] = |
| Meta [meta] = |||

:::

<div id="display-fields"></div>

```datatable
{"endpoint": "/devices", "columns": ["name", "transport", "address"], "sort": "name"}
```
