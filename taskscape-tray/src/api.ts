import { invoke } from "@tauri-apps/api/core";

export const api = {
  hideMini: () => invoke<void>("hide_mini"),
  screenshotDataUrl: (path: string) => invoke<string>("screenshot_data_url", { path }),
  submitCapture: (args: {
    title: string;
    notes?: string | null;
    screenshotPath?: string | null;
    listId?: string | null;
  }) =>
    invoke<void>("submit_capture", {
      title: args.title,
      notes: args.notes ?? null,
      screenshotPath: args.screenshotPath ?? null,
      listId: args.listId ?? null,
    }),
};
