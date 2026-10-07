# Beat Blaster prompts: what the renders needed

Backend: Grok Imagine (`image_gen`, `image_edit`) through `tools/grok_draw.py`, grok 1.0.46. Every kept render's exact
prompt is in `kit.json` (assets) and `icons/manifest.json` (icons).

## Preambles

Icons (full-colour neon renders on a flat dark ground, knocked out to transparent PNG image sets): see `icons/README.md`.

Vibe cards (one STYLE LOCK pasted ahead of each scene): a premium kids' game card art square, neon arcade cabinet crossed
with a music-production app, deep purple to near-black ground that bleeds to all four edges (no card, no frame, no
shadow), bold chunky vector characters with neon rim light, the app's neon palette, one hero centred at about 70% of the
frame, no text.

App icon: four directions drawn as flat sharp-square icons (speaker burst, wave blast, megaphone, bomb); the bomb won.
An `image_edit` squared the corners and flattened the shading; a second `image_edit` made the one-colour mark.

## Lessons

- "A clear dark margin on every side" made the model draw a card inside the canvas. "Full-bleed wallpaper, never a
  picture inside a picture" fixed most of them; five cards needed a second prompt with that line.
- Solid shapes die in the centreline tracer (notes, hands, a grid of squares): ask for hollow outlines and thin even bars.
- "Three rings" came back as four; a ring plus dot reads as a target. Keep concentric icons to two rings.
- Strong priors win: a kick drum came back as an easel, a drum with dots as a bowling ball, a bass icon with an arrow as a
  male sign. Describe a drum with shock arcs instead.
- Graffiti on the skate ramp came back as readable letters; "abstract stripes, stars and squiggles, no lettering" fixed it.
  "Sleeping" clouds grew a Z; "no zzz" fixed it.
- The model's colours sit about 30 to 50 RGB units off the palette hex. `snap_tol.logo` is 62 so the shipped app icon is
  exact and the cyan layer traces whole.

## Tries

Icons: two renders each, one pick; stop, bass-boost and pluck were redrawn once (the first prompts drew a hollow basket, a
male symbol and a triangle). Vibe cards: two rounds of two to three renders each, a third for five cards.
