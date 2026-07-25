import {
  IconButton,
  Label,
  Surface,
  ToolbarButton,
} from '@taskscape/common-ui/components';
import { useToastStore } from '../stores/toastStore';

/** The single transient toast (bottom-center), e.g. an undoable delete. */
export function Toast() {
  const toast = useToastStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="z-overlay pointer-events-none fixed inset-x-0 bottom-5 flex justify-center">
      <Surface
        elevation="lift"
        surface={3}
        radius="control"
        className="animate-rise gap-space-5 py-space-5 pr-space-5 pl-space-7 pointer-events-auto flex items-center"
      >
        <Label tone="primary" weight="medium" className="text-[13px]">
          {toast.message}
        </Label>
        {toast.action && (
          <ToolbarButton
            icon="undo"
            iconSize={14}
            variant="accent"
            onClick={() => {
              toast.action?.();
              useToastStore.getState().dismiss();
            }}
          >
            {toast.actionLabel ?? 'Undo'}
          </ToolbarButton>
        )}
        <IconButton
          icon="close"
          size="lg"
          iconSize={14}
          onClick={() => useToastStore.getState().dismiss()}
          title="Dismiss"
        />
      </Surface>
    </div>
  );
}
