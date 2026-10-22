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
      role="dialog"
    >
      <form method="dialog" onSubmit={(event) => { event.preventDefault(); onConfirm(); }}>
        <h2 className="text-xl font-semibold" id={titleId}>{title}: {targetName}</h2>
        <p className="whitespace-pre-wrap break-words" id={descriptionId}>{consequence}</p>
        <button className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" onClick={onCancel} type="button">Cancel</button>
        <button className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" name="decision" type="submit" value="confirm">{confirmLabel}</button>
      </form>
    </dialog>
  );
}

/** React 19 callback-ref cleanup keeps native modal focus behavior inside K12, without changing its API. */
function activateModal(dialog: HTMLDialogElement | null) {
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
