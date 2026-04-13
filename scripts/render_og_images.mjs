import { createHash } from "node:crypto"
import { mkdir, readFile, stat, writeFile, copyFile } from "node:fs/promises"
import path from "node:path"

import { Resvg } from "@resvg/resvg-js"

const ROOT = process.cwd()
const BOOK_DIR = path.join(ROOT, "tao.cleaned")
const PUBLIC_OG_DIR = path.join(ROOT, "public", "og")
const PREVIEW_OG_DIR = path.join(ROOT, "preview", "og")
const MANIFEST_PATH = path.join(ROOT, "output", "og-manifest.json")
const TEMPLATE_VERSION = "og-v3"
const SAMPLE_SLUGS = new Set([
  "index",
  "001-chapter-1",
  "008-chapter-8",
  "011-chapter-11",
  "022-chapter-22",
  "039-chapter-39",
  "044-chapter-44",
  "066-chapter-66",
  "081-chapter-81",
])
const SAMPLE_ONLY = process.env.OG_SAMPLE_ONLY === "1"

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function splitLines(value, maxChars, maxLines) {
  const words = value.trim().split(/\s+/)
  const lines = []
  let currentLine = ""

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word
    if (candidate.length <= maxChars) {
      currentLine = candidate
      continue
    }

    if (currentLine) lines.push(currentLine)
    currentLine = word

    if (lines.length === maxLines) break
  }

  if (lines.length < maxLines && currentLine) lines.push(currentLine)
  return lines.slice(0, maxLines)
}

function renderTextLines(lines, x, startY, lineHeight, className) {
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${startY + index * lineHeight}" class="${className}">${escapeXml(line)}</text>`,
    )
    .join("")
}

function renderOgImage({ label, title, preview, variant }) {
  const titleLines = splitLines(title, variant === "home" ? 22 : 34, variant === "home" ? 2 : 3)
  const previewLines = splitLines(preview, variant === "home" ? 56 : 50, variant === "home" ? 6 : 6)
  const previewStartY = 338
  const titleBlock =
    variant === "home"
      ? renderTextLines(titleLines, 132, 286, 86, "title-home")
      : titleLines
          .map(
            (line, index) =>
              `<text x="250" y="${208 + index * 56}" class="title-chapter">${escapeXml(line)}</text>`,
          )
          .join("")

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="320" x2="0" y2="630" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#111111"/>
      <stop offset="0.46" stop-color="#6E6E6E"/>
      <stop offset="0.68" stop-color="#D7D7D7"/>
      <stop offset="0.82" stop-color="#F4F4F4"/>
      <stop offset="1" stop-color="#FFFFFF"/>
    </linearGradient>
    <style>
      .eyebrow { font-family: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif; font-size: 30px; font-weight: 400; letter-spacing: 0.01em; fill: #111111; }
      .title-home { font-family: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif; font-size: 70px; font-weight: 400; letter-spacing: 0.01em; fill: #111111; }
      .title-chapter { font-family: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif; font-size: 40px; font-style: italic; font-weight: 400; letter-spacing: 0.01em; fill: #111111; }
      .body { font-family: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif; font-size: 33px; font-weight: 400; letter-spacing: 0.01em; fill: url(#fade); }
    </style>
  </defs>
  <rect width="1200" height="630" fill="#FFFFFF"/>
  <text x="${variant === "home" ? 132 : 250}" y="${variant === "home" ? 124 : 116}" class="eyebrow">${escapeXml(label)}</text>
  ${titleBlock}
  ${variant === "home" ? "" : renderTextLines(previewLines, 250, previewStartY, 48, "body")}
</svg>`
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

function parseFrontMatter(markdown) {
  if (!markdown.startsWith("---\n")) return { data: {}, body: markdown.trim() }

  const endIndex = markdown.indexOf("\n---\n", 4)
  if (endIndex === -1) return { data: {}, body: markdown.trim() }

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

  return { data, body: markdown.slice(endIndex + 5).trim() }
}

async function loadManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, "utf8"))
  } catch {
    return {}
  }
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}

async function fileExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function hashPayload(payload) {
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex")
}

async function chapterFiles() {
  const { readdir } = await import("node:fs/promises")
  return (await readdir(BOOK_DIR))
    .filter((fileName) => fileName.endsWith(".md") && fileName !== "00-front-matter.md")
    .sort((left, right) => left.localeCompare(right, "en"))
}

async function readChapter(fileName) {
  const slug = fileName.replace(/\.md$/, "")
  const markdown = await readFile(path.join(BOOK_DIR, fileName), "utf8")
  const { data, body } = parseFrontMatter(markdown)
  const title = data.title || slug
  return {
    slug,
    title,
    chapterLabel: data.chapter_label || data.fragment_number || slug,
    previewText: excerptText(stripMarkdown(body)),
  }
}

function renderPngBuffer(payload) {
  const svg = renderOgImage(payload)
  return new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
  })
    .render()
    .asPng()
}

async function main() {
  await ensureDir(PUBLIC_OG_DIR)
  await ensureDir(PREVIEW_OG_DIR)
  await ensureDir(path.dirname(MANIFEST_PATH))

  const files = await chapterFiles()
  const chapters = await Promise.all(files.map(readChapter))
  const manifest = await loadManifest()
  const nextManifest = {}

  const homePayload = {
    label: "Laozi",
    title: "Tao Te Ching",
    preview: chapters[0]?.previewText || "",
    variant: "home",
  }
  const homeHash = hashPayload([TEMPLATE_VERSION, homePayload])
  const homeOutputPath = path.join(PUBLIC_OG_DIR, "index.png")
  if (manifest.index !== homeHash || !(await fileExists(homeOutputPath))) {
    await writeFile(homeOutputPath, renderPngBuffer(homePayload))
  }
  nextManifest.index = homeHash
  if (SAMPLE_SLUGS.has("index")) {
    await copyFile(homeOutputPath, path.join(PREVIEW_OG_DIR, "index.png"))
  }

  const chaptersToRender = SAMPLE_ONLY
    ? chapters.filter((chapter) => SAMPLE_SLUGS.has(chapter.slug))
    : chapters

  for (const chapter of chaptersToRender) {
    const payload = {
      label: chapter.chapterLabel,
      title: chapter.title,
      preview: chapter.previewText,
      variant: "chapter",
    }
    const digest = hashPayload([TEMPLATE_VERSION, payload])
    const outputPath = path.join(PUBLIC_OG_DIR, `${chapter.slug}.png`)
    if (manifest[chapter.slug] !== digest || !(await fileExists(outputPath))) {
      await writeFile(outputPath, renderPngBuffer(payload))
    }
    nextManifest[chapter.slug] = digest
    if (SAMPLE_SLUGS.has(chapter.slug)) {
      await copyFile(outputPath, path.join(PREVIEW_OG_DIR, `${chapter.slug}.png`))
    }
  }

  if (!SAMPLE_ONLY) {
    await writeFile(MANIFEST_PATH, `${JSON.stringify(nextManifest, null, 2)}\n`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
