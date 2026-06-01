"use client";

import { useFormStatus } from "react-dom";

export default function CreateTaskSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="w-full rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-70 sm:w-auto"
    >
      {pending ? "Creating..." : "Create task"}
    </button>
  );
}
