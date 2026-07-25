import { Button } from '@taskscape/common-ui/components';
import { useState } from 'react';

export interface ResetEverythingProps {
  onConfirm: () => void;
}

/** Confirms in place rather than in a dialog — the Settings window is a panel
 *  and has no modal layer of its own. */
export function ResetEverything({ onConfirm }: ResetEverythingProps) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming)
    return (
      <Button onClick={() => setConfirming(true)}>Reset all settings…</Button>
    );

  return (
    <span className="gap-space-4 flex items-center">
      <Button
        variant="danger"
        onClick={() => {
          setConfirming(false);
          onConfirm();
        }}
      >
        Reset everything
      </Button>
      <Button onClick={() => setConfirming(false)}>Cancel</Button>
    </span>
  );
}
