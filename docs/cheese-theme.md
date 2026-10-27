# Cheese — Paper & Ink

Cheese is an additional built-in theme. Light, Parchment, Blue, Slate, Forest,
and Dark retain their existing palettes. Select Cheese in Settings → Appearance.
Existing saved theme selections and the default Light theme are preserved.

The visual direction is a warm, slightly darker fibrous sketchbook: yellow
watercolor washes, cream paper surfaces, charcoal shadows, pencil-like body
lettering, heavier pen-like bold text, and cursive H1 headings. Buttons gain an
inset charcoal shadow while pressed. Disclosure arrows become illustrated
carrots; play controls become cheese wedges. The supplied mouse SVG replaces
the former header logo and headphone favicon across themes.

## Assets and boundaries

- `src/cheese.css` scopes the presentation to `data-theme="cheese"`.
- Existing paper textures are reused from `src/assets/textures/Cheese`.
- The carrot disclosure SVG lives in `src/assets/Icons/cheese`.
- The coordinated icon catalog lives in `src/assets/paper-ink`, with original
  illustrations and attributed utility adaptations. See `paper-ink-icon-system.md`.
- Typography uses installed Segoe Print and Segoe Script on Windows, with
  handwriting/cursive fallbacks elsewhere. No font files or remote font requests
  are added; rendering will vary on systems without these fonts.
- Timestamps, code, and technical logs retain monospace typography.
- Focus indicators, accessible control labels, reduced motion, and native icon
  outlines in forced-color mode are retained.

The icon catalog covers current controls and planned media categories without
introducing a new unrestricted theme-pack format. Space, cardboard Forest, and
rainy urban Lofi remain future directions; the legacy Forest theme is unchanged.
Future refinement can add more illustrated controls and portable licensed fonts.
# Cover frame theme hooks

The idle header player always remains visible, showing its thoughtful mouse and a
rotating message. Custom themes can set `--sm-idle-player-art: url('./assets/mouse.png')`
using the same local raster asset rules as the theme background. Existing
`--sm-theme-logo` overrides are also respected. The bundled path-only SVG mouse
is the fallback; the main app logo is unchanged. Messages advance on idle-player activation and the position
is remembered for the current browser session; rerenders do not rotate the text.

The metadata cover preview uses the shared `CoverFrame` component. Its frame is
presentation only; it does not change the saved or exported cover image.
Custom themes can set `--sm-cover-frame-bg`, `--sm-cover-frame-border`,
`--sm-cover-mat`, and `--sm-cover-frame-shadow` to supported colors, and
`--sm-cover-frame-padding` / `--sm-cover-frame-radius` to lengths from 0px to 32px.
Other palettes fall back to their existing surface and border colors. Cheese uses
a textured paper mat with a warm edge and charcoal shadow. Component skins should
use semantic classes and theme variables rather than theme branches in JSX.
