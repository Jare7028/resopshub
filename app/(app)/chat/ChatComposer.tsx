"use client";

import { useMemo, useState } from "react";

export type LinkEntityType =
  | "task"
  | "project"
  | "feature_suggestion"
  | "note"
  | "client";

type LinkOption = {
  id: string;
  label: string;
};

type AttachedLink = {
  entityType: LinkEntityType;
  entityId: string;
  label: string;
};

const typeLabel: Record<LinkEntityType, string> = {
  task: "Task",
  project: "Project",
  feature_suggestion: "Feature Suggestion",
  note: "Note",
  client: "Client",
};

export default function ChatComposer(props: {
  conversationId: string;
  submitAction: (formData: FormData) => void | Promise<void>;
  linkOptions: Record<LinkEntityType, LinkOption[]>;
}) {
  const { conversationId, submitAction, linkOptions } = props;
  const [body, setBody] = useState("");
  const [isSlashOpen, setIsSlashOpen] = useState(false);
  const [entityType, setEntityType] = useState<LinkEntityType>("task");
  const [query, setQuery] = useState("");
  const [entityId, setEntityId] = useState("");
  const [attachedLinks, setAttachedLinks] = useState<AttachedLink[]>([]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const options = linkOptions[entityType] || [];
    if (!normalizedQuery) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
  }, [entityType, linkOptions, query]);

  const selectedOption = filteredOptions.find((option) => option.id === entityId) || null;

  const attachSelected = () => {
    if (!selectedOption) return;
    const nextLink: AttachedLink = {
      entityType,
      entityId: selectedOption.id,
      label: selectedOption.label,
    };
    setAttachedLinks((prev) => {
      if (
        prev.some(
          (item) =>
            item.entityType === nextLink.entityType && item.entityId === nextLink.entityId
        )
      ) {
        return prev;
      }
      return [...prev, nextLink];
    });
    setEntityId("");
    setQuery("");
  };

  return (
    <form action={submitAction} className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
      <input type="hidden" name="conversation_id" value={conversationId} />
      <input type="hidden" name="message_body" value={body} />
      {attachedLinks.map((link, index) => (
        <div key={`${link.entityType}:${link.entityId}:${index}`}>
          <input type="hidden" name="link_entity_type" value={link.entityType} />
          <input type="hidden" name="link_entity_id" value={link.entityId} />
          <input type="hidden" name="link_label" value={link.label} />
        </div>
      ))}

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "/") {
            setIsSlashOpen(true);
          }
        }}
        rows={3}
        placeholder="Message... Type / to attach Task, Project, Note, Client, or Feature Suggestion."
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />

      {attachedLinks.length ? (
        <div className="flex flex-wrap gap-2">
          {attachedLinks.map((link) => (
            <button
              key={`${link.entityType}:${link.entityId}`}
              type="button"
              onClick={() =>
                setAttachedLinks((prev) =>
                  prev.filter(
                    (item) =>
                      !(
                        item.entityType === link.entityType && item.entityId === link.entityId
                      )
                  )
                )
              }
              className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs text-slate-700"
              title="Remove link"
            >
              {typeLabel[link.entityType]}: {link.label} x
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setIsSlashOpen((prev) => !prev)}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          / Link Item
        </button>
        <button
          type="submit"
          className="rounded-md btn-primary px-3 py-1.5 text-xs font-semibold text-white"
        >
          Send
        </button>
      </div>

      {isSlashOpen ? (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-600">
            Slash link: choose a type, find an item, then attach it to this message.
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(typeLabel) as LinkEntityType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setEntityType(type);
                  setEntityId("");
                  setQuery("");
                }}
                className={`rounded-md px-2 py-1 text-xs font-medium ${
                  entityType === type
                    ? "tab-active"
                    : "border border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                /{typeLabel[type].toLowerCase().replace(/\s+/g, "-")}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${typeLabel[entityType]}...`}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={entityId}
            onChange={(event) => setEntityId(event.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Select {typeLabel[entityType]}</option>
            {filteredOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={attachSelected}
            disabled={!entityId}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Attach link
          </button>
        </div>
      ) : null}
    </form>
  );
}

