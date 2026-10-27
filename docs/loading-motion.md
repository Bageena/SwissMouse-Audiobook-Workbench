# Shared loading motion

Built-in components and future trusted plugin contributions can import `LoadingMotion` and `LoadingMotionProps` from `src/workspace`.

```tsx
<LoadingMotion active={loading} spin>
  <YourIcon />
</LoadingMotion>
```

Use `spin={false}` (the default) if the child already animates a subpart, as `RefreshDocumentIcon` does. The owning control supplies an accessible name, `aria-busy`, and any screen-reader progress status. The wrapper reserves the original layout footprint while its drawing elevates and scales. Completion reverses the same transition.

Themes can set these validated custom properties:

- `--sm-loading-lift`: 0–24px; default 7px.
- `--sm-loading-scale`: 1–2; default 1.3.
- `--sm-loading-duration`: 50–5000ms; default 220ms.
- `--sm-loading-spin-duration`: 50–5000ms; default 1000ms.
- `--sm-loading-shadow`: a supported color.

Reduced-motion preferences disable movement, transitions, and spinning. `data-sm-loading` on the audio check button also removes its paper background while active. This is a reusable component contract, not a third-party plugin installer or runtime.
