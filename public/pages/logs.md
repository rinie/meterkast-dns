# Log

The backend's own recent activity, live -- new entries appear
automatically as they happen, the same running log view
Domoticz/Home Assistant show. Bounded to the last 500 entries; older
ones roll off.

```datatable
{"endpoint": "/logs", "columns": ["timestamp", "level", "message"], "sort": "timestamp", "reverse": true, "rowClassKey": "level", "live": true}
```
