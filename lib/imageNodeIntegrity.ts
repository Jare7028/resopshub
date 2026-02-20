type ImageNodeSummary = {
  total: number;
  missingSrc: number;
  data: number;
  blob: number;
  file: number;
  http: number;
  relative: number;
  other: number;
  samples: string[];
};

type FillMissingImageSrcFromQueueResult = {
  content: unknown;
  fixedCount: number;
  unresolvedCount: number;
  remainingQueue: string[];
};

type RemoveMissingSrcImageNodesResult = {
  content: unknown;
  removedCount: number;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJsonValue<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function getNodeTypeName(value: Record<string, unknown>) {
  return String(value.type || "")
    .trim()
    .toLowerCase();
}

function isImageLikeNode(value: Record<string, unknown>) {
  return getNodeTypeName(value).includes("image");
}

function getImageSource(value: Record<string, unknown>) {
  if (!isObjectRecord(value.attrs)) {
    return "";
  }
  return String((value.attrs as Record<string, unknown>).src || "").trim();
}

function normalizeQueue(queue: string[]) {
  return queue
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

export function summarizeImageNodes(content: unknown, maxSamples = 3): ImageNodeSummary {
  const summary: ImageNodeSummary = {
    total: 0,
    missingSrc: 0,
    data: 0,
    blob: 0,
    file: 0,
    http: 0,
    relative: 0,
    other: 0,
    samples: [],
  };

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isObjectRecord(node)) {
      return;
    }

    if (isImageLikeNode(node)) {
      const src = getImageSource(node);
      summary.total += 1;

      if (!src) {
        summary.missingSrc += 1;
      } else if (src.startsWith("data:")) {
        summary.data += 1;
      } else if (src.startsWith("blob:")) {
        summary.blob += 1;
      } else if (src.startsWith("file:")) {
        summary.file += 1;
      } else if (/^https?:\/\//i.test(src)) {
        summary.http += 1;
      } else if (src.startsWith("/")) {
        summary.relative += 1;
      } else {
        summary.other += 1;
      }

      if (src && summary.samples.length < maxSamples) {
        summary.samples.push(src.slice(0, 180));
      }
    }

    Object.values(node).forEach(visit);
  };

  visit(content);
  return summary;
}

export function countImageNodesBySrc(content: unknown, expectedSrc: string) {
  const normalizedExpectedSrc = String(expectedSrc || "").trim();
  if (!normalizedExpectedSrc) {
    return 0;
  }

  let count = 0;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isObjectRecord(node)) {
      return;
    }

    if (isImageLikeNode(node) && getImageSource(node) === normalizedExpectedSrc) {
      count += 1;
    }

    Object.values(node).forEach(visit);
  };

  visit(content);
  return count;
}

export function fillMissingImageSrcFromQueue(
  content: unknown,
  queue: string[]
): FillMissingImageSrcFromQueueResult {
  const remainingQueue = normalizeQueue(Array.isArray(queue) ? queue : []);
  const normalizedContent = cloneJsonValue(content);
  let fixedCount = 0;
  let unresolvedCount = 0;

  const nextReplacementSource = () => {
    while (remainingQueue.length) {
      const candidate = String(remainingQueue.shift() || "").trim();
      if (candidate) {
        return candidate;
      }
    }
    return "";
  };

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isObjectRecord(node)) {
      return;
    }

    if (isImageLikeNode(node)) {
      const attrs = isObjectRecord(node.attrs)
        ? (node.attrs as Record<string, unknown>)
        : ({} as Record<string, unknown>);
      if (!isObjectRecord(node.attrs)) {
        node.attrs = attrs;
      }

      const currentSrc = String(attrs.src || "").trim();
      if (!currentSrc) {
        const replacement = nextReplacementSource();
        if (replacement) {
          attrs.src = replacement;
          fixedCount += 1;
        } else {
          unresolvedCount += 1;
        }
      }
    }

    Object.values(node).forEach(visit);
  };

  visit(normalizedContent);

  return {
    content: normalizedContent,
    fixedCount,
    unresolvedCount,
    remainingQueue,
  };
}

export function removeMissingSrcImageNodes(content: unknown): RemoveMissingSrcImageNodesResult {
  const normalizedContent = cloneJsonValue(content);
  const REMOVED = Symbol("removed-image-node");
  let removedCount = 0;

  const clean = (node: unknown): unknown | typeof REMOVED => {
    if (Array.isArray(node)) {
      const nextArray = node
        .map((entry) => clean(entry))
        .filter((entry): entry is unknown => entry !== REMOVED);
      return nextArray;
    }

    if (!isObjectRecord(node)) {
      return node;
    }

    if (isImageLikeNode(node) && !getImageSource(node)) {
      removedCount += 1;
      return REMOVED;
    }

    const nextRecord: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      const cleanedValue = clean(value);
      if (cleanedValue !== REMOVED) {
        nextRecord[key] = cleanedValue;
      }
    }
    return nextRecord;
  };

  const cleaned = clean(normalizedContent);
  return {
    content:
      cleaned === REMOVED
        ? {
            type: "doc",
            content: [{ type: "paragraph" }],
          }
        : cleaned,
    removedCount,
  };
}

export type {
  FillMissingImageSrcFromQueueResult,
  ImageNodeSummary,
  RemoveMissingSrcImageNodesResult,
};
