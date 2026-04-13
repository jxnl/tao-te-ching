import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const BOOK_DIR = path.resolve(process.cwd(), "tao.cleaned")

export type ChapterMeta = {
  slug: string
  path: string
  title: string
  chapterLabel: string
}

export type Chapter = ChapterMeta & {
  bodyHtml: string
  previewText: string
}

export type FragmentEntry = Chapter & {
  canonicalOrder: number
}

export type SearchEntry = {
  slug: string
  text: string
}

function parseFrontMatter(markdown: string) {
  if (!markdown.startsWith("---\n")) {
    return { data: {} as Record<string, string>, body: markdown.trim() }
  }

  const endIndex = markdown.indexOf("\n---\n", 4)
  if (endIndex === -1) {
    return { data: {} as Record<string, string>, body: markdown.trim() }
  }

  const data: Record<string, string> = {}
  for (const line of markdown.slice(4, endIndex).split("\n")) {
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!match) continue

    const [, key, rawValue] = match
    try {
      data[key] = rawValue.trim().startsWith('"')
        ? JSON.parse(rawValue.trim())
        : rawValue.trim()
    } catch {
      data[key] = rawValue.trim()
    }
  }

  return {
    data,
    body: markdown.slice(endIndex + 5).trim(),
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function stripMarkdown(value: string) {
  return value
    .replace(/^#\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

function excerptText(value: string, maxLength = 320) {
  if (value.length <= maxLength) return value
  const sliced = value.slice(0, maxLength)
  const boundary = sliced.lastIndexOf(" ")
  return `${(boundary > 0 ? sliced.slice(0, boundary) : sliced).trim()}...`
}

function formatInline(value: string) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
}

function markdownToHtml(markdown: string, title: string) {
  const blocks: string[] = []
  let currentLines: string[] = []
  let mode: "paragraph" | "quote" = "paragraph"

  const flush = () => {
    if (currentLines.length === 0) return

    const content = formatInline(currentLines.join(" ").trim())
    blocks.push(
      mode === "quote"
        ? `<blockquote><p>${content}</p></blockquote>`
        : `<p>${content}</p>`,
    )
    currentLines = []
    mode = "paragraph"
  }

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trimEnd()

    if (line.startsWith("# ")) {
      if (line.slice(2).trim() === title) continue
      flush()
      blocks.push(`<h2>${formatInline(line.slice(2).trim())}</h2>`)
      continue
    }

    if (line.startsWith("> ")) {
      if (mode !== "quote") flush()
      mode = "quote"
      currentLines.push(line.slice(2))
      continue
    }

    if (!line.trim()) {
      flush()
      continue
    }

    if (mode !== "paragraph") flush()
    currentLines.push(line.trim())
  }

  flush()
  return blocks.join("")
}

const chapterCache = new Map<string, Chapter>()
const fragmentCache = new Map<string, FragmentEntry>()
const searchCache = new Map<string, string>()

export function getChapterSlugs() {
  return readdirSync(BOOK_DIR)
    .filter((fileName) => fileName.endsWith(".md") && fileName !== "00-front-matter.md")
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((fileName) => fileName.replace(/\.md$/, ""))
}

export function getChapter(slug: string): Chapter {
  const fragment = getFragmentEntry(slug)
  return {
    slug: fragment.slug,
    path: fragment.path,
    title: fragment.title,
    chapterLabel: fragment.chapterLabel,
    bodyHtml: fragment.bodyHtml,
    previewText: fragment.previewText,
  }
}

export function getFragmentEntry(slug: string): FragmentEntry {
  const cached = fragmentCache.get(slug)
  if (cached) return cached

  const fileName = `${slug}.md`
  const filePath = path.join(BOOK_DIR, fileName)
  const markdown = readFileSync(filePath, "utf-8")
  const { data, body } = parseFrontMatter(markdown)
  const title = data.title || slug
  const canonicalOrder = getChapterSlugs().indexOf(slug)
  const fragment: FragmentEntry = {
    slug,
    path: `/read/${slug}/`,
    title,
    chapterLabel: data.chapter_label || data.fragment_number || slug,
    bodyHtml: markdownToHtml(body, title),
    previewText: excerptText(stripMarkdown(body)),
    canonicalOrder,
  }

  fragmentCache.set(slug, fragment)
  chapterCache.set(slug, {
    slug: fragment.slug,
    path: fragment.path,
    title: fragment.title,
    chapterLabel: fragment.chapterLabel,
    bodyHtml: fragment.bodyHtml,
    previewText: fragment.previewText,
  })
  return fragment
}

export function getFragmentEntries() {
  return getChapterSlugs().map((slug) => getFragmentEntry(slug))
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function getSearchEntries(): SearchEntry[] {
  return getChapterSlugs().map((slug) => {
    const cached = searchCache.get(slug)
    if (cached) {
      return { slug, text: cached }
    }

    const chapter = getChapter(slug)
    const plainText = normalizeSearchText(
      `${chapter.chapterLabel} ${chapter.title} ${chapter.bodyHtml.replace(/<[^>]+>/g, " ")}`,
    )
    searchCache.set(slug, plainText)
    return { slug, text: plainText }
  })
}
