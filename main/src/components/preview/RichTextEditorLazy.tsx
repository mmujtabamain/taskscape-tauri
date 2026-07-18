import type {
  RichTextEditorProps,
  RichTextHandle,
} from '@taskscape/common-ui/RichTextEditor';
import { forwardRef, lazy, Suspense } from 'react';

export type { RichTextHandle };

// tiptap/ProseMirror (~200 KB) is only needed once a note editor is shown, so it
// loads in its own chunk on demand — keeping it out of the main app's startup
// bundle. The `import type` above is erased, so referencing the props/handle
// types here doesn't pull the editor into this module.
const Impl = lazy(() =>
  import('@taskscape/common-ui/RichTextEditor').then((m) => ({
    default: m.RichTextEditor,
  }))
);

export const RichTextEditor = forwardRef<RichTextHandle, RichTextEditorProps>(
  (props, ref) => (
    <Suspense fallback={null}>
      <Impl {...props} ref={ref} />
    </Suspense>
  )
);
RichTextEditor.displayName = 'RichTextEditor';
