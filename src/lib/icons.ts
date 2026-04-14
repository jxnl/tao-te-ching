import { Bookmark, MessageSquareText, Search, Star, Trash2, X } from "lucide"

type IconNode = Array<[string, Record<string, string>]>

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function renderChildren(node: IconNode) {
  return node
    .map(([tag, attributes]) => {
      const serialized = Object.entries(attributes)
        .map(([key, value]) => `${key}="${escapeAttribute(String(value))}"`)
        .join(" ")
      return `<${tag} ${serialized}></${tag}>`
    })
    .join("")
}

export function renderIcon(
  node: IconNode,
  className = "",
  extraAttributes: Record<string, string> = {},
) {
  const attributes = {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    class: className,
    ...extraAttributes,
  }

  const serialized = Object.entries(attributes)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}="${escapeAttribute(String(value))}"`)
    .join(" ")

  return `<svg ${serialized}>${renderChildren(node)}</svg>`
}

export const icons = {
  star: Star as IconNode,
  highlight: Bookmark as IconNode,
  search: Search as IconNode,
  note: MessageSquareText as IconNode,
  trash: Trash2 as IconNode,
  close: X as IconNode,
}
