# caminoreal — component-usage survey (L5)

SHA `8264bfd0`, branch `main`. Clone ok.

## Stack

Astro 5.7 static site (`astro.config.mjs`, `astro build`). No Vue, no Nuxt, no
Tailwind, no component library — plain CSS in `src/styles/global.css`.
`is_nuxt_app: false`.

## App shape

A single-page restaurant marketing site: `src/pages/index.astro` plus four
components (`Hero.astro`, `HeroScene.astro`, `Header.astro`,
`PapelPicado.astro`) and one layout (`Base.astro`). Content lives in
`src/data/site.js` and `src/data/menu.js` (240 lines, a plain array of menu
categories/items with name/desc/price).

## Table/list UI

None in the data-grid sense.
`grep -rnoE '<table|<ul|<ol|role="table"|grid-cols' src --include='*.astro'`
returns only `<ul>` at `src/pages/index.astro:246,296,306,315` and
`src/components/Header.astro:38` — nav and footer link lists. The menu data
(`src/data/menu.js`) is rendered as marketing cards/sections, not a
sortable/filterable/paginated table.

## Verdict

Not a candidate for the shared table component or any other narduk-libs pattern
— it's a brochure site with no runtime data fetching, no admin surface, no
interactive lists.

Evidence: `astro.config.mjs`, `package.json` (astro ^5.7.0 only dep of note),
`src/data/menu.js` (240 lines), `src/pages/index.astro:246,296,306,315`,
`src/components/Header.astro:38`.
