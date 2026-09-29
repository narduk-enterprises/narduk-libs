---
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
---

Strict privacy mode no longer sends exception message text.
`$exception_list[].value` becomes `(redacted)`, and `$exception_message` and
`redacted_message` are dropped. The type, stack and route pattern stay. Before
this change, strict mode sent narduk-core's `redacted_message`, which strips
only query strings and email addresses. As a result, an ofetch
`[GET] "/api/records/<id>": 404` or an app's `No skill named "<name>"` still
left the browser with the record in it.
