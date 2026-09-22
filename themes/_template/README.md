# Creating a SwissMouse theme

1. Copy this entire `_template` folder.
2. Rename the copy using lowercase letters, numbers, and hyphens, such as `ocean-mist`.
3. In `theme.json`, set `id` to exactly the same name as the folder and update the other details.
4. Choose a built-in base with `extends`: `light`, `parchment`, `blue`, `slate`, `forest`, or `dark`.
5. In `theme.css`, fill in only the variables you want to override. Blank variables inherit from the base theme.
6. Optionally place a PNG, JPEG, WebP, GIF, or AVIF file in `assets` and reference it with `url("./assets/filename.webp")`.
7. In SwissMouse, open **Settings > Appearance / Theme** and select **Reload Themes**.

See `CUSTOM-THEMES.md` in the main SwissMouse folder for the complete variable reference, validation rules, troubleshooting, and sharing instructions.
