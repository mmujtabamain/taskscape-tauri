import { invoke } from "@tauri-apps/api/core";

export const api = {
  hideMini: () => invoke<void>("hide_mini"),
  activeListName: () => invoke<string>("active_list_name"),
  openMain: () => invoke<void>("open_main"),
  captureAndAttach: () => invoke<string>("capture_and_attach"),
  submitCapture: (args: { title: string; notes?: string | null; screenshotPath?: string | null }) =>
    invoke<void>("submit_capture", {
      title: args.title,
      notes: args.notes ?? null,
      screenshotPath: args.screenshotPath ?? null,
    }),
};
