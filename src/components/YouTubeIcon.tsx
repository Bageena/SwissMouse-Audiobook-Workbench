import React from 'react';

export const YouTubeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor" />
    <path d="m10 8 6 4-6 4Z" fill="white" />
  </svg>
);
