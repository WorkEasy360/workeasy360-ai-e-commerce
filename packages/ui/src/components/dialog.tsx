"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CloseIcon } from "./icons";

/**
 * A modal on the native <dialog> element: focus is trapped and restored by
 * the browser, Escape closes it, and the page behind is inert. `side` turns
 * it into a drawer on the right.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  side,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  side?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const className = ["c-dialog", wide ? "c-dialog-wide" : "", side ? "c-drawer" : ""].filter(Boolean).join(" ");
  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <div className="c-dialog-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="c-btn c-btn-ghost c-btn-icon" aria-label="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
          <div className="c-dialog-body">{children}</div>
          {footer && <div className="c-dialog-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

/**
 * Free-form tags: type and press Enter or comma to add, Backspace on an
 * empty field to remove the last one.
 */
export function TagInput({
  id,
  value,
  onChange,
  placeholder = "Add a tag",
  max = 50,
  lowercase = true,
}: {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
  lowercase?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const parts = raw
      .split(",")
      .map((t) => (lowercase ? t.trim().toLowerCase() : t.trim()))
      .filter(Boolean);
    const next = [...value];
    for (const part of parts) if (!next.some((t) => t.toLowerCase() === part.toLowerCase()) && next.length < max) next.push(part.slice(0, 40));
    onChange(next);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (draft.trim()) add(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="c-tags">
      {value.map((tag) => (
        <span key={tag} className="c-tag">
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>
            <CloseIcon size={12} />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        placeholder={value.length === 0 ? placeholder : ""}
        onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && add(draft)}
      />
    </div>
  );
}
