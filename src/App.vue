<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import SchemaCanvas from './components/SchemaCanvas.vue'
import SidePanel from './components/SidePanel.vue'
import { visibleGraph } from './lib/graph'
import { layoutGraph, type Layout } from './lib/layout'
import { parseDbml, type ParseError, type Schema } from './lib/schema'

// Where the DBML came from, for the header: the dev server's file, a picked file or
// the bundled sample.
const sourceName = ref('sample.dbml')
const schema = ref<Schema | null>(null)
const errors = ref<ParseError[]>([])

// View state. Focus, hops, audit and compact are mirrored into the URL so a link
// reopens the same view.
const focus = ref<string | null>(null)
const hops = ref(1)
const hideAudit = ref(true)
const compact = ref(false)
const query = ref('')
const highlightColumn = ref('')
const hiddenGroups = ref<Set<string>>(new Set())
const selected = ref<string | null>(null)

function load(source: string, name: string) {
  const result = parseDbml(source)
  if ('errors' in result) {
    errors.value = result.errors
    return
  }
  errors.value = []
  schema.value = result.schema
  sourceName.value = name
  if (focus.value && !result.schema.tables.some((t) => t.name === focus.value)) focus.value = null
  if (selected.value && !result.schema.tables.some((t) => t.name === selected.value)) selected.value = null
}

async function loadFromDevServer(): Promise<boolean> {
  const res = await fetch('/__dbml')
  if (!res.ok) return false
  load(await res.text(), res.headers.get('X-Dbml-File') ?? 'DBML_FILE')
  return true
}
async function loadSample() {
  const res = await fetch('/sample.dbml')
  load(await res.text(), 'sample.dbml')
}
async function openFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) load(await file.text(), file.name)
}
async function onDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0]
  if (file) load(await file.text(), file.name)
}

onMounted(async () => {
  readUrl()
  if (!(await loadFromDevServer())) await loadSample()
  if (import.meta.hot) import.meta.hot.on('dbml:changed', loadFromDevServer)
})

const groups = computed(() => schema.value?.groups ?? [])
const shownGroups = computed(() => (hiddenGroups.value.size ? new Set(groups.value.filter((g) => !hiddenGroups.value.has(g))) : null))
function toggleGroup(g: string) {
  const next = new Set(hiddenGroups.value)
  if (next.has(g)) next.delete(g)
  else next.add(g)
  hiddenGroups.value = next
}

const visible = computed(() =>
  schema.value ? visibleGraph(schema.value, { focus: focus.value, hops: hops.value, hideAudit: hideAudit.value, groups: shownGroups.value, query: query.value }) : null,
)

// Layout runs off the main thread's critical path and only when the shown graph changes.
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

const selectedTable = computed(() => schema.value?.tables.find((t) => t.name === selected.value) ?? null)
const canvas = ref<InstanceType<typeof SchemaCanvas> | null>(null)
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

function readUrl() {
  const p = new URLSearchParams(location.search)
  focus.value = p.get('focus')
  hops.value = Number(p.get('hops') ?? 1) || 1
  hideAudit.value = p.get('audit') !== '1'
  compact.value = p.get('compact') === '1'
  selected.value = p.get('focus')
}
watch([focus, hops, hideAudit, compact], () => {
  const p = new URLSearchParams()
  if (focus.value) p.set('focus', focus.value)
  if (hops.value !== 1) p.set('hops', String(hops.value))
  if (!hideAudit.value) p.set('audit', '1')
  if (compact.value) p.set('compact', '1')
  const qs = p.toString()
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname)
})

const counts = computed(() => ({ shown: visible.value?.tables.length ?? 0, all: schema.value?.tables.length ?? 0, refs: visible.value?.refs.length ?? 0 }))
</script>

<template>
  <div class="app" @dragover.prevent @drop.prevent="onDrop">
    <header class="bar">
      <strong class="title">DBML viewer</strong>
      <span class="source" :title="sourceName">{{ sourceName }}</span>
      <label class="file">
        Open file
        <input type="file" accept=".dbml,.txt" @change="openFile" />
      </label>
      <span class="sep" />
      <input v-model="query" class="search" placeholder="Filter tables by name or column" />
      <input v-model="highlightColumn" class="search" placeholder="Highlight column" />
      <span class="sep" />
      <label class="opt"><input v-model="hideAudit" type="checkbox" /> hide audit links</label>
      <label class="opt"><input v-model="compact" type="checkbox" /> keys only</label>
      <label class="opt">
        hops
        <select v-model.number="hops" :disabled="!focus">
          <option :value="1">1</option>
          <option :value="2">2</option>
          <option :value="3">3</option>
        </select>
      </label>
      <button v-if="focus" class="chip" @click="clearFocus">focus: {{ focus }} ×</button>
      <button class="btn" @click="canvas?.fit()">Fit</button>
      <span class="count">{{ counts.shown }} / {{ counts.all }} tables, {{ counts.refs }} links<template v-if="laying">, laying out...</template></span>
    </header>

    <div v-if="groups.length > 1" class="groups">
      <button v-for="g in groups" :key="g" class="group" :class="{ off: hiddenGroups.has(g) }" @click="toggleGroup(g)">{{ g }}</button>
    </div>

    <div v-if="errors.length" class="errors">
      <p><strong>The DBML did not parse.</strong> The previous schema stays on screen.</p>
      <ul>
        <li v-for="(e, i) in errors" :key="i">line {{ e.line }}, column {{ e.column }}: {{ e.message }}</li>
      </ul>
    </div>

    <main class="main">
      <SchemaCanvas ref="canvas" :layout="layout" :groups="groups" :selected="selected" :highlight-column="highlightColumn" :compact="compact" @select="select" @focus="focusOn" />
      <SidePanel v-if="schema" :schema="schema" :table="selectedTable" @go="select" @focus="focusOn" @close="selected = null" />
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
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--card);
  font-size: 13px;
}
.title {
  font-size: 14px;
}
.source {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 12px;
}
.file {
  cursor: pointer;
  color: var(--accent);
}
.file input {
  display: none;
}
.sep {
  width: 1px;
  height: 20px;
  background: var(--border);
}
.search {
  width: 220px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
}
.opt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.chip {
  padding: 2px 8px;
  border: 1px solid var(--accent);
  border-radius: 999px;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-family: var(--mono);
  cursor: pointer;
}
.btn {
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  cursor: pointer;
}
.count {
  margin-left: auto;
  color: var(--muted);
}
.groups {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--card);
}
.group {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg);
  color: var(--fg);
  font: 12px/1.4 var(--mono);
  cursor: pointer;
}
.group.off {
  opacity: 0.4;
  text-decoration: line-through;
}
.errors {
  padding: 8px 12px;
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 13px;
}
.errors ul {
  margin: 4px 0 0;
}
.main {
  display: grid;
  grid-template-columns: 1fr 460px;
  min-height: 0;
}
</style>
