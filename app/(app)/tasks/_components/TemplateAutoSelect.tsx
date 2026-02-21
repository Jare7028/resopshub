"use client";

import type { ChangeEvent } from "react";
import { useRouter } from "next/navigation";

type TemplateOption = {
  id: string;
  name: string;
};

type TemplateAutoSelectProps = {
  templates: TemplateOption[];
  selectedTemplateId?: string;
  preservedQuery?: string;
  disabled?: boolean;
  className?: string;
  basePath?: string;
};

export default function TemplateAutoSelect({
  templates,
  selectedTemplateId = "",
  preservedQuery = "",
  disabled = false,
  className,
  basePath = "/tasks",
}: TemplateAutoSelectProps) {
  const router = useRouter();

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = String(event.target.value || "").trim();
    const sp = new URLSearchParams(preservedQuery);
    sp.set("tab", "add");
    sp.set("create_mode", "template");
    if (value) {
      sp.set("template_task_id", value);
    } else {
      sp.delete("template_task_id");
    }
    const qs = sp.toString();
    router.push(qs ? `${basePath}?${qs}` : `${basePath}?tab=add&create_mode=template`);
  };

  return (
    <select
      value={selectedTemplateId}
      onChange={handleChange}
      disabled={disabled}
      className={className}
      aria-label="Choose template"
    >
      <option value="">Select a template</option>
      {templates.map((template) => (
        <option key={template.id} value={template.id}>
          {template.name}
        </option>
      ))}
    </select>
  );
}
