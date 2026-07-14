import { useEvent } from '@taskscape/common-ui/useEvent';
import { useEffect, useState } from 'react';
import { api, type CaptureTarget } from '../api';

/** The project / list a capture will land in (shown in the footer). Loaded on
 *  mount; `refresh` is called again on every reveal. */
export function useCaptureTarget(): {
  target: CaptureTarget | null;
  refresh: () => void;
} {
  const [target, setTarget] = useState<CaptureTarget | null>(null);
  const refresh = useEvent(() => {
    api
      .captureTarget()
      .then(setTarget)
      .catch(() => {});
  });

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { target, refresh };
}
