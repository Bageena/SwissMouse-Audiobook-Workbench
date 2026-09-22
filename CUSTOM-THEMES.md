# Custom Themes

SwissMouse includes six built-in themes—Light, Parchment, Blue, Slate, Forest, and Dark—and supports small, local custom themes built on top of them. Custom themes can change approved colors and visual tokens, but cannot change the layout, application logic, audio processing, or other behavior.

## Quick start

1. Open SwissMouse and go to **Settings > Appearance / Theme**.
2. Select **Open Themes Folder**.
3. Copy the entire `_template` folder inside `themes`.
4. Rename the copied folder using lowercase letters, numbers, and hyphens, for example `ocean-mist`.
5. Edit the copied `theme.json`. Set `id` to exactly the same value as the folder name.
6. Edit `theme.css`. Add values only for the variables you want to override; blank or missing variables inherit from the selected built-in theme.
7. Return to Settings and select **Reload Themes**.
8. Select the new theme under **Custom**.

The selection is saved automatically and restored when SwissMouse starts.

## Folder structure

Each custom theme has its own folder:

```text
themes/
  _template/                 Starter files; not shown in the theme selector
    theme.json
    theme.css
    README.md
    assets/

  ocean-mist/
    theme.json
    theme.css
    assets/                  Optional
      background.webp
```

Folders beginning with `_` are ignored by theme discovery. This keeps `_template` available without displaying it as an installed theme.

## Manifest reference

Every theme requires a `theme.json` file:

```json
{
  "name": "Ocean Mist",
  "id": "ocean-mist",
  "version": "1.0",
  "author": "Your Name",
  "description": "A calm blue-green SwissMouse theme.",
  "extends": "blue",
  "css": "theme.css"
}
```

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Display name shown in Settings. |
| `id` | Yes | Stable identifier. It must match the folder name and use lowercase letters, numbers, and hyphens. Built-in IDs are reserved. |
| `version` | Yes | Theme version shown to people sharing or maintaining the theme. |
| `author` | No | Theme creator. |
| `description` | No | Short explanation shown as theme help text. |
| `extends` | Yes | Base theme: `light`, `parchment`, `blue`, `slate`, `forest`, or `dark`. |
| `css` | Yes | CSS-token file in the same folder, normally `theme.css`. |

## Inheritance

The `extends` field supplies every value that the custom theme does not override. For example, this theme inherits all Blue theme values except its accent colors:

```css
:root {
  --sm-accent: #3f7c72;
  --sm-accent-hover: #32645c;
  --sm-accent-soft: #d2ebe5;
  --sm-accent-text: #28554e;
  --sm-ring: rgba(63, 124, 114, 0.4);
}
```

Blank declarations in the provided template also inherit:

```css
:root {
  --sm-app-bg: ;
  --sm-accent: #3f7c72;
}
```

When editing by hand, deleting unused lines is also safe.

Color values accept 3/4/6/8-digit hex, comma-separated `rgb(...)` / `rgba(...)` / `hsl(...)` / `hsla(...)`, and basic named colors such as `white`, `black`, or `transparent`. Use explicit values: CSS expressions such as `var(...)`, `calc(...)`, and modern space-separated color syntax are not supported. Invalid colors reject the theme, so an accidental typo cannot make the application unreadable.


## Supported variables

Only the existing SwissMouse design tokens below are accepted. A theme containing unknown variables, selectors, or other CSS rules is rejected instead of being partially loaded.

### Application and surfaces

| Variable | Purpose |
| --- | --- |
| `--sm-app-bg` | Main application background. |
| `--sm-app-bg-top` | Top color of the application background gradient. |
| `--sm-app-background-image` | Optional local image, or `none`. |
| `--sm-surface` | Standard card and panel surface. |
| `--sm-surface-elevated` | Elevated cards, menus, and dialogs. |
| `--sm-surface-subtle` | Secondary and grouped surfaces. |
| `--sm-input` | Inputs, text areas, and dropdowns. |
| `--sm-hover` | Neutral hover and selected background. |

### Text and borders

| Variable | Purpose |
| --- | --- |
| `--sm-ink` | Primary text. |
| `--sm-text-secondary` | Secondary text. |
| `--sm-muted` | Muted labels and supporting text. |
| `--sm-border` | Standard borders. |
| `--sm-border-soft` | Low-emphasis dividers and borders. |

### Accents and strong controls

| Variable | Purpose |
| --- | --- |
| `--sm-accent` | Primary accent and action color. |
| `--sm-on-accent` | Text and icons on primary accent buttons; choose a contrasting color. |
| `--sm-accent-hover` | Primary-action hover color. |
| `--sm-accent-soft` | Low-emphasis accent background. |
| `--sm-accent-text` | Accent-colored text on light surfaces. |
| `--sm-secondary-accent` | Secondary accent. |
| `--sm-strong` | Strong neutral controls and selected steps. |
| `--sm-strong-hover` | Strong-control hover color. |
| `--sm-on-strong` | Text on strong surfaces. |
| `--sm-on-strong-muted` | Secondary text on strong surfaces. |
| `--sm-ring` | Keyboard focus ring, normally an `rgba(...)` color. |
| `--sm-overlay` | Dialog backdrop color. |

### Status colors

| Variable | Purpose |
| --- | --- |
| `--sm-success` / `--sm-success-soft` | Success text and background. |
| `--sm-warning` / `--sm-warning-soft` | Warning text and background. |
| `--sm-error` / `--sm-error-soft` | Error text and background. |
| `--sm-info` / `--sm-info-soft` | Informational text and background. |

### Terminal, waveform, and chapter review

| Variable | Purpose |
| --- | --- |
| `--sm-terminal-bg` | Execution-log background. |
| `--sm-terminal-header` | Execution-log header. |
| `--sm-terminal-text` | Primary log text. |
| `--sm-terminal-muted` | Timestamps and muted log text. |
| `--sm-terminal-border` | Log container borders. |
| `--sm-waveform-baseline` | Waveform center line. |
| `--sm-waveform` | Audio waveform. |
| `--sm-waveform-playhead` | Playback position indicator. |
| `--sm-chapter-marker` | Standard chapter flags. |
| `--sm-chapter-marker-selected` | Selected chapter flag. |
| `--sm-transcript-highlight` | Selected and detected transcript-word background. |
| `--sm-transcript-highlight-text` | Text on transcript highlights. |

## Optional background image

Place a raster image directly in the theme's `assets` folder, then reference it from `theme.css`:

```css
:root {
  --sm-app-background-image: url("./assets/background.webp");
}
```

Supported formats are PNG, JPEG, WebP, GIF, and AVIF. Remote URLs, data URLs, SVG files, parent-directory paths, and nested asset paths are not loaded. Keep backgrounds subtle so text and focus indicators remain readable.

To remove a background supplied by a base or earlier theme, set:

```css
--sm-app-background-image: none;
```

## Validation and troubleshooting

SwissMouse ignores invalid themes without preventing the application from opening. Settings displays a warning when a folder cannot be loaded. Technical details are also appended to:

```text
logs/custom-themes.log
```

Common causes include:

- `theme.json` is missing or contains invalid JSON.
- The folder name and manifest `id` do not match.
- The ID duplicates a built-in or another custom theme.
- `extends` is not one of the six built-in themes.
- The CSS file named by the manifest is missing.
- `theme.css` contains selectors, layout rules, unknown variables, or multiple blocks instead of one `:root` block.
- A background image is missing or uses an unsupported path or format.
- A color value is invalid or uses unsupported CSS syntax.

After correcting a problem, click **Reload Themes** again. If the currently selected custom theme is removed or becomes invalid, SwissMouse safely returns to Light.

## Safety and scope

Custom themes are intentionally limited to visual design tokens. They cannot include JavaScript, plugins, arbitrary CSS selectors, remote content, backend access, or changes to layout and application behavior. Theme files are parsed by SwissMouse; the source stylesheet is never injected directly into the page.

When sharing a theme, include only its folder containing `theme.json`, `theme.css`, and any optional local assets. Recipients can place that folder inside their own `themes` directory and click **Reload Themes**.
