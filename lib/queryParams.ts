export function parseCsvParam(value: unknown): string[] {
  const parts: string[] = [];

  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        if (part !== "all") {
          parts.push(part);
        }
      });
  };

  if (Array.isArray(value)) {
    value.forEach(push);
  } else {
    push(value);
  }

  return Array.from(new Set(parts));
}

export function setCsvParam(
  params: URLSearchParams,
  key: string,
  values: string[]
) {
  const cleaned = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  if (!cleaned.length) {
    params.delete(key);
    return;
  }
  params.set(key, cleaned.join(","));
}

