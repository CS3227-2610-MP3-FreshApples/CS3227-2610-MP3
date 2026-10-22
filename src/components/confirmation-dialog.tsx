"use client";

type ConfirmDialogProps = Readonly<{
  confirmLabel: string;
  consequence: string;
  dialogId?: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  targetName: string;
  title: string;
}>;

export function ConfirmDialog({
  confirmLabel,
  consequence,
  dialogId = "confirm-dialog",
  onCancel,
  onConfirm,
  open,
  targetName,
  title,
}: ConfirmDialogProps) {
  if (!open) return null;

  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  return (
    <dialog
      ref={activateModal}
      open
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-modal="true"
      className="fixed inset-0 m-auto max-h-[85vh] w-[min(32rem,calc(100%-2rem))] overflow-y-auto rounded-lg border border-slate-300 bg-white p-6 text-slate-950 shadow-xl backdrop:bg-slate-950/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 [&_form]:space-y-4"
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      onKeyDown={containModalFocus}
      role="dialog"
    >
      <form method="dialog" onSubmit={(event) => { event.preventDefault(); onConfirm(); }}>
        <h2 className="break-words text-xl font-semibold" id={titleId}>{title}: {targetName}</h2>
        <p className="whitespace-pre-wrap break-words leading-6 text-slate-600" id={descriptionId}>{consequence}</p>
        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
          <button className="min-h-11 rounded-md border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800 transition-colors enabled:hover:border-slate-400 enabled:hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" onClick={onCancel} type="button">Cancel</button>
          <button className="min-h-11 rounded-md bg-blue-700 px-4 py-2 font-semibold text-white transition-colors enabled:hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" name="decision" type="submit" value="confirm">{confirmLabel}</button>
        </div>
      </form>
    </dialog>
  );
}

/** Keep Tab cycling through enabled controls rather than leaving the modal for browser chrome. */
export function containModalFocus(event: React.KeyboardEvent<HTMLDialogElement>): void {
  if (event.key !== "Tab") return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
  )).filter((control) => control.getClientRects().length > 0 && control.getAttribute("aria-disabled") !== "true");
  const first = controls[0];
  const last = controls.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** React 19 callback-ref cleanup keeps native modal focus behavior inside K12, without changing its API. */
export function activateModal(dialog: HTMLDialogElement | null) {
  if (dialog === null) return;
  const previousFocus = document.activeElement;
  // Preserve the server-rendered open markup, then promote it to a native modal after mounting.
  dialog.close();
  dialog.showModal();
  return () => {
    dialog.close();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };
}
