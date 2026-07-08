interface Props {
  size?: number;
  label?: string;
}

/** A small indeterminate loading spinner, optionally with a caption. */
export function Spinner({ size = 18, label }: Props) {
  return (
    <div className="flex items-center gap-2 text-zinc-400">
      <span
        className="inline-block animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-600 dark:border-zinc-700 dark:border-t-indigo-400"
        style={{ width: size, height: size }}
      />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}
