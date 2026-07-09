interface IconProps {
  name: string;
  size?: number;
  filled?: boolean;
  weight?: number;
  className?: string;
  title?: string;
}

/** A Material Symbols (Outlined) glyph. Font is self-hosted via the
 *  `material-symbols` package, so it works fully offline. */
export function Icon({
  name,
  size = 20,
  filled = false,
  weight = 400,
  className = "",
  title,
}: IconProps) {
  return (
    <span
      className={`material-symbols-outlined select-none leading-none ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${weight}`,
      }}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {name}
    </span>
  );
}
