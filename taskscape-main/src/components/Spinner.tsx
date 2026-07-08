interface Props {
  size?: number;
  label?: string;
}

/** A small indeterminate loading spinner, optionally with a caption. */
export function Spinner({ size = 18, label }: Props) {
  return (
    <div className="flex items-center gap-2 text-ink-3">
      <span
        className="inline-block animate-spin rounded-full border-2 border-hairline border-t-accent"
        style={{ width: size, height: size }}
      />
      {label && <span className="text-[13px]">{label}</span>}
    </div>
  );
}
