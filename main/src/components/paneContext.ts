import { createContext, useContext } from 'react';

/** The list id of the pane a component renders in. Each TaskPane wraps its
 *  subtree in this provider so rows, footers, and the search controls know their
 *  scope without a prop threaded through — the only per-pane context. */
export const PaneContext = createContext<string | null>(null);

export function usePaneId(): string {
  const id = useContext(PaneContext);
  if (id == null)
    throw new Error('usePaneId must be used within a PaneContext');
  return id;
}
