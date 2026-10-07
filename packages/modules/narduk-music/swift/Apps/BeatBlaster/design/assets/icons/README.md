# Beat Blaster icons

79 full-colour glossy neon icons, one per render, drawn by Grok Imagine (`image_gen`). They ship as images, not vectors:
nothing is traced or redrawn. `tools/ios_export.py` knocks out each flat dark ground, trims to a square and writes
`ios/Images.xcassets/icon-<name>.imageset` at 96/192/288 px (1x/2x/3x). `raw/` keeps the 1024 px renders with their
ground; `manifest.json` records each icon's exact prompt, backend and tool. There is no `svg/` or `preview.html` on
purpose, so `kit.py check` reports those as missing; that is the only thing it reports.

Preamble used on every icon (then the subject; the colour word changes per icon):

> Glossy neon arcade game UI icon. One bold chunky symbol drawn as solid thick rounded shapes in electric cyan, with a lighter highlight along its upper edge, a deeper shade along its lower edge and a thin bright rim light, thick friendly proportions, hollow parts drawn as thick tubes with a clear gap between parts. The symbol sits alone on a perfectly flat solid near-black violet ground (#0B0614) that fills the whole square edge to edge: no glow haze around it, no gradient or texture in the ground, no shadow on the ground, no frame, no text, no letters, no extra objects. Centered and large with a clear margin, readable at a small size. Premium kids' game UI crossed with a neon arcade cabinet and a modern music app; cool to a ten-year-old, not babyish, not emoji, not clip-art, not a thin line icon. Subject:

To add an icon: draw it, `python3 tools/kit.py keep --root . <render> <name> --kind icon --category <c> --label <L>
--prompt-file <p>`, then `python3 tools/ios_export.py --root .`. Icons whose dark interior must stay (kit-zappy) are listed in
`KEEP_ISLANDS` in `ios_export.py`.
