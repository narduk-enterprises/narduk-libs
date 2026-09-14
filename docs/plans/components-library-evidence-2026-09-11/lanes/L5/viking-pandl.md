# viking-pandl — component-usage survey (L5)

SHA `e02da5c8`, branch `main`. Clone ok.

## Stack

Not an app. `find . -maxdepth 3 -name package.json` finds nothing anywhere in
the repo — there is no npm project, no framework, no build step.
`is_nuxt_app: false`.

## What this repo actually is

A client-engagement deliverables package for a "Viking Sanitation"
P&L/systems-discovery project: markdown briefs (`DELIVERABLE.md`, `PRIVATE.md`,
`docs/*.md`), call transcripts (`source-material/*.txt`), CSV data templates
(`templates/invoice_lines.csv`, `templates/customers_sites.csv`,
`templates/quotes.csv`, `templates/current_route_stops.csv`,
`templates/repricing_20_30_50.csv`, `templates/data_dictionary.csv`), a JSON
schema (`templates/viking_data_package.schema.json`), and two standalone static
HTML report pages (`overview.html`, `VIKING-PAUL-CALL-ONE-PAGER.html`) plus a
rendered PDF export.

## Table/list UI

- `overview.html` (1862 lines): one static `<table>` (line 1633) and four `<ul>`
  lists (lines 1110, 1155, 1543, 1554) — a one-off narrative report/proposal, no
  JS, no framework, no interactivity.
- `VIKING-PAUL-CALL-ONE-PAGER.html` (364 lines): lists only, no `<table>`.
- The CSV templates are raw data-entry templates for the client to fill in and
  send back, not rendered UI at all.

## Verdict

Nothing here is relevant to the shared narduk-libs component effort — no live
application, no consumers, no server contract, no defect history to speak of
(this isn't code that runs).

Evidence: `find . -maxdepth 3 -name package.json` (empty);
`overview.html:1633,1110,1155,1543,1554`;
`VIKING-PAUL-CALL-ONE-PAGER.html:256,259,268,277,284,296,327`; `templates/`
directory listing.
