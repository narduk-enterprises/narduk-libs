---
"@narduk-enterprises/narduk-core": minor
"@narduk-enterprises/narduk-seo": minor
"@narduk-enterprises/create-narduk-app": patch
---

Block SEO, backlink and scraper crawlers by default. narduk-core adds a `00-0-bot-block` server middleware that answers `403` (cacheable for a day, no render, no I/O) to SemrushBot, AhrefsBot, MJ12bot, DotBot, SERankingBacklinksBot, DataForSeoBot, BLEXBot, Barkrowler, serpstatbot, PetalBot, Bytespider, MochiImageCrawler, SeekportBot, MegaIndex, Linkdex, AwarioBot, ImagesiftBot and Timpibot, exports the list as `DEFAULT_BLOCKED_BOTS` from `@narduk-enterprises/narduk-core/shared/bot-block`, and adds `nardukCore.botBlock: { enabled, extra, allow }` (`false` opts out). `/robots.txt`, `/api/health`, search engines, social preview fetchers, uptime monitors, scripts and requests without a User-Agent are never blocked. narduk-seo emits matching `Disallow: /` robots.txt groups from the same list and the same option, and now needs narduk-core 2.34 or newer.
