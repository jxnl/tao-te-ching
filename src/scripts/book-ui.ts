import { navigate } from "astro:transitions/client"
import { icons, renderIcon } from "@/lib/icons"

type SearchEntry = {
  slug: string
  text: string
}

type HighlightRange = {
  start: number
  end: number
}

type ReaderComment = {
  id: string
  body: string
  can_delete: boolean
  created_at: number
}

type ReaderRelated = {
  slug: string
  title: string
  chapter_label: string
  preview_text: string
}

type ReaderState = {
  highlightCount: number
  commentCount: number
  starCount: number
  heat: number
  comments: ReaderComment[]
  related: ReaderRelated[]
}

type CachedReaderState = {
  state: ReaderState
  cachedAt: number
}

type FragmentDetail = {
  slug: string
  path: string
  title: string
  chapterLabel: string
  previewText: string
  bodyHtml: string
  canonicalOrder: number
}

const MARGIN_ITEM_CLASS =
  "opacity-[0.32] transition-opacity duration-200 ease-out hover:opacity-[0.72] focus-within:opacity-[0.72]"
const MARGIN_ENTRY_CLASS = "motion-safe:animate-[marginalia-enter_340ms_cubic-bezier(0.22,1,0.36,1)]"

const ORDER_STORAGE_KEY = "tao-te-ching-order"
const STAR_STORAGE_KEY = "tao-te-ching-stars"
const READER_STATE_STORAGE_KEY = "tao-te-ching-reader-state"
const READER_STATE_TTL_MS = 45_000
const BASE_URL = import.meta.env.BASE_URL
const SEARCH_INDEX_URL = `${BASE_URL}search-index.json`
const FRAGMENT_INDEX_URL = `${BASE_URL}fragments.json`
const searchIndexPromise = fetch(SEARCH_INDEX_URL).then(
  (response) => response.json() as Promise<SearchEntry[]>,
)
const fragmentIndexPromise = fetch(FRAGMENT_INDEX_URL).then(
  (response) => response.json() as Promise<FragmentDetail[]>,
)
const cachedReaderStates = new Map<string, CachedReaderState>()
let activePageController: AbortController | null = null

async function getAllSlugs() {
  const entries = await searchIndexPromise
  return entries.map((entry) => entry.slug)
}

function normalizeQuery(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function shuffle<T>(values: T[]) {
  const next = [...values]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
  }
  return next
}

function orderStorageKey(query: string) {
  return query ? `${ORDER_STORAGE_KEY}:${query}` : ORDER_STORAGE_KEY
}

function chapterHref(slug: string, query = "") {
  return query
    ? `${BASE_URL}read/${slug}/?q=${encodeURIComponent(query)}`
    : `${BASE_URL}read/${slug}/`
}

function readerStateStorageKey(slug: string) {
  return `${READER_STATE_STORAGE_KEY}:${slug}`
}

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
}

function isReaderComment(value: unknown): value is ReaderComment {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as ReaderComment).id === "string" &&
      typeof (value as ReaderComment).body === "string" &&
      typeof (value as ReaderComment).can_delete === "boolean" &&
      isFiniteNumber((value as ReaderComment).created_at),
  )
}

function isReaderRelated(value: unknown): value is ReaderRelated {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as ReaderRelated).slug === "string" &&
      typeof (value as ReaderRelated).title === "string" &&
      typeof (value as ReaderRelated).chapter_label === "string" &&
      typeof (value as ReaderRelated).preview_text === "string",
  )
}

function isReaderState(value: unknown): value is ReaderState {
  return Boolean(
    value &&
      typeof value === "object" &&
      isFiniteNumber((value as ReaderState).highlightCount) &&
      isFiniteNumber((value as ReaderState).commentCount) &&
      isFiniteNumber((value as ReaderState).starCount) &&
      isFiniteNumber((value as ReaderState).heat) &&
      Array.isArray((value as ReaderState).comments) &&
      (value as ReaderState).comments.every(isReaderComment) &&
      Array.isArray((value as ReaderState).related) &&
      (value as ReaderState).related.every(isReaderRelated),
  )
}

function readCachedReaderState(slug: string) {
  const now = Date.now()
  const memoryEntry = cachedReaderStates.get(slug)
  if (memoryEntry && now - memoryEntry.cachedAt <= READER_STATE_TTL_MS) {
    return memoryEntry.state
  }

  if (memoryEntry) {
    cachedReaderStates.delete(slug)
  }

  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(readerStateStorageKey(slug)) || "null",
    ) as CachedReaderState | null

    if (
      parsed &&
      isReaderState(parsed.state) &&
      isFiniteNumber(parsed.cachedAt) &&
      now - parsed.cachedAt <= READER_STATE_TTL_MS
    ) {
      cachedReaderStates.set(slug, parsed)
      return parsed.state
    }
  } catch {
    return null
  }

  return null
}

function cacheReaderState(slug: string, state: ReaderState) {
  const entry = {
    state,
    cachedAt: Date.now(),
  }

  cachedReaderStates.set(slug, entry)
  sessionStorage.setItem(readerStateStorageKey(slug), JSON.stringify(entry))
}

function scheduleBackgroundWork(task: () => void, signal: AbortSignal) {
  if (signal.aborted) return

  if ("requestIdleCallback" in window) {
    const idleId = window.requestIdleCallback(() => {
      if (!signal.aborted) task()
    })
    signal.addEventListener(
      "abort",
      () => {
        window.cancelIdleCallback(idleId)
      },
      { once: true },
    )
    return
  }

  const timeoutId = window.setTimeout(() => {
    if (!signal.aborted) task()
  }, 140)
  signal.addEventListener(
    "abort",
    () => {
      window.clearTimeout(timeoutId)
    },
    { once: true },
  )
}

function readStoredStringArray(storage: Storage, storageKey: string) {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) || "null")
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((item) => typeof item === "string")
    ) {
      return parsed
    }
  } catch {
    return null
  }
  return null
}

function readStoredStars() {
  return readStoredStringArray(localStorage, STAR_STORAGE_KEY) || []
}

function writeStoredStars(slugs: string[]) {
  localStorage.setItem(STAR_STORAGE_KEY, JSON.stringify(slugs))
}

function hasStoredStar(slug: string) {
  return readStoredStars().includes(slug)
}

function setStoredStar(slug: string, isStarred: boolean) {
  const next = new Set(readStoredStars())
  if (isStarred) {
    next.add(slug)
  } else {
    next.delete(slug)
  }
  writeStoredStars([...next])
}

async function getMatchingSlugs(query: string) {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) return []

  const entries = await searchIndexPromise
  return entries
    .filter((entry) => entry.text.includes(normalizedQuery))
    .map((entry) => entry.slug)
}

async function startSearchSession(query: string) {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) return null

  const matches = await getMatchingSlugs(normalizedQuery)
  if (matches.length === 0) return null

  const order = shuffle(matches)
  sessionStorage.setItem(
    orderStorageKey(normalizedQuery),
    JSON.stringify(order),
  )
  return chapterHref(order[0], normalizedQuery)
}

async function resolveSavedOrder() {
  const slugs = await getAllSlugs()
  const stored = readStoredStringArray(sessionStorage, orderStorageKey(""))
  if (!stored || stored.length !== slugs.length) {
    const order = shuffle(slugs)
    sessionStorage.setItem(orderStorageKey(""), JSON.stringify(order))
    return order
  }

  const knownSlugs = new Set(slugs)
  const deduped = stored.filter((item) => knownSlugs.has(item))
  if (deduped.length !== slugs.length || new Set(deduped).size !== slugs.length) {
    const order = shuffle(slugs)
    sessionStorage.setItem(orderStorageKey(""), JSON.stringify(order))
    return order
  }

  return deduped
}

async function resolveSearchOrder(query: string, fallbackSlug: string) {
  const storageKey = orderStorageKey(query)
  const stored = readStoredStringArray(sessionStorage, storageKey)
  if (stored) return stored

  const matches = await getMatchingSlugs(query)
  const order = matches.length > 0 ? shuffle(matches) : [fallbackSlug]
  sessionStorage.setItem(storageKey, JSON.stringify(order))
  return order
}

function collectTextNodes(root: Element) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let node = walker.nextNode()

  while (node) {
    if (node.nodeValue) nodes.push(node as Text)
    node = walker.nextNode()
  }

  return nodes
}

function wrapTextRange(root: Element, start: number, end: number) {
  if (end <= start) return

  let offset = 0
  for (const textNode of collectTextNodes(root)) {
    const textLength = textNode.nodeValue?.length || 0
    const nodeStart = offset
    const nodeEnd = offset + textLength
    offset = nodeEnd

    if (nodeEnd <= start || nodeStart >= end) continue

    const range = document.createRange()
    range.setStart(textNode, Math.max(0, start - nodeStart))
    range.setEnd(textNode, Math.min(textLength, end - nodeStart))

    const mark = document.createElement("mark")
    mark.className = "book-highlight px-[0.08em]"

    try {
      range.surroundContents(mark)
    } catch {
      // A saved range can become partially invalid after DOM splitting.
    }
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function applySearchHighlights(articleBody: Element, query: string) {
  if (!query) return

  const pattern = new RegExp(`(${escapeRegExp(query)})`, "gi")
  for (const node of articleBody.querySelectorAll("p, h2, blockquote p")) {
    node.innerHTML = node.innerHTML.replace(
      pattern,
      (_, text) =>
        `<mark class="book-highlight px-[0.08em]">${text}</mark>`,
    )
  }
}

function getStoredHighlightRanges(slug: string) {
  try {
    const stored = JSON.parse(
      localStorage.getItem(`tao-te-ching-highlights:${slug}`) || "[]",
    )
    if (!Array.isArray(stored)) return []

    return stored.filter(
      (item): item is HighlightRange =>
        item &&
        Number.isInteger(item.start) &&
        Number.isInteger(item.end) &&
        item.end > item.start,
    )
  } catch {
    return []
  }
}

function rangesConflict(start: number, end: number, range: HighlightRange) {
  return start < range.end && end > range.start
}

function saveHighlightRange(slug: string, start: number, end: number) {
  const highlights = getStoredHighlightRanges(slug)
  const conflicts = highlights.filter((item) => rangesConflict(start, end, item))
  const nextHighlights = highlights.filter((item) => !rangesConflict(start, end, item))
  const hasExactMatch = conflicts.some((item) => item.start === start && item.end === end)

  localStorage.setItem(
    `tao-te-ching-highlights:${slug}`,
    JSON.stringify(
      hasExactMatch ? nextHighlights : [...nextHighlights, { start, end }],
    ),
  )
}

function restoreHighlights(articleBody: Element, slug: string, query: string) {
  const originalBodyHtml = articleBody.getAttribute("data-original-html") || ""
  articleBody.innerHTML = originalBodyHtml

  const highlights = getStoredHighlightRanges(slug).sort(
    (left, right) => right.start - left.start,
  )
  for (const highlight of highlights) {
    wrapTextRange(articleBody, highlight.start, highlight.end)
  }

  applySearchHighlights(articleBody, query)
}

function getSelectionState(articleBody: Element) {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }

  const range = selection.getRangeAt(0)
  if (!articleBody.contains(range.commonAncestorContainer)) {
    return null
  }

  const selectedText = range.toString().trim()
  const rect = range.getBoundingClientRect()
  if (!selectedText || rect.width === 0 || rect.height === 0) {
    return null
  }

  const preSelection = document.createRange()
  preSelection.selectNodeContents(articleBody)
  preSelection.setEnd(range.startContainer, range.startOffset)

  const start = preSelection.toString().length
  const end = start + range.toString().length
  if (end <= start) return null

  return { rect, start, end }
}

function hideTooltip(highlightTooltip: HTMLElement | null) {
  if (highlightTooltip) highlightTooltip.dataset.visible = "false"
}

function showTooltip(highlightTooltip: HTMLElement, rect: DOMRect) {
  highlightTooltip.dataset.visible = "true"
  highlightTooltip.style.left = `${rect.left + rect.width / 2}px`
  highlightTooltip.style.top = `${Math.max(24, rect.top)}px`
}

async function navigateToChapter(href: string) {
  try {
    await navigate(href)
  } catch {
    window.location.href = href
  }
}

async function fetchJson<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, init)
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function fetchReaderState(slug: string, signal?: AbortSignal) {
  const state = await fetchJson<ReaderState>(
    `${BASE_URL}api/reader-state?slug=${encodeURIComponent(slug)}`,
    { signal },
  )
  cacheReaderState(slug, state)
  return state
}

function prefetchReaderState(slug: string, signal: AbortSignal) {
  if (!slug || readCachedReaderState(slug)) return

  scheduleBackgroundWork(() => {
    void fetchReaderState(slug, signal).catch(() => {})
  }, signal)
}

function prefetchChapterDocument(href: string, signal: AbortSignal) {
  if (!href) return

  scheduleBackgroundWork(() => {
    void fetch(href, {
      signal,
      credentials: "same-origin",
    }).catch(() => {})
  }, signal)
}

function hasActiveTextSelection() {
  const selection = window.getSelection()
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim())
}

function isInteractiveTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'a, button, input, textarea, select, summary, label, form, [role="button"], [contenteditable="true"], [data-reader-community]',
      ),
    )
  )
}

function setText(node: Element | null, text: string) {
  if (node) node.textContent = text
}

function syncSearchClearButton(
  searchInput: HTMLInputElement | null,
  clearButton: HTMLButtonElement | null,
) {
  if (!searchInput || !clearButton) return
  clearButton.classList.toggle("hidden", searchInput.value.length === 0)
}

function attachSearchFieldBehavior(
  searchInput: HTMLInputElement | null,
  clearButton: HTMLButtonElement | null,
  signal: AbortSignal,
) {
  if (!searchInput || !clearButton) return

  const defaultPlaceholder = searchInput.getAttribute("placeholder") || "search"

  syncSearchClearButton(searchInput, clearButton)

  searchInput.addEventListener(
    "input",
    () => {
      syncSearchClearButton(searchInput, clearButton)
      if (!searchInput.value && searchInput.placeholder !== defaultPlaceholder) {
        searchInput.placeholder = defaultPlaceholder
      }
    },
    { signal },
  )

  clearButton.addEventListener(
    "click",
    () => {
      searchInput.value = ""
      searchInput.placeholder = defaultPlaceholder
      syncSearchClearButton(searchInput, clearButton)
      searchInput.focus()
    },
    { signal },
  )
}

function getReaderStateSignature(state: ReaderState) {
  return JSON.stringify({
    highlightCount: state.highlightCount,
    commentCount: state.commentCount,
    starCount: state.starCount,
    heat: state.heat,
    comments: state.comments.map((comment) => [
      comment.id,
      comment.body,
      comment.can_delete,
      comment.created_at,
    ]),
    related: state.related.map((item) => [
      item.slug,
      item.title,
      item.chapter_label,
      item.preview_text,
    ]),
  })
}

function applyMarginaliaEntry(
  element: HTMLElement,
  index: number,
  offsetMs = 0,
) {
  element.classList.add(...MARGIN_ENTRY_CLASS.split(" "))
  element.style.animationDelay = `${offsetMs + index * 36}ms`
}

function createSummaryIcon(kind: "star" | "highlight" | "note") {
  const icon = document.createElement("span")
  icon.className = "inline-flex h-[0.95rem] w-[0.95rem] items-center justify-center"
  icon.setAttribute("aria-hidden", "true")
  icon.innerHTML = renderIcon(icons[kind], "h-[0.95rem] w-[0.95rem] stroke-[1.75]")
  return icon
}

function setStarButtonState(button: HTMLButtonElement | null, isStarred: boolean) {
  if (!button) return
  button.dataset.active = isStarred ? "true" : "false"
  button.setAttribute("aria-pressed", isStarred ? "true" : "false")
  button.setAttribute("aria-label", isStarred ? "Unstar chapter" : "Star chapter")
}

function setPageHeat(readerShell: HTMLElement | null, heat: number) {
  readerShell?.style.setProperty(
    "--page-heat",
    String(Math.max(0, Math.min(1, heat || 0))),
  )
}

function renderActivitySummary(
  container: HTMLElement | null,
  counts: Pick<ReaderState, "starCount" | "highlightCount" | "commentCount">,
) {
  if (!container) return
  container.innerHTML = ""

  const stats: Array<{ kind: "star" | "highlight" | "note"; count: number; label: string }> = [
    { kind: "star", count: counts.starCount, label: "stars" },
    { kind: "highlight", count: counts.highlightCount, label: "highlights" },
    { kind: "note", count: counts.commentCount, label: "notes" },
  ]

  for (const stat of stats) {
    const item = document.createElement("span")
    item.className = `${MARGIN_ITEM_CLASS} inline-flex items-center gap-[0.35rem] text-[rgba(78,78,78,0.9)]`
    item.setAttribute("aria-label", `${stat.count} ${stat.label}`)

    const count = document.createElement("span")
    count.className = "text-[0.92rem]"
    count.textContent = String(stat.count)

    item.append(createSummaryIcon(stat.kind), count)
    applyMarginaliaEntry(item, container.children.length, 18)
    container.append(item)
  }
}

function formatCommentDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp))
}

function relatedExcerpt(text: string) {
  const normalized = text
    .replace(/\s+/g, " ")
    .replace(/^(?:\d+\.\s*)+/, "")
    .trim()
  if (!normalized) return ""
  if (normalized.length <= 132) return normalized

  const shortened = normalized.slice(0, 129)
  const lastSpace = shortened.lastIndexOf(" ")
  return `${shortened.slice(0, lastSpace > 88 ? lastSpace : shortened.length).trim()}…`
}

function renderRelatedLinks(
  container: HTMLElement | null,
  related: ReaderRelated[],
  query: string,
) {
  if (!container) return
  container.innerHTML = ""

  if (related.length === 0) {
    const empty = document.createElement("li")
    empty.className = `${MARGIN_ITEM_CLASS} m-0 text-[0.92rem] leading-6 text-[rgba(78,78,78,0.82)]`
    empty.textContent = "No related chapters yet."
    container.append(empty)
    return
  }

  for (const item of related) {
    const entry = document.createElement("li")
    entry.className = `${MARGIN_ITEM_CLASS} border-t border-[rgba(128,128,128,0.12)] pt-3 first:border-t-0 first:pt-0`

    const sentence = relatedExcerpt(item.preview_text)

    const link = document.createElement("a")
    link.className = "block text-ink no-underline transition-colors hover:text-[rgba(40,40,40,0.92)] focus-visible:text-[rgba(40,40,40,0.92)] focus-visible:outline-none"
    link.href = chapterHref(item.slug, query)
    link.textContent = sentence || item.title

    entry.append(link)
    if (sentence && sentence !== item.title) {
      const title = document.createElement("p")
      title.className = "mt-1 text-[0.82rem] text-[rgba(115,115,115,0.95)]"
      title.textContent = item.title
      entry.append(title)
    }
    applyMarginaliaEntry(entry, container.children.length, 56)
    container.append(entry)
  }
}

function renderComments(container: HTMLElement | null, comments: ReaderComment[]) {
  if (!container) return
  container.innerHTML = ""

  if (comments.length === 0) {
    const empty = document.createElement("li")
    empty.className = `${MARGIN_ITEM_CLASS} m-0 text-[0.92rem] leading-6 text-[rgba(78,78,78,0.82)]`
    empty.textContent = "No notes yet."
    container.append(empty)
    return
  }

  for (const comment of comments) {
    const entry = document.createElement("li")
    entry.className = `${MARGIN_ITEM_CLASS} border-t border-[rgba(128,128,128,0.12)] pt-3 first:border-t-0 first:pt-0`

    const header = document.createElement("div")
    header.className = "flex items-start justify-between gap-3"

    const body = document.createElement("p")
    body.className = "m-0 min-w-0 flex-1 text-[0.92rem] leading-6 text-[rgba(78,78,78,0.82)]"
    body.textContent = comment.body

    header.append(body)

    if (comment.can_delete) {
      const remove = document.createElement("button")
      remove.type = "button"
      remove.className = "reader-comment-delete"
      remove.dataset.commentDelete = "true"
      remove.dataset.commentId = comment.id
      remove.setAttribute("aria-label", "Delete note")
      remove.innerHTML = renderIcon(icons.trash, "h-[0.82rem] w-[0.82rem] stroke-[1.8]")
      header.append(remove)
    }

    const meta = document.createElement("p")
    meta.className = "mt-[0.3rem] text-[0.78rem] tracking-[0.01em] text-[rgba(78,78,78,0.82)]"
    meta.textContent = formatCommentDate(comment.created_at)

    entry.append(header, meta)
    applyMarginaliaEntry(entry, container.children.length, 92)
    container.append(entry)
  }
}

export function setupHomePage(signal: AbortSignal) {
  const startRandomLink = document.querySelector<HTMLAnchorElement>("#start-random")
  const searchForm = document.querySelector<HTMLFormElement>("#search-form")
  const searchInput = document.querySelector<HTMLInputElement>("#search-query")
  const searchClear = document.querySelector<HTMLButtonElement>("[data-search-clear]")

  attachSearchFieldBehavior(searchInput, searchClear, signal)

  startRandomLink?.addEventListener(
    "click",
    async (event) => {
      event.preventDefault()
      const slugs = await getAllSlugs()
      const order = shuffle(slugs)
      sessionStorage.setItem(orderStorageKey(""), JSON.stringify(order))
      await navigateToChapter(chapterHref(order[0]))
    },
    { signal },
  )

  searchForm?.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault()

      const nextHref = await startSearchSession(searchInput?.value || "")
      if (nextHref) {
        await navigateToChapter(nextHref)
        return
      }

      if (searchInput) {
        searchInput.value = ""
        searchInput.placeholder = "No matches"
      }
    },
    { signal },
  )
}

export function setupReaderPage(signal: AbortSignal) {
  let isNavigating = false
  let renderedStateSignature = ""
  const slug = document.querySelector<HTMLElement>("[data-reader-slug]")
    ?.dataset.readerSlug || ""
  const readerShell = document.querySelector<HTMLElement>("#reader-shell")
  const articleBody = document.querySelector<HTMLElement>(".book-page")
  const prevLink = document.querySelector<HTMLAnchorElement>("#prev-link")
  const nextLink = document.querySelector<HTMLAnchorElement>("#next-link")
  const starToggle = document.querySelector<HTMLButtonElement>("#star-toggle")
  const highlightTooltip = document.querySelector<HTMLElement>(
    "#highlight-tooltip",
  )
  const saveHighlightButton =
    document.querySelector<HTMLButtonElement>("#save-highlight")
  const searchSelectionButton = document.querySelector<HTMLButtonElement>(
    "#search-selection",
  )
  const searchForm = document.querySelector<HTMLFormElement>("#search-form")
  const searchInput = document.querySelector<HTMLInputElement>("#search-query")
  const searchClear = document.querySelector<HTMLButtonElement>("[data-search-clear]")
  const activitySummary = document.querySelector<HTMLElement>(
    "#reader-activity-summary",
  )
  const relatedList = document.querySelector<HTMLElement>("#related-links-list")
  const commentForm = document.querySelector<HTMLFormElement>("#comment-form")
  const commentInput = document.querySelector<HTMLTextAreaElement>("#comment-body")
  const commentStatus = document.querySelector<HTMLElement>("#comment-status")
  const commentList = document.querySelector<HTMLElement>("#comment-list")
  const query = normalizeQuery(
    new URLSearchParams(window.location.search).get("q") || "",
  )

  attachSearchFieldBehavior(searchInput, searchClear, signal)

  if (articleBody) {
    articleBody.setAttribute("data-original-html", articleBody.innerHTML)
    restoreHighlights(articleBody, slug, query)
  }
  setStarButtonState(starToggle, hasStoredStar(slug))

  async function readOrder() {
    return query
      ? resolveSearchOrder(query, slug)
      : resolveSavedOrder()
  }

  async function updateNavigation() {
    const order = await readOrder()
    const currentIndex = Math.max(0, order.indexOf(slug))
    const prevSlug = order[(currentIndex - 1 + order.length) % order.length]
    const nextSlug = order[(currentIndex + 1) % order.length]
    const prevHref = chapterHref(prevSlug, query)
    const nextHref = chapterHref(nextSlug, query)

    prevLink?.setAttribute("href", prevHref)
    nextLink?.setAttribute("href", nextHref)

    prefetchChapterDocument(prevHref, signal)
    prefetchChapterDocument(nextHref, signal)
    prefetchReaderState(prevSlug, signal)
    prefetchReaderState(nextSlug, signal)
  }

  async function go(delta: number) {
    if (isNavigating) return
    isNavigating = true

    try {
      const order = await readOrder()
      const currentIndex = Math.max(0, order.indexOf(slug))
      await navigateToChapter(
        chapterHref(
          order[(currentIndex + delta + order.length) % order.length],
          query,
        ),
      )
    } catch {
      isNavigating = false
    }
  }

  function renderReaderState(state: ReaderState) {
    const nextSignature = getReaderStateSignature(state)
    if (nextSignature === renderedStateSignature) return

    renderedStateSignature = nextSignature
    setPageHeat(readerShell, state.heat)
    renderActivitySummary(
      activitySummary,
      state,
    )
    renderRelatedLinks(relatedList, state.related, query)
    renderComments(commentList, state.comments)
  }

  async function refreshReaderState() {
    const cachedState = readCachedReaderState(slug)
    if (cachedState) {
      renderReaderState(cachedState)
    }

    try {
      const state = await fetchReaderState(slug, signal)
      renderReaderState(state)
    } catch {
      if (signal.aborted) return
      if (cachedState) return
      setText(
        activitySummary,
        "Connect D1 to show shared highlights, notes, and related chapters.",
      )
    }
  }

  document.addEventListener(
    "selectionchange",
    () => {
      if (!articleBody || !highlightTooltip) return

      const selectionState = getSelectionState(articleBody)
      if (!selectionState) {
        hideTooltip(highlightTooltip)
        return
      }

      showTooltip(highlightTooltip, selectionState.rect)
    },
    { signal },
  )

  highlightTooltip?.addEventListener(
    "mousedown",
    (event) => {
      event.preventDefault()
    },
    { signal },
  )

  saveHighlightButton?.addEventListener(
    "click",
    async () => {
      if (!articleBody || !highlightTooltip) return

      const selectionState = getSelectionState(articleBody)
      if (selectionState) {
        saveHighlightRange(slug, selectionState.start, selectionState.end)
        try {
          await fetchJson(`${BASE_URL}api/highlights`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              slug,
              startOffset: selectionState.start,
              endOffset: selectionState.end,
            }),
            signal,
          })
        } catch {
          // Local highlights still work without the shared D1 backend.
        }
      }

      window.getSelection()?.removeAllRanges()
      hideTooltip(highlightTooltip)
      restoreHighlights(articleBody, slug, query)
      void refreshReaderState()
    },
    { signal },
  )

  searchSelectionButton?.addEventListener(
    "click",
    async () => {
      if (isNavigating) return
      if (!highlightTooltip) return

      const nextQuery = window.getSelection()?.toString() || ""
      window.getSelection()?.removeAllRanges()
      hideTooltip(highlightTooltip)

      const nextHref = await startSearchSession(nextQuery)
      if (nextHref) {
        isNavigating = true
        await navigateToChapter(nextHref)
      }
    },
    { signal },
  )

  searchForm?.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault()
      if (isNavigating) return

      const nextQuery = searchInput?.value || ""
      if (!normalizeQuery(nextQuery)) {
        isNavigating = true
        await navigateToChapter(chapterHref(slug))
        return
      }

      const nextHref = await startSearchSession(nextQuery)
      if (nextHref) {
        isNavigating = true
        await navigateToChapter(nextHref)
        return
      }

      if (searchInput) {
        searchInput.value = ""
        searchInput.placeholder = "none"
      }
    },
    { signal },
  )

  commentForm?.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault()
      if (isNavigating || !commentInput) return

      const body = commentInput.value.trim()
      if (!body) {
        setText(commentStatus, "Write a note before posting.")
        return
      }

      commentInput.disabled = true
      setText(commentStatus, "Posting...")

      try {
        await fetchJson(`${BASE_URL}api/comments`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            slug,
            body,
          }),
          signal,
        })

        commentInput.value = ""
        setText(commentStatus, "Posted.")
        await refreshReaderState()
      } catch {
        if (!signal.aborted) {
          setText(
            commentStatus,
            "Could not post. Check the D1 binding or rate limit settings.",
          )
        }
      } finally {
        commentInput.disabled = false
      }
    },
    { signal },
  )

  commentList?.addEventListener(
    "click",
    async (event) => {
      if (isNavigating) return

      const target = event.target
      if (!(target instanceof Element)) return

      const deleteButton = target.closest<HTMLButtonElement>("[data-comment-delete]")
      if (!deleteButton || deleteButton.disabled) return

      event.preventDefault()
      const commentId = deleteButton.dataset.commentId
      if (!commentId) return

      deleteButton.disabled = true
      setText(commentStatus, "Deleting...")

      try {
        await fetchJson(`${BASE_URL}api/comments?id=${encodeURIComponent(commentId)}`, {
          method: "DELETE",
          signal,
        })
        setText(commentStatus, "Deleted.")
        await refreshReaderState()
      } catch {
        if (!signal.aborted) {
          deleteButton.disabled = false
          setText(commentStatus, "Could not delete note. Refresh and try again.")
        }
      }
    },
    { signal },
  )

  starToggle?.addEventListener(
    "click",
    async (event) => {
      event.preventDefault()
      event.stopPropagation()

      const nextStarred = !hasStoredStar(slug)
      setStoredStar(slug, nextStarred)
      setStarButtonState(starToggle, nextStarred)

      try {
        if (nextStarred) {
          await fetchJson(`${BASE_URL}api/stars`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ slug }),
            signal,
          })
        } else {
          await fetchJson(`${BASE_URL}api/stars?slug=${encodeURIComponent(slug)}`, {
            method: "DELETE",
            signal,
          })
        }
        await refreshReaderState()
      } catch {
        if (!signal.aborted) {
          setStoredStar(slug, !nextStarred)
          setStarButtonState(starToggle, !nextStarred)
        }
      }
    },
    { signal },
  )

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "ArrowLeft" || event.key === "k") {
        event.preventDefault()
        void go(-1)
      }

      if (event.key === "ArrowRight" || event.key === "j") {
        event.preventDefault()
        void go(1)
      }

      if (event.key === "Escape") {
        window.getSelection()?.removeAllRanges()
        hideTooltip(highlightTooltip)
      }
    },
    { signal },
  )

  prevLink?.addEventListener(
    "click",
    (event) => {
      event.preventDefault()
      void go(-1)
    },
    { signal },
  )

  nextLink?.addEventListener(
    "click",
    (event) => {
      event.preventDefault()
      void go(1)
    },
    { signal },
  )

  document.addEventListener(
    "click",
    (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        hasActiveTextSelection() ||
        isInteractiveTarget(event.target)
      ) {
        return
      }

      event.preventDefault()
      void go(event.clientX < window.innerWidth / 2 ? -1 : 1)
    },
    { signal },
  )

  void updateNavigation()
  void refreshReaderState()
}

export function setupStarsPage(_signal: AbortSignal) {
  const starsList = document.querySelector<HTMLElement>("#stars-list")
  if (!starsList) return

  async function renderStars() {
    const starred = new Set(readStoredStars())
    if (starred.size === 0) {
      starsList.innerHTML = '<p class="m-0 text-[0.92rem] leading-6 text-[rgba(78,78,78,0.82)]">No starred chapters yet.</p>'
      return
    }

    const fragments = await fragmentIndexPromise
    const entries = fragments
      .filter((fragment) => starred.has(fragment.slug))
      .sort((left, right) => left.canonicalOrder - right.canonicalOrder)

    if (entries.length === 0) {
      starsList.innerHTML = '<p class="m-0 text-[0.92rem] leading-6 text-[rgba(78,78,78,0.82)]">No starred chapters yet.</p>'
      return
    }

    starsList.innerHTML = ""
    for (const fragment of entries) {
      const article = document.createElement("article")
      article.className = "border-t border-[rgba(128,128,128,0.14)] pt-6 first:border-t-0 first:pt-0"

      const header = document.createElement("div")
      header.className = "mb-4 flex items-baseline justify-between gap-4"

      const link = document.createElement("a")
      link.className = "text-ink no-underline transition-colors hover:text-[rgba(55,55,55,0.92)] focus-visible:text-[rgba(55,55,55,0.92)] focus-visible:outline-none"
      link.href = fragment.path
      link.textContent = fragment.title

      header.append(link)

      const body = document.createElement("div")
      body.className = "book-page"
      body.innerHTML = fragment.bodyHtml

      article.append(header, body)
      starsList.append(article)
    }
  }

  void renderStars()
}

export function setupCurrentPage() {
  activePageController?.abort()
  activePageController = new AbortController()

  if (document.querySelector("#reader-shell")) {
    setupReaderPage(activePageController.signal)
    return
  }

  if (document.querySelector("#stars-list")) {
    setupStarsPage(activePageController.signal)
    return
  }

  if (document.querySelector("#start-random")) {
    setupHomePage(activePageController.signal)
  }
}
