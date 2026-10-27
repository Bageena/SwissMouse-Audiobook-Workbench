import type { ReactNode } from 'react';

export interface LoadingMotionProps { active: boolean; spin?: boolean; children: ReactNode; className?: string }
/** Shared loading elevation. Keep accessible progress/status on the owning control. */
export function LoadingMotion({ active, spin = false, children, className = '' }: LoadingMotionProps) {
  return <span className={`sm-loading-motion ${className}`} data-active={active}>
    <span className="sm-loading-motion-content" data-spin={active && spin}>{children}</span>
  </span>;
}
