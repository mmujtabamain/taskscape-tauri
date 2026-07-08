import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { setOverlay } from "../lib/overlays";

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Renders a separator above this item. */
  dividerAbove?: boolean;
  shortcut?: string;
  submenu?: MenuItem[];
}

interface OpenMenu {
  items: MenuItem[];
  x: number;
  y: number;
  onPick: (id: string) => void;
}

const MenuContext = createContext<{ open: (m: OpenMenu) => void }>({ open: () => {} });

export function useContextMenu() {
  return useContext(MenuContext);
}

/** App-wide context-menu layer. Wrap the window root once; open menus from
 *  anywhere via useContextMenu().open({ items, x, y, onPick }). */
export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);

  useEffect(() => {
    if (!menu) return;
    setOverlay(true);
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      setOverlay(false);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  return (
    <MenuContext.Provider value={{ open: setMenu }}>
      {children}
      {menu &&
        createPortal(
          <div
            className="fixed inset-0 z-50"
            onMouseDown={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          >
            <MenuPanel
              items={menu.items}
              x={menu.x}
              y={menu.y}
              onPick={(id) => {
                setMenu(null);
                menu.onPick(id);
              }}
            />
          </div>,
          document.body,
        )}
    </MenuContext.Provider>
  );
}

function MenuPanel({
  items,
  x,
  y,
  onPick,
  nested = false,
}: {
  items: MenuItem[];
  x: number;
  y: number;
  onPick: (id: string) => void;
  /** A submenu positioned by its wrapper — skip the viewport clamp. */
  nested?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [subFor, setSubFor] = useState<string | null>(null);

  // Flip the panel back inside the viewport once its real size is known.
  useLayoutEffect(() => {
    if (nested) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y, nested]);

  return (
    <div
      ref={ref}
      style={nested ? undefined : { left: pos.x, top: pos.y }}
      className={`${nested ? "" : "absolute"} min-w-44 rounded-lg border border-hairline bg-raised py-1 shadow-menu`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <div key={item.id} className="relative">
          {item.dividerAbove && <div className="mx-2 my-1 border-t border-hairline" />}
          <button
            disabled={item.disabled}
            onMouseEnter={() => setSubFor(item.submenu ? item.id : null)}
            onClick={() => {
              if (!item.submenu) onPick(item.id);
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors ${
              item.danger ? "text-danger hover:bg-danger-soft" : "text-ink hover:bg-wash-strong"
            } disabled:pointer-events-none disabled:opacity-40`}
          >
            {item.icon && <Icon name={item.icon} size={15} className="text-ink-3" />}
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && <span className="text-[11px] text-ink-3">{item.shortcut}</span>}
            {item.submenu && <Icon name="chevron_right" size={14} className="text-ink-3" />}
          </button>
          {item.submenu && subFor === item.id && (
            <Submenu>
              <MenuPanel items={item.submenu} x={0} y={0} onPick={onPick} nested />
            </Submenu>
          )}
        </div>
      ))}
    </div>
  );
}

/** Positions a submenu beside its parent item, flipping to the left side when
 *  opening rightward would overflow the window. */
function Submenu({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"right" | "left">("right");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - 4) setSide("left");
    else if (r.left < 4) setSide("right");
  }, []);

  return (
    <div
      ref={ref}
      className={`absolute top-0 -mt-1 ${side === "right" ? "left-full ml-0.5" : "right-full mr-0.5"}`}
    >
      {children}
    </div>
  );
}
