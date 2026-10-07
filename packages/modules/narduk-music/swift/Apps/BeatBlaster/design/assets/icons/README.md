# Beat Blaster icons

52 monoline arcade UI glyphs, drawn one per render by Grok Imagine (`image_gen`), then thinned to a centreline and
traced to `currentColor` SVG by `tools/trace.py`. Nothing here is drawn in code. `manifest.json` records each icon's
exact prompt, backend and tool; `raw/` holds the kept renders and `svg/` the shipped icons.

Preamble used on every icon (then the subject):

> Minimal monoline icon, solid black ink on a pure white square. Each mark is one filled bar of even thickness with
> rounded caps, and the white gap between separate bars is at least as wide as a bar. Bold arcade-game interface
> symbol, friendly and confident, crisp, centered, large in the frame, generous white margin. No text, no shading,
> no gray, no frame, no 3D, no extra objects. Subject:

Solid areas thin badly in the tracer, so notes, hands and grids are drawn as outlines. To add an icon: draw it,
`python3 tools/kit.py keep --root .. <render> <name> --kind icon --category <c> --label <L> --prompt-file <p>`,
then `python3 tools/trace.py --root .` and `python3 tools/preview.py --root .`.
