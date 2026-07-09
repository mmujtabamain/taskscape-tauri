interface Props {
  size?: number;
  label?: string;
}

/** A small indeterminate loading spinner, optionally with a caption. */
export function Spinner({ size = 18, label }: Props) {
  return (
    <div className="flex items-center gap-2 text-content-3l dark:text-content-3d">
      <span
        className="inline-block animate-spin rounded-full border-2 border-edge-2l dark:border-edge-2d border-t-accent"
        style={{ width: size, height: size }}
      />
      {label && <span className="text-[13px]">{label}</span>}
    </div>
  );
}
