# Resolved Names

The local resolver's live `dns`/`mdns` resolution results -- see
README.md's "Extending to router-assigned local DNS names" and the
mDNS/DNS-SD "MQTT adapter" section for what each transport actually
does. Select a row to see its full detail below.

:::form

| .detail | 1fr | 1fr | 1fr | 1fr |
| Name [name] = | Transport [transport] = | Lookup [address] = | Resolved [resolvedAddress] = |

:::

```datatable
{"endpoint": "/resolved", "columns": ["name", "transport", "address", "resolvedAddress"], "header": {"address": "Lookup", "resolvedAddress": "Resolved"}, "sort": "name"}
```
