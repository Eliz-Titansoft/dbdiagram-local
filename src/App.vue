<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SchemaCanvas from './components/SchemaCanvas.vue'
import SidePanel from './components/SidePanel.vue'
import { visibleGraph } from './lib/graph'
import { layoutGraph, type Layout } from './lib/layout'
import { parseDbml, type ParseError, type Schema } from './lib/schema'

// Where the DBML came from, for the header: the dev server's file, a picked file, the
// published schema.dbml or the sample.
const sourceName = ref('')
const schema = ref<Schema | null>(null)
const errors = ref<ParseError[]>([])

// View state, mirrored into the URL so a link reopens the same view.
const focus = ref<string | null>(null)
const hops = ref(1)
const hideAudit = ref(true)
const compact = ref(false)
const query = ref('')
const highlightColumn = ref('')
const hiddenGroups = ref<Set<string>>(new Set())
const selected = ref<string | null>(null)

const MAX_FILE_BYTES = 20 * 1024 * 1024

function load(source: string, name: string) {
  const result = parseDbml(source)
  if ('errors' in result) {
    errors.value = result.errors
    return
  }
  errors.value = []
  schema.value = result.schema
  sourceName.value = name
  // A view from the URL may name tables or groups this file does not have.
  const has = (t: string | null) => t !== null && result.schema.tables.some((x) => x.name === t)
  if (!has(focus.value)) {
    focus.value = null
    hops.value = 1
  }
  if (!has(selected.value)) selected.value = null
  hiddenGroups.value = new Set([...hiddenGroups.value].filter((g) => result.schema.groups.includes(g)))
}

// Three places a schema can come from, tried in order: the dev server's DBML_FILE, a
// schema.dbml published next to the page, then a file the user opens or drops.
const base = import.meta.env.BASE_URL
async function loadFromDevServer(): Promise<boolean> {
  const res = await fetch(`${base}__dbml`)
  if (!res.ok) return false
  load(await res.text(), res.headers.get('X-Dbml-File') ?? 'DBML_FILE')
  return true
}
async function loadPublished(): Promise<boolean> {
  const res = await fetch(`${base}schema.dbml`, { cache: 'no-cache' })
  // A dev server answers a missing file with the app's index page, not a 404.
  if (!res.ok || res.headers.get('content-type')?.includes('text/html')) return false
  load(await res.text(), 'schema.dbml')
  return true
}
async function loadSample() {
  const res = await fetch(`${base}sample.dbml`)
  load(await res.text(), 'sample.dbml')
}
async function loadFile(file: File) {
  if (file.size > MAX_FILE_BYTES) {
    errors.value = [{ message: `${file.name} is ${(file.size / 1048576).toFixed(0)} MB. A DBML file is text and rarely over 1 MB. Pick the schema file, not an export.`, line: 0, column: 0 }]
    return
  }
  load(await file.text(), file.name)
}
async function openFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await loadFile(file)
  input.value = ''
}
async function onDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0]
  if (file) await loadFile(file)
}

const isNarrow = ref(false)
const narrowQuery = window.matchMedia('(max-width: 899px)')
const onNarrow = () => (isNarrow.value = narrowQuery.matches)

onMounted(async () => {
  readUrl()
  onNarrow()
  narrowQuery.addEventListener('change', onNarrow)
  window.addEventListener('keydown', onKey)
  // With no file from the dev server or beside the page, the empty state asks for one
  // rather than drawing a sample that could pass for real data.
  if (!(await loadFromDevServer())) await loadPublished()
  if (import.meta.hot) import.meta.hot.on('dbml:changed', loadFromDevServer)
})
onBeforeUnmount(() => {
  narrowQuery.removeEventListener('change', onNarrow)
  window.removeEventListener('keydown', onKey)
})

const groups = computed(() => schema.value?.groups ?? [])
const shownGroups = computed(() => (hiddenGroups.value.size ? new Set(groups.value.filter((g) => !hiddenGroups.value.has(g))) : null))
// The chips work like a mixer's mute and solo: click hides or shows one group, double-click
// or Alt+click shows only that group, and All brings every group back. In solo, a plain
// click on another chip adds it to the shown set.
function toggleGroup(g: string) {
  const next = new Set(hiddenGroups.value)
  if (next.has(g)) next.delete(g)
  else next.add(g)
  hiddenGroups.value = next
}
function soloGroup(g: string) {
  const others = groups.value.filter((x) => x !== g)
  const alreadySolo = others.length === hiddenGroups.value.size && others.every((x) => hiddenGroups.value.has(x))
  hiddenGroups.value = alreadySolo ? new Set() : new Set(others)
}
function showAllGroups() {
  hiddenGroups.value = new Set()
}
function onGroupClick(e: MouseEvent, g: string) {
  if (e.altKey) soloGroup(g)
  else toggleGroup(g)
}

const visible = computed(() =>
  schema.value ? visibleGraph(schema.value, { focus: focus.value, hops: hops.value, hideAudit: hideAudit.value, groups: shownGroups.value, query: query.value }) : null,
)
const nothingShown = computed(() => visible.value !== null && visible.value.tables.length === 0)
function clearNarrowing() {
  query.value = ''
  hiddenGroups.value = new Set()
  focus.value = null
}

// Layout runs only when the shown graph changes; the canvas refits only when its table
// set changes, so audit and keys-only toggles keep the zoom.
const layout = ref<Layout | null>(null)
const laying = ref(false)
let run = 0
watch(
  [visible, compact],
  async ([v, c]) => {
    if (!v) return
    const id = ++run
    laying.value = true
    const next = await layoutGraph(v.tables, v.refs, c)
    if (id === run) {
      layout.value = next
      laying.value = false
    }
  },
  { immediate: true },
)
const fitKey = computed(() => (visible.value ? visible.value.tables.map((t) => t.name).sort().join(',') : ''))

const selectedTable = computed(() => schema.value?.tables.find((t) => t.name === selected.value) ?? null)
const canvas = ref<InstanceType<typeof SchemaCanvas> | null>(null)
const filterInput = ref<HTMLInputElement | null>(null)
function select(name: string) {
  selected.value = name
}
function focusOn(name: string) {
  focus.value = name
  selected.value = name
}
function clearFocus() {
  focus.value = null
}
// The header and chips sit before the canvas in the tab order; this jumps past them.
function skipToDiagram() {
  const card = document.querySelector<SVGGElement>('[data-card].root') ?? document.querySelector<SVGGElement>('[data-card]')
  card?.focus()
}

// Keyboard: Escape backs out one step, slash jumps to the filter, F or Ctrl+0 fits,
// plus and minus zoom. Typing in a field is left alone.
function onKey(e: KeyboardEvent) {
  const typing = (e.target as HTMLElement | null)?.matches('input:not([type=checkbox]), select, textarea')
  if (e.key === 'Escape') {
    if (typing) (e.target as HTMLElement).blur()
    else if (selected.value) selected.value = null
    else if (focus.value) focus.value = null
    return
  }
  if (typing) return
  if (e.key === '/') {
    e.preventDefault()
    filterInput.value?.focus()
  } else if (e.key === 'f' || e.key === 'F' || (e.ctrlKey && e.key === '0')) {
    e.preventDefault()
    canvas.value?.fit()
  } else if (e.key === '+' || e.key === '=') {
    canvas.value?.zoomBy(1.25)
  } else if (e.key === '-') {
    canvas.value?.zoomBy(0.8)
  }
}

function readUrl() {
  const p = new URLSearchParams(location.search)
  focus.value = p.get('focus')
  hops.value = Number(p.get('hops') ?? 1) || 1
  hideAudit.value = p.get('audit') !== '1'
  compact.value = p.get('compact') === '1'
  hiddenGroups.value = new Set((p.get('hide') ?? '').split(',').filter(Boolean))
  query.value = p.get('q') ?? ''
  selected.value = p.get('sel') ?? p.get('focus')
}
watch([focus, hops, hideAudit, compact, hiddenGroups, query, selected], () => {
  const p = new URLSearchParams()
  if (focus.value) p.set('focus', focus.value)
  if (hops.value !== 1) p.set('hops', String(hops.value))
  if (!hideAudit.value) p.set('audit', '1')
  if (compact.value) p.set('compact', '1')
  if (hiddenGroups.value.size) p.set('hide', [...hiddenGroups.value].join(','))
  if (query.value.trim()) p.set('q', query.value.trim())
  if (selected.value && selected.value !== focus.value) p.set('sel', selected.value)
  const qs = p.toString()
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname)
})

// One line that says what is on screen, read aloud by screen readers as it changes.
const status = computed(() => {
  if (!schema.value || !visible.value) return ''
  const parts: string[] = []
  parts.push(focus.value ? `${focus.value} + ${hops.value} hop${hops.value === 1 ? '' : 's'}` : 'whole schema')
  if (hideAudit.value) parts.push('audit links hidden')
  if (hiddenGroups.value.size) parts.push(`${groups.value.length - hiddenGroups.value.size} of ${groups.value.length} groups`)
  parts.push(`${visible.value.tables.length} of ${schema.value.tables.length} tables, ${visible.value.refs.length} links`)
  if (laying.value) parts.push('laying out…')
  return parts.join(' · ')
})
const highlightCount = computed(() => {
  const q = highlightColumn.value.trim().toLowerCase()
  if (!q || !visible.value) return null
  return visible.value.tables.reduce((n, t) => n + t.columns.filter((c) => c.name.toLowerCase().includes(q)).length, 0)
})
</script>

<template>
  <div class="app" @dragover.prevent @drop.prevent="onDrop">
    <header class="bar">
      <button v-if="schema" class="skip" @click="skipToDiagram">Skip to diagram</button>
      <div class="row">
        <strong class="title">DBML viewer</strong>
        <span v-if="sourceName" class="source" :title="sourceName">{{ sourceName }}</span>
        <label class="btn file">
          Open file
          <input class="sr-only" type="file" accept=".dbml,.txt" @change="openFile" />
        </label>
        <template v-if="schema">
          <span class="sep" />
          <label class="field">
            <span class="sr-only">Filter tables by name or column</span>
            <input ref="filterInput" v-model="query" class="search" placeholder="Filter tables by name or column  /" />
          </label>
          <label class="field">
            <span class="sr-only">Highlight column</span>
            <input v-model="highlightColumn" class="search" placeholder="Highlight column" />
            <span v-if="highlightCount !== null" class="field-count">{{ highlightCount }}</span>
          </label>
        </template>
      </div>
      <div v-if="schema" class="row tools">
        <label class="opt"><input v-model="hideAudit" type="checkbox" /> hide audit links</label>
        <label class="opt"><input v-model="compact" type="checkbox" /> keys only</label>
        <label class="opt" :title="focus ? '' : 'Pick a focus table first'">
          hops
          <select v-model.number="hops" :disabled="!focus" aria-label="Hops from the focus table">
            <option :value="1">1</option>
            <option :value="2">2</option>
            <option :value="3">3</option>
          </select>
        </label>
        <button v-if="focus" class="chip" :aria-label="`Clear focus on ${focus}`" @click="clearFocus">focus: {{ focus }} <span aria-hidden="true">×</span></button>
        <button class="btn" title="Fit the diagram to the window (F)" @click="canvas?.fit()">Fit</button>
        <span class="status" aria-live="polite">{{ status }}</span>
      </div>
    </header>

    <div v-if="groups.length > 1" class="groups">
      <div class="chips">
        <button class="group all" :class="{ on: hiddenGroups.size === 0 }" :aria-pressed="hiddenGroups.size === 0" title="Show every group" @click="showAllGroups">All</button>
        <button
          v-for="g in groups"
          :key="g"
          class="group"
          :class="{ off: hiddenGroups.has(g) }"
          :aria-pressed="!hiddenGroups.has(g)"
          @click="onGroupClick($event, g)"
          @dblclick.prevent="soloGroup(g)"
        >
          {{ g }}
        </button>
      </div>
      <p class="legend">Click a group to hide it. Double-click or Alt+click shows only that group. All brings every group back.</p>
    </div>

    <div v-if="errors.length" class="errors" role="alert">
      <p><strong>The DBML did not load.</strong><template v-if="schema"> The previous schema stays on screen.</template></p>
      <ul>
        <li v-for="(e, i) in errors" :key="i"><template v-if="e.line">line {{ e.line }}, column {{ e.column }}: </template>{{ e.message }}</li>
      </ul>
    </div>

    <main v-if="schema" class="main" :class="{ narrow: isNarrow }">
      <div class="canvas-wrap">
        <SchemaCanvas
          ref="canvas"
          :layout="layout"
          :groups="groups"
          :selected="selected"
          :focus-root="focus"
          :highlight-column="highlightColumn"
          :compact="compact"
          :fit-key="fitKey"
          @select="select"
          @focus="focusOn"
        />
        <div v-if="nothingShown" class="nothing">
          <p>
            <strong>No table matches.</strong>
            <template v-if="query.trim()"> Nothing is named or has a column like "{{ query.trim() }}"</template><template v-if="hiddenGroups.size"> within the groups shown</template>.
          </p>
          <button class="btn primary" @click="clearNarrowing">Clear filter and show every group</button>
        </div>
      </div>
      <SidePanel v-if="!isNarrow || selectedTable" :schema="schema" :table="selectedTable" :drawer="isNarrow" @go="select" @focus="focusOn" @close="selected = null" />
    </main>
    <main v-else class="main empty">
      <div class="empty-card">
        <h2>No schema loaded</h2>
        <p>Open a <code>.dbml</code> file, or drop one anywhere on this page.</p>
        <label class="btn primary file">
          Open file
          <input class="sr-only" type="file" accept=".dbml,.txt" @change="openFile" />
        </label>
        <p class="muted">
          Running locally? Start the dev server with <code>DBML_FILE=path/to/schema.dbml npm run dev</code> and the file loads by itself, and reloads when you save it.
        </p>
        <p class="muted">
          Just looking? <button class="link" @click="loadSample">Try the sample schema</button>
        </p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-rows: auto auto auto 1fr;
  height: 100vh;
}
.bar {
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--card);
  font-size: 13px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.row.tools {
  margin-top: 6px;
}
/* Visible only while focused, so keyboard users get it and nobody else sees it. */
.skip {
  position: absolute;
  left: 14px;
  top: 8px;
  padding: 4px 10px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--card);
  color: var(--accent-fg);
  opacity: 0;
  pointer-events: none;
  z-index: 10;
}
.skip:focus-visible {
  opacity: 1;
  pointer-events: auto;
}
@media (max-width: 899px) {
  .source,
  .sep,
  .field:last-of-type {
    display: none;
  }
  .search {
    width: 100%;
  }
  .field {
    flex: 1 1 100%;
  }
  .status {
    flex-basis: 100%;
    margin-left: 0;
  }
}
.title {
  font-size: 14px;
  font-weight: 600;
}
.source {
  max-width: min(320px, 40vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 12px;
}
.sep {
  width: 1px;
  height: 20px;
  background: var(--border);
}
.field {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.search {
  width: 230px;
  max-width: 100%;
  padding: 5px 9px;
  border: 1px solid var(--input);
  border-radius: 6px;
  background: var(--card);
}
.search::placeholder {
  color: var(--muted);
}
.field-count {
  position: absolute;
  right: 8px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-fg);
  font-size: 11.5px;
  font-weight: 600;
  line-height: 18px;
}
.opt {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.opt select {
  padding: 2px 4px;
  border: 1px solid var(--input);
  border-radius: 4px;
  background: var(--card);
}
.chip {
  padding: 2px 10px;
  border: 1px solid var(--accent);
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-fg);
  font-family: var(--mono);
  cursor: pointer;
}
.btn {
  display: inline-block;
  padding: 4px 11px;
  border: 1px solid var(--input);
  border-radius: 6px;
  background: var(--card);
  color: var(--fg);
  cursor: pointer;
}
.btn:hover {
  background: var(--bg);
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.btn.primary:hover {
  filter: brightness(1.08);
}
.file:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.status {
  margin-left: auto;
  color: var(--muted);
}
.groups {
  padding: 6px 14px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--card);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.group {
  padding: 2px 9px;
  border: 1px solid var(--input);
  border-radius: 999px;
  background: var(--card);
  font: 12px/1.5 var(--mono);
  cursor: pointer;
}
.group:hover {
  background: var(--bg);
}
.group.off {
  opacity: 0.45;
  text-decoration: line-through;
}
/* Always in the row so the chips never shift. Pressed while every group shows, and an
   action the moment one is hidden. */
.group.all {
  margin-right: 4px;
  border-color: var(--accent);
  background: var(--card);
  color: var(--accent-fg);
  font-family: var(--sans);
  font-weight: 600;
}
.group.all.on {
  background: var(--accent);
  color: #fff;
  cursor: default;
}
.legend {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.errors {
  padding: 8px 14px;
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 13px;
}
.errors ul {
  margin: 4px 0 0;
}
.main {
  /* Pinned to the 1fr row: the groups and errors rows are conditional, so without this
     the canvas would slide up into an auto row and take only its content's height. */
  grid-row: 4;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 34%);
  min-height: 0;
}
.main.narrow {
  grid-template-columns: minmax(0, 1fr);
}
.canvas-wrap {
  position: relative;
  min-width: 0;
  min-height: 0;
}
.nothing {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 10px;
  text-align: center;
  padding: 24px;
}
.nothing p {
  margin: 0;
}
.main.empty {
  display: grid;
  grid-template-columns: 1fr;
  place-items: center;
  background: var(--bg);
}
.empty-card {
  max-width: 520px;
  margin: 16px;
  padding: 28px 32px;
  border: 1px dashed var(--input);
  border-radius: 10px;
  background: var(--card);
  text-align: center;
}
.empty-card h2 {
  margin: 0 0 8px;
  font: 600 18px/1.3 var(--sans);
}
.empty-card p {
  margin: 8px 0;
}
.empty-card code {
  font-family: var(--mono);
  font-size: 12px;
}
.empty-card .btn.primary {
  margin: 10px 0;
  padding: 7px 16px;
}
.muted {
  color: var(--muted);
  font-size: 13px;
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-fg);
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}
</style>
