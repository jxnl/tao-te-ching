import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const SOURCE_URLS = [
  "https://classics.mit.edu/Lao/taote.1.1.html",
  "https://classics.mit.edu/Lao/taote.2.ii.html",
]
const OUTPUT_DIR = path.join(ROOT, "tao.cleaned")
const MANIFEST_PATH = path.join(OUTPUT_DIR, "proofread-manifest.json")

const NAMED_ENTITIES = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "...",
}

function chapterSlug(chapterNumber) {
  return `${String(chapterNumber).padStart(3, "0")}-chapter-${chapterNumber}`
}

function decodeHtml(value) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const lowerEntity = entity.toLowerCase()
    if (lowerEntity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(lowerEntity.slice(2), 16))
    }
    if (lowerEntity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(lowerEntity.slice(1), 10))
    }
    return NAMED_ENTITIES[lowerEntity] ?? match
  })
}

function normalizeText(value) {
  return decodeHtml(value)
    .replace(/\r/g, "")
    .replace(/<BR\s*\/?><BR\s*\/?>/gi, "[[PARA]]")
    .replace(/<BR\s*\/?>/gi, "[[LINE]]")
    .replace(/<A NAME="[^"]+"><\/A>/gi, "")
    .replace(/<B>(\d+)\.<\/B>/gi, "$1.")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*\[\[PARA\]\]\s*/g, "\n\n")
    .replace(/\s*\[\[LINE\]\]\s*/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function formatBlock(block) {
  const lines = block
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)

  if (lines.length === 0) return ""
  if (lines.length === 1) return lines[0]

  return lines.map((line) => `> ${line}`).join("\n")
}

function extractChapters(pageHtml) {
  const bodyStart = pageHtml.indexOf('<A NAME="start"></A>')
  if (bodyStart === -1) return []

  const body = pageHtml.slice(bodyStart)
  const chapterPattern =
    /<A NAME="[^"]+"><\/A><B>Chapter\s+(\d+)<\/B>([\s\S]*?)(?=<BR><BR>\s*<A NAME="[^"]+"><\/A><B>Chapter\s+\d+<\/B>|<\/BODY>)/gi

  const chapters = []
  for (const match of body.matchAll(chapterPattern)) {
    const chapterNumber = Number(match[1])
    const rawBody = normalizeText(match[2])
      .replace(/\nTHE END[\s\S]*$/i, "")
      .replace(/\nTable of Contents[\s\S]*$/i, "")
      .trim()
    const blocks = rawBody
      .split(/\n\s*\n/)
      .map(formatBlock)
      .filter(Boolean)

    chapters.push({
      chapterNumber,
      body: `${blocks.join("\n\n")}\n`,
    })
  }

  return chapters
}

async function fetchSource(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch source ${url}: ${response.status}`)
  }
  return response.text()
}

async function main() {
  const htmlPages = await Promise.all(SOURCE_URLS.map(fetchSource))
  const chapters = htmlPages
    .flatMap(extractChapters)
    .sort((left, right) => left.chapterNumber - right.chapterNumber)

  if (chapters.length !== 81) {
    throw new Error(`Expected 81 chapters, found ${chapters.length}`)
  }

  for (let index = 0; index < chapters.length; index += 1) {
    const expectedChapterNumber = index + 1
    if (chapters[index].chapterNumber !== expectedChapterNumber) {
      throw new Error(
        `Chapter ordering mismatch at index ${index}: expected ${expectedChapterNumber}, found ${chapters[index].chapterNumber}`,
      )
    }
  }

  rmSync(OUTPUT_DIR, { recursive: true, force: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const manifest = []

  for (const chapter of chapters) {
    const slug = chapterSlug(chapter.chapterNumber)
    const outputPath = path.join(OUTPUT_DIR, `${slug}.md`)
    const markdown = `---
title: "Chapter ${chapter.chapterNumber}"
chapter_label: "${chapter.chapterNumber}"
translator: "James Legge"
source: "MIT Internet Classics Archive"
source_url: "${SOURCE_URLS[chapter.chapterNumber <= 37 ? 0 : 1]}"
---

${chapter.body}`

    writeFileSync(outputPath, markdown)
    manifest.push({
      chapter: chapter.chapterNumber,
      slug,
      title: `Chapter ${chapter.chapterNumber}`,
      translator: "James Legge",
      source: "MIT Internet Classics Archive",
      source_url: SOURCE_URLS[chapter.chapterNumber <= 37 ? 0 : 1],
      target: `tao.cleaned/${slug}.md`,
    })
  }

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${chapters.length} chapters to ${OUTPUT_DIR}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
