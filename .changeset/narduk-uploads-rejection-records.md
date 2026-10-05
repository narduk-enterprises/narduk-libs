---
'@narduk-enterprises/narduk-uploads': patch
'@narduk-enterprises/create-narduk-app': patch
---

Record every upload refusal and storage failure through narduk-core's request logger. Each 4xx from
`POST /api/upload` writes one `Upload rejected` warn with its `statusCode` and a stable `reason`
(missing or oversized `Content-Length`, an oversized body, no file, an unsupported type, an
oversized file, bytes that are not an image); a failed R2 write or read writes an error record with
the sanitized error. The performance-budget warning no longer records the client's file name, which
can name a person; records carry sizes, counts, keys and normalized types only. Responses are
unchanged.
