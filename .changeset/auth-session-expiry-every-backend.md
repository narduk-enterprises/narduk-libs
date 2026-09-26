---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth: an `auth_sessions` row's expiry is now enforced on the Supabase
backend as well as the local one (#1043, part). That covers every session
read path and `getCurrentSupabaseContext`, which could otherwise refresh an
expired row back to life. Before, a Supabase cookie was accepted on an expired
row while it was inside its revalidation window or when the Supabase refresh
failed recoverably, until a login sweep happened to delete the row. A Supabase
session that made no request for 30 days (the row's window, which a refresh
slides) now signs in again.

Upgrading from narduk-auth below 1.28.0: a Supabase row written before 1.28.0
holds the access token's expiry, about an hour, not the 30-day lifetime, and is
refused once that hour has passed. On an app that upgrades straight from below
1.28.0, every Supabase user not active in the hour before the deploy signs in
again, once; the new sign-in writes a 30-day row. From 1.28.0 a row is
rewritten at its next refresh, so only users idle since that upgrade are
affected, and the login sweep was already deleting their rows.
