interface IconProps {
  name: string;
  size?: number;
  filled?: boolean;
  weight?: number;
  className?: string;
  title?: string;
}

/** A Material Symbols (Outlined) glyph. Font is self-hosted via the
 *  `material-symbols` package, so it works fully offline. Weight defaults to
 *  the theme's optical weight (--icon-wght: 350 light / 300 dark — light
 *  glyphs on dark render heavier, so dark mode compensates). */
export function Icon({ name, size = 20, filled = false, weight, className = "", title }: IconProps) {
  return (
    <span
      className={`material-symbols-outlined select-none leading-none ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${weight ?? "var(--icon-wght, 350)"}`,
      }}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {name}
    </span>
  );
}
