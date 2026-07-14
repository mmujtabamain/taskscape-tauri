import { type ReactNode } from 'react';

/** A labelled section divider used across the inspector panels. */
export function SectionHeader({
  label,
  trailing,
}: {
  label: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-3">
      <span className="text-content-3l dark:text-content-3d text-[11px] font-semibold tracking-widest uppercase">
        {label}
      </span>
      <span className="border-edge-1l dark:border-edge-1d flex-1 border-t" />
      {trailing}
    </div>
  );
}
