"use client";

import { useCallback, useEffect, useRef } from "react";

function toFormSnapshot(form: HTMLFormElement) {
  const entries = Array.from(new FormData(form).entries()).map(([key, value]) => [
    key,
    typeof value === "string" ? value : "",
  ]);
  entries.sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

function isFieldTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLSelectElement) &&
    !(target instanceof HTMLTextAreaElement)
  ) {
    return false;
  }
  if (target.hasAttribute("disabled")) {
    return false;
  }
  if (target instanceof HTMLInputElement) {
    if (target.readOnly) {
      return false;
    }
    const ignoredTypes = new Set(["hidden", "button", "submit", "reset", "file", "checkbox", "radio"]);
    if (ignoredTypes.has(target.type)) {
      return false;
    }
  }
  return true;
}

function isSubmitInteractionTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest(
      'button[type="submit"],input[type="submit"],[data-disable-autosave-blur="true"]'
    )
  );
}

export default function ClientDetailsAutosaveForm({
  action,
  className,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  className?: string;
  children: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const lastSubmittedSnapshotRef = useRef("");
  const skipBlurSubmitRef = useRef(false);

  useEffect(() => {
    if (!formRef.current) {
      return;
    }
    lastSubmittedSnapshotRef.current = toFormSnapshot(formRef.current);
  }, []);

  const handleMouseDownCapture = useCallback((event: React.MouseEvent<HTMLFormElement>) => {
    if (!isSubmitInteractionTarget(event.target)) {
      return;
    }
    skipBlurSubmitRef.current = true;
    window.setTimeout(() => {
      skipBlurSubmitRef.current = false;
    }, 0);
  }, []);

  const handleBlurCapture = useCallback((event: React.FocusEvent<HTMLFormElement>) => {
    const form = formRef.current;
    if (!form || skipBlurSubmitRef.current || !isFieldTarget(event.target)) {
      return;
    }
    if (isSubmitInteractionTarget(event.relatedTarget)) {
      return;
    }
    if (!form.checkValidity()) {
      return;
    }

    const nextSnapshot = toFormSnapshot(form);
    if (nextSnapshot === lastSubmittedSnapshotRef.current) {
      return;
    }
    lastSubmittedSnapshotRef.current = nextSnapshot;
    form.requestSubmit();
  }, []);

  const handleSubmitCapture = useCallback(() => {
    const form = formRef.current;
    if (!form) {
      return;
    }
    lastSubmittedSnapshotRef.current = toFormSnapshot(form);
  }, []);

  return (
    <form
      ref={formRef}
      action={action}
      className={className}
      onMouseDownCapture={handleMouseDownCapture}
      onBlurCapture={handleBlurCapture}
      onSubmitCapture={handleSubmitCapture}
    >
      {children}
    </form>
  );
}
