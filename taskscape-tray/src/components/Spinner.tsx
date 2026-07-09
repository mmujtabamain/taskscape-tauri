interface Props {
  size?: number;
  className?: string;
}

/** A small indeterminate loading spinner in the mini bar's palette. */
export function Spinner({ size = 14, className = "" }: Props) {
  return (
    <span
      className={
        "inline-block animate-spin rounded-full border-2 " +
        "border-edge-3l border-t-accent-500 " +
        "dark:border-edge-3d dark:border-t-accent-400 " +
        className
      }
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
