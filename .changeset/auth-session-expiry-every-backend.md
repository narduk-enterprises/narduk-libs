---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth: every request now enforces an `auth_sessions` row's expiry, on
the Supabase backend as well as the local one (#1043, part). Before, a
Supabase cookie was accepted on an expired row while it was inside its
revalidation window or when the Supabase refresh failed recoverably. It stayed
valid until a login sweep happened to delete the row. A Supabase session that
made no request for 30 days (the row's window, which a refresh slides) now
signs in again. Before, whether it could still refresh depended on whether a
sweep had run.
