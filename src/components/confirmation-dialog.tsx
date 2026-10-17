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
      open
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-modal="true"
      className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      role="dialog"
    >
      <form method="dialog" onSubmit={(event) => { event.preventDefault(); onConfirm(); }}>
        <h2 id={titleId}>{title}: {targetName}</h2>
        <p id={descriptionId}>{consequence}</p>
        <button className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" onClick={onCancel} type="button">Cancel</button>
        <button className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" name="decision" type="submit" value="confirm">{confirmLabel}</button>
      </form>
    </dialog>
  );
}
