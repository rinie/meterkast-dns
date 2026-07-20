# All Devices

Every entry in the local playlist, resolved or not -- the same data
`GET /devices` returns. Select a row to see its full detail, including
the raw `meta` a live adapter reading carries, below.

:::form

| .detail | 1fr | 1fr | 1fr |
| Name [name] = | Transport [transport] = | Address [address] = |
| Meta [meta] = |||

:::

```datatable
{"endpoint": "/devices", "columns": ["name", "transport", "address"], "sort": "name"}
```
