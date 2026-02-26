"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type ShiftPayload = {
  shiftId: string;
  weekId: string;
  rosterEntryId: string | null;
  isOpen: boolean;
  localDate: string;
  startLocalTime: string;
  endLocalTime: string;
  endsNextDay: boolean;
  breakMinutes: number;
  jobCodeId: string | null;
  notes: string | null;
};

type PendingCopyDrag = {
  payload: ShiftPayload;
  card: HTMLElement;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
};

function toEventElementTarget(target: EventTarget | null) {
  if (target instanceof HTMLElement) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

const dragDataType = "application/x-resopshub-schedule-shift";
const dropCellBaseClasses = [
  "ring-2",
  "ring-offset-1",
  "ring-offset-white",
  "shadow-[inset_0_0_0_1px_rgba(14,116,144,0.18)]",
];
const dropCellMoveClasses = ["ring-sky-300", "bg-sky-50/70"];
const dropCellCopyClasses = ["ring-emerald-300", "bg-emerald-50/70"];

function parseShiftPayload(node: HTMLElement | null): ShiftPayload | null {
  if (!node) return null;
  const shiftId = String(node.dataset.scheduleShiftId || "").trim();
  const weekId = String(node.dataset.scheduleWeekId || "").trim();
  const localDate = String(node.dataset.scheduleLocalDate || "").trim();
  const startLocalTime = String(node.dataset.scheduleStartLocalTime || "").trim();
  const endLocalTime = String(node.dataset.scheduleEndLocalTime || "").trim();
  if (!shiftId || !weekId || !localDate || !startLocalTime || !endLocalTime) {
    return null;
  }

  const rosterEntryIdRaw = String(node.dataset.scheduleRosterEntryId || "").trim();
  const jobCodeIdRaw = String(node.dataset.scheduleJobCodeId || "").trim();
  const notesRaw = String(node.dataset.scheduleNotes || "");
  const breakMinutes = Number.parseInt(String(node.dataset.scheduleBreakMinutes || "0"), 10);

  return {
    shiftId,
    weekId,
    rosterEntryId: rosterEntryIdRaw || null,
    isOpen: String(node.dataset.scheduleIsOpen || "").trim() === "true",
    localDate,
    startLocalTime,
    endLocalTime,
    endsNextDay: String(node.dataset.scheduleEndsNextDay || "").trim() === "true",
    breakMinutes: Number.isFinite(breakMinutes) ? breakMinutes : 0,
    jobCodeId: jobCodeIdRaw || null,
    notes: notesRaw.trim() ? notesRaw : null,
  };
}

function ScheduleGridDndClient() {
  const router = useRouter();
  const [toastMessage, setToastMessage] = useState("");
  const [toastTone, setToastTone] = useState<"info" | "error" | "success">("info");
  const [isApplying, setIsApplying] = useState(false);
  const previewRef = useRef<HTMLElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const draggingPayloadRef = useRef<ShiftPayload | null>(null);
  const draggingCardRef = useRef<HTMLElement | null>(null);
  const activeDropCellRef = useRef<HTMLElement | null>(null);
  const shiftHeldRef = useRef(false);
  const pointerDragModeRef = useRef<"move" | "copy">("move");
  const pendingCopyDragRef = useRef<PendingCopyDrag | null>(null);
  const manualCopyDraggingRef = useRef(false);
  const dragModeRef = useRef<"move" | "copy">("move");
  const requestInFlightRef = useRef(false);

  useEffect(() => {
    const clearDropCellStyles = () => {
      const cell = activeDropCellRef.current;
      if (!cell) return;
      cell.classList.remove(...dropCellBaseClasses, ...dropCellMoveClasses, ...dropCellCopyClasses);
      activeDropCellRef.current = null;
    };

    const clearDragPreview = () => {
      if (previewRef.current) {
        previewRef.current.remove();
        previewRef.current = null;
      }
    };

    const clearCardDraggingStyles = () => {
      const node = draggingCardRef.current;
      if (!node) return;
      node.classList.remove("opacity-45", "scale-[0.98]", "shadow-none", "cursor-grabbing");
      draggingCardRef.current = null;
    };

    const resetDragState = () => {
      clearDropCellStyles();
      clearCardDraggingStyles();
      clearDragPreview();
      draggingPayloadRef.current = null;
      pendingCopyDragRef.current = null;
      manualCopyDraggingRef.current = false;
      dragModeRef.current = "move";
      pointerDragModeRef.current = "move";
      shiftHeldRef.current = false;
    };

    const scheduleToastClear = () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setToastMessage("");
      }, 2200);
    };

    const setDropCell = (cell: HTMLElement, mode: "move" | "copy") => {
      if (activeDropCellRef.current !== cell) {
        clearDropCellStyles();
        activeDropCellRef.current = cell;
      }
      cell.classList.add(...dropCellBaseClasses);
      if (mode === "copy") {
        cell.classList.add(...dropCellCopyClasses);
        cell.classList.remove(...dropCellMoveClasses);
      } else {
        cell.classList.add(...dropCellMoveClasses);
        cell.classList.remove(...dropCellCopyClasses);
      }
    };

    const resolveDragMode = (event?: DragEvent) => {
      const shiftPressed =
        Boolean(event?.shiftKey) ||
        shiftHeldRef.current ||
        pointerDragModeRef.current === "copy";
      return shiftPressed ? "copy" : "move";
    };

    const createDragPreviewFromCard = (sourceCard: HTMLElement) => {
      if (typeof document === "undefined") return null;
      clearDragPreview();
      const sourceRect = sourceCard.getBoundingClientRect();
      if (!sourceRect.width || !sourceRect.height) return null;
      const preview = sourceCard.cloneNode(true) as HTMLElement;
      preview.style.position = "fixed";
      preview.style.top = "-10000px";
      preview.style.left = "-10000px";
      preview.style.width = `${sourceRect.width}px`;
      preview.style.maxWidth = `${sourceRect.width}px`;
      preview.style.pointerEvents = "none";
      preview.style.margin = "0";
      preview.style.opacity = "0.96";
      preview.style.transform = "rotate(1.15deg)";
      preview.style.boxShadow = "0 18px 40px rgba(15, 23, 42, 0.24)";
      preview.style.borderRadius = "12px";
      preview.style.zIndex = "2147483647";
      document.body.appendChild(preview);
      previewRef.current = preview;
      return preview;
    };

    const movePreviewToPointer = (clientX: number, clientY: number, offsetX: number, offsetY: number) => {
      const preview = previewRef.current;
      if (!preview) return;
      preview.style.left = `${Math.round(clientX - offsetX)}px`;
      preview.style.top = `${Math.round(clientY - offsetY)}px`;
    };

    const setDragPreviewFromCard = (event: DragEvent, sourceCard: HTMLElement) => {
      if (!event.dataTransfer) return;
      const preview = createDragPreviewFromCard(sourceCard);
      if (!preview) return;
      event.dataTransfer.setDragImage(preview, 24, 20);
    };

    const onDragStart = (event: DragEvent) => {
      if (requestInFlightRef.current || !event.dataTransfer) return;
      const targetNode = toEventElementTarget(event.target);
      const card = targetNode?.closest<HTMLElement>('[data-schedule-shift-card="true"]');
      if (!card) return;
      const interactiveTarget = targetNode?.closest<HTMLElement>(
        "button,a,input,select,textarea,label,[data-schedule-no-drag='true']"
      );
      if (interactiveTarget && interactiveTarget !== card) {
        return;
      }
      const payload = parseShiftPayload(card);
      if (!payload) return;

      draggingPayloadRef.current = payload;
      draggingCardRef.current = card;
      dragModeRef.current = resolveDragMode(event);

      event.dataTransfer.effectAllowed = "copyMove";
      event.dataTransfer.setData(dragDataType, JSON.stringify(payload));
      event.dataTransfer.setData("text/plain", payload.shiftId);
      event.dataTransfer.dropEffect = dragModeRef.current === "copy" ? "copy" : "move";
      setDragPreviewFromCard(event, card);

      card.classList.add("opacity-45", "scale-[0.98]", "shadow-none", "cursor-grabbing");
    };

    const onDragOver = (event: DragEvent) => {
      const payload = draggingPayloadRef.current;
      if (!payload) return;
      const targetNode = toEventElementTarget(event.target);
      const cell = targetNode?.closest<HTMLElement>('[data-schedule-drop-cell="true"]');
      if (!cell) return;
      event.preventDefault();

      const mode = resolveDragMode(event);
      dragModeRef.current = mode;
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = mode === "copy" ? "copy" : "move";
      }
      setDropCell(cell, mode);
    };

    const applyDropToCell = async (
      payload: ShiftPayload,
      cell: HTMLElement,
      mode: "move" | "copy"
    ) => {
      const targetLocalDate = String(cell.dataset.scheduleDropDay || "").trim();
      const targetRosterEntryIdRaw = String(cell.dataset.scheduleDropRosterEntryId || "").trim();
      const targetIsOpen = String(cell.dataset.scheduleDropIsOpen || "").trim() === "true";
      const targetRosterEntryId = targetIsOpen ? null : targetRosterEntryIdRaw || null;

      if (!targetLocalDate) {
        return;
      }

      const noChangeMove =
        mode === "move" &&
        payload.localDate === targetLocalDate &&
        payload.isOpen === targetIsOpen &&
        (targetIsOpen || payload.rosterEntryId === targetRosterEntryId);
      if (noChangeMove) {
        return;
      }

      requestInFlightRef.current = true;
      setIsApplying(true);
      setToastTone("info");
      setToastMessage(mode === "copy" ? "Copying shift..." : "Moving shift...");

      try {
        const res = await fetch("/api/schedules/shifts/reposition", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shift_id: payload.shiftId,
            target_local_date: targetLocalDate,
            mode,
            target_roster_entry_id: targetRosterEntryId,
            target_is_open: targetIsOpen,
          }),
        });

        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(json.error || "Unable to update shift");
        }

        setToastTone("success");
        setToastMessage(mode === "copy" ? "Shift copied" : "Shift moved");
        scheduleToastClear();
        router.refresh();
      } catch (err) {
        setToastTone("error");
        setToastMessage(err instanceof Error ? err.message : "Unable to update shift");
        scheduleToastClear();
      } finally {
        requestInFlightRef.current = false;
        setIsApplying(false);
      }
    };

    const onDrop = async (event: DragEvent) => {
      const payload = draggingPayloadRef.current;
      if (!payload || requestInFlightRef.current) return;
      const targetNode = toEventElementTarget(event.target);
      const cell = targetNode?.closest<HTMLElement>('[data-schedule-drop-cell="true"]');
      if (!cell) return;
      event.preventDefault();

      const mode = resolveDragMode(event);
      dragModeRef.current = mode;

      try {
        await applyDropToCell(payload, cell, mode);
      } finally {
        resetDragState();
      }
    };

    const onDragEnd = () => {
      resetDragState();
    };

    const onPointerDownCapture = (event: PointerEvent) => {
      if (event.button !== 0 || requestInFlightRef.current) return;
      const targetNode = toEventElementTarget(event.target);
      const card = targetNode?.closest<HTMLElement>('[data-schedule-shift-card="true"]');
      if (!card) return;
      const interactiveTarget = targetNode?.closest<HTMLElement>(
        "button,a,input,select,textarea,label,[data-schedule-no-drag='true']"
      );
      if (interactiveTarget && interactiveTarget !== card) return;
      const payload = parseShiftPayload(card);
      if (!payload) return;

      pointerDragModeRef.current = event.shiftKey ? "copy" : "move";
      if (event.shiftKey) {
        shiftHeldRef.current = true;
        const cardRect = card.getBoundingClientRect();
        pendingCopyDragRef.current = {
          payload,
          card,
          startX: event.clientX,
          startY: event.clientY,
          offsetX: Math.max(0, Math.min(cardRect.width - 1, event.clientX - cardRect.left)),
          offsetY: Math.max(0, Math.min(cardRect.height - 1, event.clientY - cardRect.top)),
        };
        event.preventDefault();
      } else {
        pendingCopyDragRef.current = null;
        manualCopyDraggingRef.current = false;
      }
    };

    const onPointerMoveCapture = (event: PointerEvent) => {
      const pending = pendingCopyDragRef.current;
      if (!pending || requestInFlightRef.current) return;
      const movedDistance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
      if (!manualCopyDraggingRef.current && movedDistance < 4) return;

      if (!manualCopyDraggingRef.current) {
        manualCopyDraggingRef.current = true;
        draggingPayloadRef.current = pending.payload;
        draggingCardRef.current = pending.card;
        dragModeRef.current = "copy";
        createDragPreviewFromCard(pending.card);
        pending.card.classList.add("opacity-45", "scale-[0.98]", "shadow-none", "cursor-grabbing");
      }

      event.preventDefault();
      movePreviewToPointer(event.clientX, event.clientY, pending.offsetX, pending.offsetY);
      const elementAtPoint = document.elementFromPoint(event.clientX, event.clientY);
      const dropTargetNode = toEventElementTarget(elementAtPoint);
      const dropCell = dropTargetNode?.closest<HTMLElement>('[data-schedule-drop-cell="true"]');
      if (dropCell) {
        setDropCell(dropCell, "copy");
      } else {
        clearDropCellStyles();
      }
    };

    const onPointerUpCapture = (event: PointerEvent) => {
      const pending = pendingCopyDragRef.current;
      if (!pending) return;
      const shouldDrop = manualCopyDraggingRef.current;
      const payload = pending.payload;
      pendingCopyDragRef.current = null;

      if (!shouldDrop || requestInFlightRef.current) {
        resetDragState();
        return;
      }

      event.preventDefault();
      const elementAtPoint = document.elementFromPoint(event.clientX, event.clientY);
      const dropTargetNode = toEventElementTarget(elementAtPoint);
      const dropCell = dropTargetNode?.closest<HTMLElement>('[data-schedule-drop-cell="true"]');
      if (!dropCell) {
        resetDragState();
        return;
      }

      void (async () => {
        try {
          await applyDropToCell(payload, dropCell, "copy");
        } finally {
          resetDragState();
        }
      })();
    };

    const onSelectStartCapture = (event: Event) => {
      const targetNode = toEventElementTarget(event.target);
      const card = targetNode?.closest<HTMLElement>('[data-schedule-shift-card="true"]');
      if (!card) return;
      if (manualCopyDraggingRef.current || pendingCopyDragRef.current) {
        event.preventDefault();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        shiftHeldRef.current = true;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        shiftHeldRef.current = false;
      }
    };

    const onWindowBlur = () => {
      shiftHeldRef.current = false;
    };

    document.addEventListener("dragstart", onDragStart, true);
    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("dragend", onDragEnd, true);
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    document.addEventListener("pointermove", onPointerMoveCapture, true);
    document.addEventListener("pointerup", onPointerUpCapture, true);
    document.addEventListener("selectstart", onSelectStartCapture, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      document.removeEventListener("dragstart", onDragStart, true);
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("dragend", onDragEnd, true);
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
      document.removeEventListener("pointermove", onPointerMoveCapture, true);
      document.removeEventListener("pointerup", onPointerUpCapture, true);
      document.removeEventListener("selectstart", onSelectStartCapture, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      resetDragState();
    };
  }, [router]);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[90]">
      {isApplying || toastMessage ? (
        <div
          className={`rounded-xl border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur ${
            toastTone === "error"
              ? "border-red-200 bg-red-50/95 text-red-700"
              : toastTone === "success"
                ? "border-emerald-200 bg-emerald-50/95 text-emerald-700"
                : "border-sky-200 bg-sky-50/95 text-sky-700"
          }`}
        >
          {isApplying ? "Updating schedule..." : toastMessage}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-[11px] font-medium text-slate-600 shadow-sm backdrop-blur">
          Drag shift to move. Hold Shift while dragging to copy.
        </div>
      )}
    </div>
  );
}

export default ScheduleGridDndClient;
