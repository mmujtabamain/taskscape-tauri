import { createContext, useContext } from 'react';

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

export interface OpenMenu {
  items: MenuItem[];
  x: number;
  y: number;
  onPick: (id: string) => void;
}

const MenuContext = createContext<{ open: (m: OpenMenu) => void }>({
  open: () => {},
});

export { MenuContext };

export function useContextMenu() {
  return useContext(MenuContext);
}
