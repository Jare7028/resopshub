"use client";

import { useEffect, useState } from "react";
import MentionTextarea from "@/app/(app)/_components/MentionTextarea";

export default function MentionTextareaField({
  name,
  defaultValue = "",
  rows = 3,
  placeholder,
  className,
  required,
  disabled,
}: {
  name: string;
  defaultValue?: string;
  rows?: number;
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(String(defaultValue || ""));

  useEffect(() => {
    setValue(String(defaultValue || ""));
  }, [defaultValue]);

  return (
    <MentionTextarea
      name={name}
      rows={rows}
      placeholder={placeholder}
      value={value}
      onValueChange={setValue}
      className={className}
      required={required}
      disabled={disabled}
    />
  );
}
