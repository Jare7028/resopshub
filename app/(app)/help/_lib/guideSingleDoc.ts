import { extractPlainText } from "../../../../lib/tiptapText";
import { normalizeHelpGuideDownloadHref } from "../../../../lib/helpGuideDownloads";
import type { HelpGuide, HelpGuideSection, HelpGuideSectionLink } from "../_data/guides";

type TiptapNode = Record<string, unknown>;
type TiptapDoc = {
  type: "doc";
  content: TiptapNode[];
};

const DOWNLOAD_LINKS_HEADING = "Download links";

const METADATA_LABELS = {
  title: "Title",
  summary: "Summary",
  audience: "Audience",
  estimatedTime: "Estimated time",
} as const;

type MetadataKey = keyof typeof METADATA_LABELS;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeText(value: unknown, maxLength = 4000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength);
}

function normalizeSectionId(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createParagraphNode(text = ""): TiptapNode {
  if (!text) {
    return { type: "paragraph" };
  }
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

function createHeadingNode(text: string): TiptapNode {
  return {
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text }],
  };
}

function normalizeHref(value: unknown) {
  const href = normalizeText(value, 2048);
  if (!href) {
    return "";
  }
  if (/^(https?:\/\/|\/)/i.test(href)) {
    return normalizeHelpGuideDownloadHref(href);
  }
  return "";
}

function normalizeSectionLinks(value: unknown): HelpGuideSectionLink[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const links: HelpGuideSectionLink[] = [];
  value.forEach((entry) => {
    if (!isObjectRecord(entry)) return;
    const href = normalizeHref(entry.href);
    if (!href) return;
    const label = normalizeText(entry.label, 240) || href;
    const key = `${label}::${href}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ label, href });
  });
  return links;
}

function createDownloadLinksList(links: HelpGuideSectionLink[]): TiptapNode {
  return {
    type: "bulletList",
    content: links.map((link) => ({
      type: "listItem",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: link.label,
              marks: [{ type: "link", attrs: { href: link.href } }],
            },
          ],
        },
      ],
    })),
  };
}

function normalizeDoc(value: unknown): TiptapDoc {
  if (isObjectRecord(value) && value.type === "doc" && Array.isArray(value.content)) {
    return cloneJson(value) as TiptapDoc;
  }
  return {
    type: "doc",
    content: [createParagraphNode()],
  };
}

function getHeadingLevel(node: TiptapNode) {
  if (node.type !== "heading") {
    return 0;
  }
  const attrs = isObjectRecord(node.attrs) ? node.attrs : null;
  const levelRaw = attrs?.level;
  const level = typeof levelRaw === "number" ? levelRaw : Number(levelRaw || 0);
  if (!Number.isFinite(level)) {
    return 0;
  }
  return level;
}

function getNodeText(node: TiptapNode) {
  return extractPlainText(node).replace(/\s+/g, " ").trim();
}

function parseLegacyLinkText(value: unknown): HelpGuideSectionLink | null {
  const normalized = normalizeText(value, 2048);
  if (!normalized) {
    return null;
  }

  const labelHrefMatch = normalized.match(/^(.+?)\s*:\s*(https?:\/\/\S+|\/\S+)$/i);
  if (labelHrefMatch) {
    const href = normalizeHref(labelHrefMatch[2]);
    if (!href) return null;
    const label = normalizeText(labelHrefMatch[1], 240) || href;
    return { label, href };
  }

  const hrefOnly = normalizeHref(normalized);
  if (!hrefOnly) {
    return null;
  }
  return { label: hrefOnly, href: hrefOnly };
}

function parseLinkFromParagraphNode(node: TiptapNode): HelpGuideSectionLink | null {
  if (!isObjectRecord(node) || node.type !== "paragraph" || !Array.isArray(node.content)) {
    return null;
  }

  let hrefFromMark = "";
  const labelParts: string[] = [];
  (node.content as unknown[]).forEach((item) => {
    if (!isObjectRecord(item) || item.type !== "text") return;
    const labelText = normalizeText(item.text, 240);
    if (labelText) {
      labelParts.push(labelText);
    }

    if (!Array.isArray(item.marks)) return;
    item.marks.forEach((mark) => {
      if (hrefFromMark) return;
      if (!isObjectRecord(mark) || mark.type !== "link") return;
      const attrs = isObjectRecord(mark.attrs) ? mark.attrs : null;
      const href = normalizeHref(attrs?.href);
      if (href) {
        hrefFromMark = href;
      }
    });
  });

  if (hrefFromMark) {
    const label = normalizeText(labelParts.join(" "), 240) || hrefFromMark;
    return { label, href: hrefFromMark };
  }

  return parseLegacyLinkText(getNodeText(node));
}

function parseLinksFromBulletList(node: TiptapNode): HelpGuideSectionLink[] {
  if (!isObjectRecord(node) || node.type !== "bulletList" || !Array.isArray(node.content)) {
    return [];
  }

  const links: HelpGuideSectionLink[] = [];
  (node.content as unknown[]).forEach((listItem) => {
    if (!isObjectRecord(listItem)) return;

    if (listItem.type === "listItem" && Array.isArray(listItem.content)) {
      const paragraph = (listItem.content as unknown[]).find(
        (item) => isObjectRecord(item) && item.type === "paragraph"
      ) as TiptapNode | undefined;
      if (paragraph) {
        const parsed = parseLinkFromParagraphNode(paragraph);
        if (parsed) {
          links.push(parsed);
          return;
        }
      }
    }

    const fallbackParsed = parseLegacyLinkText(getNodeText(listItem as TiptapNode));
    if (fallbackParsed) {
      links.push(fallbackParsed);
    }
  });

  return normalizeSectionLinks(links);
}

function isDownloadLinksHeading(node: TiptapNode) {
  if (!isObjectRecord(node) || node.type !== "paragraph") {
    return false;
  }
  return getNodeText(node).toLowerCase() === DOWNLOAD_LINKS_HEADING.toLowerCase();
}

function extractDownloadLinksBlock(nodes: TiptapNode[]) {
  const cleanedNodes: TiptapNode[] = [];
  const extractedLinks: HelpGuideSectionLink[] = [];

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (
      isDownloadLinksHeading(node) &&
      index + 1 < nodes.length &&
      isObjectRecord(nodes[index + 1]) &&
      nodes[index + 1].type === "bulletList"
    ) {
      const blockLinks = parseLinksFromBulletList(nodes[index + 1]);
      if (blockLinks.length) {
        extractedLinks.push(...blockLinks);
        index += 1;
        continue;
      }
    }
    cleanedNodes.push(cloneJson(node));
  }

  return {
    contentNodes: cleanedNodes,
    links: normalizeSectionLinks(extractedLinks),
  };
}

function parseMetadataLine(
  line: string,
  label: string,
  maxLength: number
) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}\\s*:\\s*(.*)$`, "i");
  const match = line.match(pattern);
  if (!match) {
    return null;
  }
  return normalizeText(match[1] || "", maxLength);
}

function buildBodySections(
  bodyNodes: TiptapNode[],
  previousGuide: HelpGuide
): HelpGuideSection[] {
  const drafts: Array<{ title: string; nodes: TiptapNode[] }> = [];
  let current: { title: string; nodes: TiptapNode[] } | null = null;

  const defaultTitle = normalizeText(previousGuide.sections[0]?.title || "Guide", 240) || "Guide";

  bodyNodes.forEach((node) => {
    if (getHeadingLevel(node) === 2) {
      const headingText = normalizeText(getNodeText(node), 240);
      const title = headingText || `Section ${drafts.length + 1}`;
      current = { title, nodes: [] };
      drafts.push(current);
      return;
    }

    if (!current) {
      current = { title: defaultTitle, nodes: [] };
      drafts.push(current);
    }
    current.nodes.push(cloneJson(node));
  });

  if (!drafts.length) {
    drafts.push({
      title: defaultTitle,
      nodes: bodyNodes.length ? cloneJson(bodyNodes) : [createParagraphNode()],
    });
  }

  const usedIds = new Set<string>();
  const sections: HelpGuideSection[] = drafts.map((draft, index) => {
    const title = normalizeText(draft.title || `Section ${index + 1}`, 240) || `Section ${index + 1}`;
    const idBase = normalizeSectionId(title) || `section-${index + 1}`;
    let id = idBase;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${idBase}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);

    const extracted = extractDownloadLinksBlock(draft.nodes);
    const nextSection: HelpGuideSection = {
      id,
      title,
      content: {
        type: "doc",
        content: extracted.contentNodes.length ? cloneJson(extracted.contentNodes) : [createParagraphNode()],
      },
    };
    if (extracted.links.length) {
      nextSection.links = extracted.links;
    }
    return nextSection;
  });

  return sections.length
    ? sections
    : [
        {
          id: "guide",
          title: "Guide",
          content: {
            type: "doc",
            content: [createParagraphNode()],
          },
        },
      ];
}

export function normalizeGuideRouteSlugFromTitle(value: string) {
  const normalized = normalizeText(value, 240)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "guide";
}

export function ensureUniqueGuideRouteSlug(candidate: string, usedSlugs: Set<string>) {
  const base = normalizeGuideRouteSlugFromTitle(candidate);
  let slug = base;
  let suffix = 2;
  while (usedSlugs.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

export function buildGuideSingleDoc(guide: HelpGuide): TiptapDoc {
  const content: TiptapNode[] = [
    createParagraphNode(`${METADATA_LABELS.title}: ${guide.title}`),
    createParagraphNode(`${METADATA_LABELS.summary}: ${guide.summary}`),
    createParagraphNode(`${METADATA_LABELS.audience}: ${guide.audience}`),
    createParagraphNode(`${METADATA_LABELS.estimatedTime}: ${guide.estimatedTime}`),
    createParagraphNode(),
  ];

  guide.sections.forEach((section) => {
    const title = normalizeText(section.title, 240) || "Section";
    content.push(createHeadingNode(title));
    const sectionDoc = normalizeDoc(section.content);
    const extracted = extractDownloadLinksBlock(sectionDoc.content || []);
    if (extracted.contentNodes.length) {
      extracted.contentNodes.forEach((node) => {
        content.push(cloneJson(node));
      });
    } else {
      content.push(createParagraphNode());
    }

    const normalizedSectionLinks = normalizeSectionLinks(section.links);
    const linksToRender = normalizedSectionLinks.length ? normalizedSectionLinks : extracted.links;
    if (linksToRender.length) {
      content.push(createParagraphNode(DOWNLOAD_LINKS_HEADING));
      content.push(createDownloadLinksList(linksToRender));
    }
  });

  if (content.length === 5) {
    content.push(createParagraphNode());
  }

  return {
    type: "doc",
    content,
  };
}

export function parseGuideSingleDoc(docContent: unknown, previousGuide: HelpGuide): HelpGuide {
  const doc = normalizeDoc(docContent);
  const metadata: Record<MetadataKey, string> = {
    title: previousGuide.title,
    summary: previousGuide.summary,
    audience: previousGuide.audience,
    estimatedTime: previousGuide.estimatedTime,
  };
  const consumedNodeIndexes = new Set<number>();

  doc.content.slice(0, 20).forEach((node, index) => {
    const text = getNodeText(node);
    if (!text) {
      return;
    }
    const title = parseMetadataLine(text, METADATA_LABELS.title, 240);
    if (title !== null) {
      consumedNodeIndexes.add(index);
      metadata.title = title;
      return;
    }

    const summary = parseMetadataLine(text, METADATA_LABELS.summary, 3000);
    if (summary !== null) {
      consumedNodeIndexes.add(index);
      metadata.summary = summary;
      return;
    }

    const audience = parseMetadataLine(text, METADATA_LABELS.audience, 240);
    if (audience !== null) {
      consumedNodeIndexes.add(index);
      metadata.audience = audience;
      return;
    }

    const estimatedTime = parseMetadataLine(text, METADATA_LABELS.estimatedTime, 120);
    if (estimatedTime !== null) {
      consumedNodeIndexes.add(index);
      metadata.estimatedTime = estimatedTime;
    }
  });

  const bodyNodes = doc.content
    .filter((_node, index) => !consumedNodeIndexes.has(index))
    .map((node) => cloneJson(node));

  while (bodyNodes.length && !getNodeText(bodyNodes[0])) {
    bodyNodes.shift();
  }
  while (bodyNodes.length && !getNodeText(bodyNodes[bodyNodes.length - 1])) {
    bodyNodes.pop();
  }

  const sections = buildBodySections(bodyNodes, previousGuide);
  const nextTitle = metadata.title || previousGuide.title;

  return {
    ...previousGuide,
    ...metadata,
    slug: normalizeGuideRouteSlugFromTitle(nextTitle),
    sections,
  };
}
