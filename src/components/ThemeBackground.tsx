

/** Decorative theme planes. Content and hit targets always remain above them. */
export function ThemeBackground({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return <div className="theme-background" aria-hidden="true">
    <div className="theme-background-plane desk-doodles" />
    <div className="theme-background-plane desk-far" />
    <div className="theme-background-plane desk-art" />
    <div className="theme-background-plane desk-thoughts" />
    <div className="theme-background-plane desk-near" />
  </div>;
}
