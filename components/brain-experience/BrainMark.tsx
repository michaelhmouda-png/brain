import type { SVGProps } from 'react';

export function BrainMark({ className = '', ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path
        d="M10.25 7.25h7.9c3.05 0 5.35 1.85 5.35 4.55 0 1.83-.96 3.16-2.56 3.94 2.02.68 3.31 2.16 3.31 4.29 0 3.01-2.5 4.97-5.83 4.97h-8.17V7.25Z"
        fill="currentColor"
      />
      <path
        d="M14.25 10.75v3.6h3.45c1.1 0 1.8-.7 1.8-1.78 0-1.12-.73-1.82-1.91-1.82h-3.34Zm0 6.85v3.9h3.78c1.31 0 2.12-.72 2.12-1.92 0-1.25-.86-1.98-2.23-1.98h-3.67Z"
        fill="white"
      />
      <path
        d="M7.25 8.75v14.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity=".35"
      />
    </svg>
  );
}
