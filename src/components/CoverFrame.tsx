import React from 'react';

/** Presentation belongs to the theme; the artwork itself stays untouched. */
export function CoverFrame({ children }: { children: React.ReactNode }) {
  return <div className="cover-art-frame">{children}</div>;
}
