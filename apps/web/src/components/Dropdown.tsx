import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * A button that opens a menu underneath it.
 *
 * Click-away and Escape close it, and Escape hands focus back to the button.
 * Opened from the keyboard, focus lands on the first item and the arrow keys
 * walk the list; opened with a mouse it doesn't, because a focus ring
 * appearing under the pointer reads as a hover state that won't go away.
 *
 * The panel is absolutely positioned, so it assumes no ancestor between it and
 * the page clips overflow — true everywhere it's used. The quick-actions panel
 * on library cards is the counter-example, and uses `position: fixed` for
 * exactly that reason.
 */
export function Dropdown({
  label,
  buttonClassName,
  align = "left",
  widthClassName = "w-64",
  disabled = false,
  title,
  children,
}: {
  label: ReactNode;
  buttonClassName: string;
  /** which edge of the button the panel lines up with */
  align?: "left" | "right";
  widthClassName?: string;
  disabled?: boolean;
  title?: string;
  /** the menu's contents; call `close` after an item acts */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fromKeyboard = useRef(false);

  useEffect(() => {
    if (!open) return;
    function onDown(ev: MouseEvent) {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    if (fromKeyboard.current) items(panelRef.current)[0]?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close() {
    setOpen(false);
  }

  function onKeyDown(ev: KeyboardEvent<HTMLDivElement>) {
    if (ev.key === "Escape" && open) {
      ev.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (!open || (ev.key !== "ArrowDown" && ev.key !== "ArrowUp")) return;
    ev.preventDefault();
    const list = items(panelRef.current);
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = ev.key === "ArrowDown" ? at + 1 : at - 1;
    list[(next + list.length) % list.length]?.focus();
  }

  return (
    <div className="relative inline-block" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={title}
        onClick={(ev) => {
          // a click with no pointer position is Enter or Space on the button
          fromKeyboard.current = ev.detail === 0;
          setOpen(!open);
        }}
        className={buttonClassName}
      >
        {label}
        <span aria-hidden className="ml-1.5 text-[10px] opacity-70">
          ▾
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          className={`absolute top-full z-30 mt-1.5 max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          } ${widthClassName}`}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** One choice in a `Dropdown`, with an optional line of explanation under it. */
export function DropdownItem({
  onSelect,
  hint,
  disabled = false,
  children,
}: {
  onSelect: () => void;
  hint?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 outline-none hover:bg-zinc-800 focus-visible:bg-zinc-800 disabled:opacity-40"
    >
      {children}
      {hint && <span className="mt-0.5 block text-xs text-zinc-500">{hint}</span>}
    </button>
  );
}

/** A small heading between groups of items. */
export function DropdownLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
      {children}
    </p>
  );
}

function items(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
}
