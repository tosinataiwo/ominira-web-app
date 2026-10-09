import { create } from "zustand";

export type ConfirmOptions = {
  title: string;
  message?: string;
  /** The proceed button's label — "Delete", "End room". Defaults to "Yes". */
  confirmLabel?: string;
  /** Red proceed button, for anything that deletes or ends. */
  danger?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

/** One confirmation at a time — the app's own window.confirm, rendered by
 * app/components/shared/ConfirmDialog.tsx. A newer ask cancels the one
 * still open. */
export const useConfirmStore = create<{ pending: Pending | null; settle: (ok: boolean) => void }>((set, get) => ({
  pending: null,
  settle: (ok) => {
    get().pending?.resolve(ok);
    set({ pending: null });
  },
}));

/** Resolves true on proceed, false on cancel / Escape / backdrop. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  useConfirmStore.getState().pending?.resolve(false);
  return new Promise((resolve) => useConfirmStore.setState({ pending: { ...options, resolve } }));
}

/** Removing a passage's highlight and your notes on it — from the selection
 * menu or the notes panel. */
export const DELETE_ANNOTATION: ConfirmOptions = {
  title: "Delete your highlight and notes here?",
  message: "This can't be undone.",
  confirmLabel: "Delete",
  danger: true,
};
