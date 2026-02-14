"use client";

import type { ChangeEvent } from "react";
import { useRouter } from "next/navigation";

type TemplateOption = {
  id: string;
  name: string;
};

type ProjectTemplateAutoSelectProps = {
  templates: TemplateOption[];
  selectedTemplateId?: string;
  preservedQuery?: string;
  disabled?: boolean;
  className?: string;
};

export default function ProjectTemplateAutoSelect({
  templates,
  selectedTemplateId = "",
  preservedQuery = "",
  disabled = false,
  className,
}: ProjectTemplateAutoSelectProps) {
  const router = useRouter();

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = String(event.target.value || "").trim();
    const sp = new URLSearchParams(preservedQuery);
    sp.set("tab", "add");
    sp.set("create_mode", "template");
    if (value) {
      sp.set("template_project_id", value);
    } else {
      sp.delete("template_project_id");
    }
    const qs = sp.toString();
    router.push(qs ? `/projects?${qs}` : "/projects?tab=add&create_mode=template");
  };

  return (
    <select
      value={selectedTemplateId}
      onChange={handleChange}
      disabled={disabled}
      className={className}
      aria-label="Choose project template"
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

