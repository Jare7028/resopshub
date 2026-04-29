/* eslint-disable @next/next/no-img-element */
import type { CSSProperties, ReactNode } from "react";

type TiptapMark = {
  type?: string;
  attrs?: Record<string, unknown> | null;
};

type TiptapNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown> | null;
  content?: TiptapNode[];
  marks?: TiptapMark[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDoc(content: unknown): TiptapNode {
  if (isRecord(content) && content.type === "doc") {
    return content as TiptapNode;
  }
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function getAttrs(node: TiptapNode) {
  return isRecord(node.attrs) ? node.attrs : {};
}

function getStringAttr(attrs: Record<string, unknown>, key: string) {
  const value = attrs[key];
  return typeof value === "string" ? value.trim() : "";
}

function getNumberAttr(attrs: Record<string, unknown>, key: string) {
  const value = Number(attrs[key]);
  return Number.isFinite(value) ? value : null;
}

function sanitizeUrl(value: unknown, options?: { image?: boolean }) {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url) return "";
  const lower = url.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("vbscript:")) {
    return "";
  }
  if (lower.startsWith("data:") && !lower.startsWith("data:image/")) {
    return "";
  }
  if (options?.image && lower.startsWith("data:") && !lower.startsWith("data:image/")) {
    return "";
  }
  return url;
}

function blockStyle(attrs: Record<string, unknown>): CSSProperties | undefined {
  const align = getStringAttr(attrs, "textAlign");
  if (align === "center" || align === "right" || align === "justify") {
    return { textAlign: align };
  }
  return undefined;
}

function textStyleFromAttrs(attrs: Record<string, unknown>): CSSProperties {
  const style: CSSProperties = {};
  const color = getStringAttr(attrs, "color");
  const fontFamily = getStringAttr(attrs, "fontFamily");
  const fontSize = getStringAttr(attrs, "fontSize");
  if (color) style.color = color;
  if (fontFamily) style.fontFamily = fontFamily;
  if (fontSize) style.fontSize = fontSize;
  return style;
}

function cellAttrs(attrs: Record<string, unknown>) {
  const colSpan = Math.max(1, getNumberAttr(attrs, "colspan") || 1);
  const rowSpan = Math.max(1, getNumberAttr(attrs, "rowspan") || 1);
  const colWidth = Array.isArray(attrs.colwidth)
    ? Number(attrs.colwidth.find((value) => Number.isFinite(Number(value))))
    : null;
  const colType = getStringAttr(attrs, "colType") || "text";
  return {
    colSpan,
    rowSpan,
    "data-col-type": colType,
    style: Number.isFinite(colWidth) && colWidth ? { width: `${colWidth}px` } : undefined,
  };
}

function hasRenderableContent(node: TiptapNode): boolean {
  if (node.type === "text") {
    return Boolean(String(node.text || "").trim());
  }
  if (
    node.type === "image" ||
    node.type === "table" ||
    node.type === "horizontalRule" ||
    node.type === "noteShape" ||
    node.type === "noteTextBox"
  ) {
    return true;
  }
  return Boolean(node.content?.some((child) => hasRenderableContent(child)));
}

function childrenOrBreak(children: ReactNode[]) {
  return children.length ? children : <br />;
}

function applyMarks(children: ReactNode, marks: TiptapMark[] | undefined, keyBase: string) {
  if (!marks?.length) return children;
  return marks.reduce<ReactNode>((current, mark, index) => {
    const attrs = isRecord(mark.attrs) ? mark.attrs : {};
    const key = `${keyBase}-mark-${index}`;
    if (mark.type === "bold") return <strong key={key}>{current}</strong>;
    if (mark.type === "italic") return <em key={key}>{current}</em>;
    if (mark.type === "strike") return <s key={key}>{current}</s>;
    if (mark.type === "code") return <code key={key}>{current}</code>;
    if (mark.type === "underline") {
      return (
        <span key={key} style={{ textDecorationLine: "underline" }}>
          {current}
        </span>
      );
    }
    if (mark.type === "highlight") {
      const color = getStringAttr(attrs, "color");
      return (
        <mark key={key} style={color ? { backgroundColor: color } : undefined}>
          {current}
        </mark>
      );
    }
    if (mark.type === "textStyle") {
      const style = textStyleFromAttrs(attrs);
      return (
        <span key={key} style={Object.keys(style).length ? style : undefined}>
          {current}
        </span>
      );
    }
    if (mark.type === "link") {
      const href = sanitizeUrl(attrs.href);
      if (!href) return current;
      return (
        <a key={key} href={href}>
          {current}
        </a>
      );
    }
    return current;
  }, children);
}

function renderShapeSvg(attrs: Record<string, unknown>) {
  const kind = getStringAttr(attrs, "kind") || "rectangle";
  const stroke = getStringAttr(attrs, "stroke") || "#0f172a";
  const fill = getStringAttr(attrs, "fill") || "#ffffff";
  const width = Math.max(8, getNumberAttr(attrs, "width") || 150);
  const height = Math.max(8, getNumberAttr(attrs, "height") || 104);
  const centerY = Math.round(height / 2);

  if (kind === "circle") {
    const radius = Math.max(8, Math.min(width, height) / 2 - 4);
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
        <circle cx={width / 2} cy={height / 2} r={radius} fill={fill} stroke={stroke} strokeWidth="2" />
      </svg>
    );
  }

  if (kind === "arrow") {
    const headStart = Math.max(34, width - Math.max(28, Math.round(height * 0.6)));
    const topY = Math.max(8, centerY - Math.max(8, Math.round(height * 0.2)));
    const bottomY = Math.min(height - 8, centerY + Math.max(8, Math.round(height * 0.2)));
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
        <path d={`M8 ${centerY} H ${headStart}`} stroke={stroke} strokeWidth="4" strokeLinecap="round" />
        <path
          d={`M${headStart} ${topY} L ${width - 8} ${centerY} L ${headStart} ${bottomY}`}
          fill="none"
          stroke={stroke}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <rect
        x="3"
        y="3"
        width={Math.max(8, width - 6)}
        height={Math.max(8, height - 6)}
        rx={kind === "square" ? 10 : 14}
        fill={fill}
        stroke={stroke}
        strokeWidth="2"
      />
    </svg>
  );
}

function overlayStyle(attrs: Record<string, unknown>, fallbackZIndex: number): CSSProperties {
  return {
    left: `${getNumberAttr(attrs, "x") || 24}px`,
    top: `${getNumberAttr(attrs, "y") || 24}px`,
    width: `${getNumberAttr(attrs, "width") || 150}px`,
    height: `${getNumberAttr(attrs, "height") || 104}px`,
    zIndex: getNumberAttr(attrs, "zIndex") || fallbackZIndex,
  };
}

function renderChildren(node: TiptapNode, path: string) {
  return (node.content || []).map((child, index) => renderNode(child, `${path}-${index}`));
}

function renderNode(node: TiptapNode, path: string): ReactNode {
  const attrs = getAttrs(node);
  const children = renderChildren(node, path);

  if (node.type === "text") {
    return applyMarks(String(node.text || ""), node.marks, path);
  }

  if (node.type === "hardBreak") {
    return <br key={path} />;
  }

  if (node.type === "paragraph") {
    return (
      <p key={path} style={blockStyle(attrs)}>
        {childrenOrBreak(children)}
      </p>
    );
  }

  if (node.type === "heading") {
    const level = Math.max(1, Math.min(3, getNumberAttr(attrs, "level") || 1));
    const Heading = `h${level}` as "h1" | "h2" | "h3";
    return (
      <Heading key={path} style={blockStyle(attrs)}>
        {childrenOrBreak(children)}
      </Heading>
    );
  }

  if (node.type === "bulletList" || node.type === "taskList") {
    return (
      <ul key={path} data-type={node.type === "taskList" ? "taskList" : undefined}>
        {children}
      </ul>
    );
  }

  if (node.type === "orderedList") {
    return <ol key={path}>{children}</ol>;
  }

  if (node.type === "listItem") {
    return <li key={path}>{children}</li>;
  }

  if (node.type === "taskItem") {
    return (
      <li key={path} data-checked={Boolean(attrs.checked)}>
        <label>
          <input type="checkbox" checked={Boolean(attrs.checked)} readOnly disabled />
        </label>
        <div>{children}</div>
      </li>
    );
  }

  if (node.type === "blockquote") {
    return (
      <blockquote key={path} style={blockStyle(attrs)}>
        {children}
      </blockquote>
    );
  }

  if (node.type === "horizontalRule") {
    return <hr key={path} />;
  }

  if (node.type === "codeBlock") {
    return (
      <pre key={path}>
        <code>{children.length ? children : String(node.text || "")}</code>
      </pre>
    );
  }

  if (node.type === "table") {
    return (
      <div key={path} className="tableWrapper">
        <table>
          <tbody>{children}</tbody>
        </table>
      </div>
    );
  }

  if (node.type === "tableRow") {
    return <tr key={path}>{children}</tr>;
  }

  if (node.type === "tableHeader") {
    return (
      <th key={path} {...cellAttrs(attrs)}>
        {childrenOrBreak(children)}
      </th>
    );
  }

  if (node.type === "tableCell") {
    return (
      <td key={path} {...cellAttrs(attrs)}>
        {childrenOrBreak(children)}
      </td>
    );
  }

  if (node.type === "image") {
    const src = sanitizeUrl(attrs.src, { image: true });
    if (!src) return null;
    const width = getNumberAttr(attrs, "width");
    const height = getNumberAttr(attrs, "height");
    const float = getStringAttr(attrs, "float");
    return (
      <img
        key={path}
        src={src}
        alt={getStringAttr(attrs, "alt")}
        title={getStringAttr(attrs, "title") || undefined}
        data-float={float && float !== "none" ? float : undefined}
        width={width || undefined}
        height={height || undefined}
      />
    );
  }

  if (node.type === "noteShape") {
    return (
      <div
        key={path}
        className="note-shape-node"
        style={overlayStyle(attrs, 20)}
        data-note-shape-kind={getStringAttr(attrs, "kind") || "rectangle"}
      >
        <div className="note-shape-node-inner">{renderShapeSvg(attrs)}</div>
        <div className="note-shape-content">{children}</div>
      </div>
    );
  }

  if (node.type === "noteTextBox") {
    return (
      <div key={path} className="note-textbox-node" style={overlayStyle(attrs, 24)}>
        <div className="note-textbox-content">{children}</div>
      </div>
    );
  }

  return children.length ? <div key={path}>{children}</div> : null;
}

export default function NoteContentViewer({
  content,
  placeholder = "No content yet.",
  className = "",
}: {
  content: unknown;
  placeholder?: string;
  className?: string;
}) {
  const doc = normalizeDoc(content);
  const hasContent = hasRenderableContent(doc);

  return (
    <div className={`note-editor ${className}`.trim()}>
      {hasContent ? (
        renderChildren(doc, "doc")
      ) : (
        <p className="text-sm text-slate-500">{placeholder}</p>
      )}
    </div>
  );
}
