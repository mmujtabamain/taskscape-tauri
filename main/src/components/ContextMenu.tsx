import { cn } from '@taskscape/common-ui/cn';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { setOverlay } from '../lib/overlays';
import {
  MenuContext,
  type MenuItem,
  type OpenMenu,
} from './contextMenuContext';
import { Icon } from '@taskscape/common-ui/Icon';
import {
  Divider,
  MenuItem as MenuRow,
  Surface,
} from '@taskscape/common-ui/components';

/** App-wide context-menu layer. Wrap the window root once; open menus from
 *  anywhere via useContextMenu().open({ items, x, y, onPick }). */
export function ContextMenuProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);

  useEffect(() => {
    if (!menu) return;
    setOverlay(true);
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      setOverlay(false);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  return (
    <MenuContext.Provider value={{ open: setMenu }}>
      {children}
      {menu &&
        createPortal(
          <div
            className="z-overlay fixed inset-0"
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
          document.body
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
    <Surface
      ref={ref}
      elevation="menu"
      surface={3}
      radius="panel"
      style={nested ? undefined : { left: pos.x, top: pos.y }}
      className={cn(!nested && 'absolute', 'min-w-44 py-space-3')}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <div key={item.id} className="relative">
          {item.dividerAbove && <Divider className="mx-space-5 my-space-3" />}
          <MenuRow
            tone={item.danger ? 'danger' : 'default'}
            disabled={item.disabled}
            onMouseEnter={() => setSubFor(item.submenu ? item.id : null)}
            onClick={() => {
              if (!item.submenu) onPick(item.id);
            }}
            leading={item.icon && <Icon name={item.icon} size={15} />}
            trailing={
              (item.shortcut || item.submenu) && (
                <span className="flex items-center gap-space-4">
                  {item.shortcut && <span className="text-[11px]">{item.shortcut}</span>}
                  {item.submenu && <Icon name="chevron_right" size={14} />}
                </span>
              )
            }
          >
            {item.label}
          </MenuRow>
          {item.submenu && subFor === item.id && (
            <Submenu>
              <MenuPanel
                items={item.submenu}
                x={0}
                y={0}
                onPick={onPick}
                nested
              />
            </Submenu>
          )}
        </div>
      ))}
    </Surface>
  );
}

/** Positions a submenu beside its parent item, flipping to the left side when
 *  opening rightward would overflow the window. */
function Submenu({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<'right' | 'left'>('right');

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - 4) setSide('left');
    else if (r.left < 4) setSide('right');
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        'absolute top-0 -mt-1',
        side === 'right' ? 'left-full ml-0.5' : 'right-full mr-0.5'
      )}
    >
      {children}
    </div>
  );
}
