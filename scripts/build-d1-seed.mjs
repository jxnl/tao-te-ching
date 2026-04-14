import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const BOOK_DIR = path.join(ROOT, "tao.cleaned")
const OUTPUT_DIR = path.join(ROOT, "output")
const OUTPUT_PATH = path.join(OUTPUT_DIR, "d1-seed.sql")

function parseFrontMatter(markdown) {
  if (!markdown.startsWith("---\n")) {
    return { data: {}, body: markdown.trim() }
  }

  const endIndex = markdown.indexOf("\n---\n", 4)
  if (endIndex === -1) {
    return { data: {}, body: markdown.trim() }
  }

  const data = {}
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

function stripMarkdown(value) {
  return value
    .replace(/^#\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

function excerptText(value, maxLength = 320) {
  if (value.length <= maxLength) return value
  const sliced = value.slice(0, maxLength)
  const boundary = sliced.lastIndexOf(" ")
  return `${(boundary > 0 ? sliced.slice(0, boundary) : sliced).trim()}...`
}

function normalizeText(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function sql(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

const files = readdirSync(BOOK_DIR)
  .filter((fileName) => fileName.endsWith(".md") && fileName !== "00-front-matter.md")
  .sort((left, right) => left.localeCompare(right, "en"))

const statements = [
  "DELETE FROM comments;",
  "DELETE FROM highlights;",
  "DELETE FROM stars;",
  "DELETE FROM request_limits;",
  "DELETE FROM fragments;",
]

files.forEach((fileName, index) => {
  const slug = fileName.replace(/\.md$/, "")
  const markdown = readFileSync(path.join(BOOK_DIR, fileName), "utf-8").replace(/\r\n?/g, "\n")
  const { data, body } = parseFrontMatter(markdown)
  const title = data.title || slug
  const chapterLabel = data.chapter_label || data.fragment_number || slug
  const bodyText = stripMarkdown(body)
  const previewText = excerptText(bodyText)

  statements.push(
    `INSERT INTO fragments (
      slug,
      canonical_order,
      path,
      chapter_label,
      title,
      title_normalized,
      preview_text,
      preview_normalized,
      body_text,
      search_text
    ) VALUES (
      ${sql(slug)},
      ${index},
      ${sql(`/read/${slug}/`)},
      ${sql(chapterLabel)},
      ${sql(title)},
      ${sql(normalizeText(title))},
      ${sql(previewText)},
      ${sql(normalizeText(previewText))},
      ${sql(bodyText)},
      ${sql(normalizeText(`${chapterLabel} ${title} ${bodyText}`))}
    );`,
  )
})

mkdirSync(OUTPUT_DIR, { recursive: true })
writeFileSync(OUTPUT_PATH, `${statements.join("\n")}\n`)

console.log(`Wrote ${files.length} fragments to ${OUTPUT_PATH}`)
