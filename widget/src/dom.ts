import { parseMarkdown, type Inline } from "../../shared/markdown";

const SVG_NS = "http://www.w3.org/2000/svg";

export function el<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, className?: string, text?: string): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Ikon garis 24x24. `paths` berisi atribut "d" tiap garisnya. */
export function icon(paths: string[], size = 22): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const attributes: Record<string, string> = {
    viewBox: "0 0 24 24",
    width: String(size),
    height: String(size),
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  };
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, value);
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export const ICON = {
  chat: ["M7.9 20A9 9 0 1 0 4 16.1L2 22Z"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  down: ["m6 9 6 6 6-6"],
  send: ["m5 12 7-7 7 7", "M12 19V5"],
};

function appendInline(parent: Node, nodes: Inline[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        parent.appendChild(document.createTextNode(node.text));
        break;
      case "break":
        parent.appendChild(document.createElement("br"));
        break;
      case "code":
        parent.appendChild(el("code", undefined, node.text));
        break;
      case "bold":
      case "italic": {
        const wrapper = document.createElement(node.type === "bold" ? "strong" : "em");
        appendInline(wrapper, node.children);
        parent.appendChild(wrapper);
        break;
      }
      case "link": {
        const link = el("a", undefined, node.text);
        link.href = node.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer nofollow";
        parent.appendChild(link);
        break;
      }
    }
  }
}

/** Mengisi gelembung dengan teks berformat. Elemen dibuat satu per satu, tanpa innerHTML. */
export function renderMarkdown(target: HTMLElement, text: string): void {
  const fragment = document.createDocumentFragment();
  for (const block of parseMarkdown(text)) {
    if (block.type === "paragraph") {
      const paragraph = document.createElement("p");
      appendInline(paragraph, block.children);
      fragment.appendChild(paragraph);
      continue;
    }
    const list = document.createElement(block.ordered ? "ol" : "ul");
    if (block.ordered && block.start !== 1) list.setAttribute("start", String(block.start));
    for (const item of block.items) {
      const entry = document.createElement("li");
      appendInline(entry, item);
      list.appendChild(entry);
    }
    fragment.appendChild(list);
  }
  target.replaceChildren(fragment);
}
