<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { groupColour } from '../lib/graph'
import { CARD_PADDING, HEADER_HEIGHT, ROW_HEIGHT, isKeyColumn, type Layout } from '../lib/layout'
import type { Column, Table } from '../lib/schema'

const props = defineProps<{
  layout: Layout | null
  groups: string[]
  selected: string | null
  focusRoot: string | null
  highlightColumn: string
  compact: boolean
  // Changes when the set of shown tables changes. The canvas refits only then, so a
  // toggle that redraws the same tables keeps the user's zoom and pan.
  fitKey: string
}>()
const emit = defineEmits<{ select: [table: string]; focus: [table: string] }>()

// Pan and zoom live in one transform on the drawing group. The wheel zooms about the
// pointer, a drag on empty canvas pans, two fingers pinch.
const scale = ref(1)
const tx = ref(40)
const ty = ref(40)
const svg = ref<SVGSVGElement | null>(null)
const transform = computed(() => `translate(${tx.value} ${ty.value}) scale(${scale.value})`)

function zoomAt(px: number, py: number, factor: number) {
  const next = Math.min(3, Math.max(0.1, scale.value * factor))
  tx.value = px - ((px - tx.value) * next) / scale.value
  ty.value = py - ((py - ty.value) * next) / scale.value
  scale.value = next
}
function zoomBy(factor: number) {
  if (!svg.value) return
  const rect = svg.value.getBoundingClientRect()
  zoomAt(rect.width / 2, rect.height / 2, factor)
}
function onWheel(e: WheelEvent) {
  e.preventDefault()
  const rect = svg.value!.getBoundingClientRect()
  zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015))
}

const pointers = new Map<number, { x: number; y: number }>()
let drag: { x: number; y: number; tx: number; ty: number } | null = null
let pinch: { distance: number; scale: number } | null = null
function onPointerDown(e: PointerEvent) {
  if ((e.target as Element).closest('[data-card]')) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, tx: tx.value, ty: ty.value }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: scale.value }
    drag = null
  }
}
function onPointerMove(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    const rect = svg.value!.getBoundingClientRect()
    const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }
    const target = pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance)
    zoomAt(mid.x, mid.y, target / scale.value)
    return
  }
  if (!drag) return
  tx.value = drag.tx + (e.clientX - drag.x)
  ty.value = drag.ty + (e.clientY - drag.y)
}
function onPointerUp(e: PointerEvent) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinch = null
  if (pointers.size === 0) drag = null
}

function fit() {
  if (!props.layout || !svg.value) return
  const rect = svg.value.getBoundingClientRect()
  const w = props.layout.width || 1
  const h = props.layout.height || 1
  scale.value = Math.min(1, (rect.width - 80) / w, (rect.height - 80) / h)
  tx.value = (rect.width - w * scale.value) / 2
  ty.value = (rect.height - h * scale.value) / 2
}
let fittedFor = ''
watch(
  () => props.layout,
  () => {
    if (props.fitKey === fittedFor) return
    fittedFor = props.fitKey
    requestAnimationFrame(fit)
  },
)
defineExpose({ fit, zoomBy })

const shownColumns = (t: Table): Column[] => (props.compact ? t.columns.filter((c) => isKeyColumn(c.name, c.pk)) : t.columns)
const colour = (t: Table) => groupColour(t.group, props.groups)
const rowY = (i: number) => HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2 + CARD_PADDING / 2
const matches = (c: Column) => props.highlightColumn !== '' && c.name.toLowerCase().includes(props.highlightColumn.toLowerCase())
const edgePath = (points: { x: number; y: number }[]) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
const touchesSelected = (e: Layout['edges'][number]) => props.selected !== null && (e.ref.from.table === props.selected || e.ref.to.table === props.selected)
const flags = (c: Column) => [c.pk ? 'PK' : '', c.unique ? 'U' : '', c.notNull && !c.pk ? '!' : ''].filter(Boolean).join(' ')
const cardLabel = (t: Table) => `${t.name}, ${t.group} group, ${t.columns.length} columns. Enter selects, Shift+Enter focuses.`

function onCardKey(e: KeyboardEvent, name: string) {
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  if (e.shiftKey) emit('focus', name)
  else emit('select', name)
}
</script>

<template>
  <svg
    ref="svg"
    class="canvas"
    role="group"
    aria-label="Schema diagram"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <defs>
      <marker id="many" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10" fill="none" stroke="context-stroke" stroke-width="1.5" />
      </marker>
    </defs>
    <g :transform="transform">
      <template v-if="layout">
        <path
          v-for="e in layout.edges"
          :key="e.ref.id"
          :d="edgePath(e.points)"
          class="edge"
          :class="{ hot: touchesSelected(e), dim: selected !== null && !touchesSelected(e) }"
          marker-end="url(#many)"
        >
          <title>{{ e.ref.from.table }}.{{ e.ref.from.columns.join(', ') }} ({{ e.ref.from.relation }}) to {{ e.ref.to.table }}.{{ e.ref.to.columns.join(', ') }} ({{ e.ref.to.relation }})</title>
        </path>
        <g
          v-for="n in layout.nodes"
          :key="n.table.name"
          :transform="`translate(${n.x} ${n.y})`"
          class="card"
          :class="{ selected: n.table.name === selected, root: n.table.name === focusRoot }"
          data-card
          tabindex="0"
          role="button"
          :aria-label="cardLabel(n.table)"
          :aria-pressed="n.table.name === selected"
          @click.stop="emit('select', n.table.name)"
          @dblclick.stop="emit('focus', n.table.name)"
          @keydown="onCardKey($event, n.table.name)"
        >
          <rect :width="n.width" :height="n.height" rx="6" class="card-bg" />
          <rect :width="n.width" :height="HEADER_HEIGHT" rx="6" :fill="colour(n.table)" />
          <rect :y="HEADER_HEIGHT - 6" :width="n.width" height="6" :fill="colour(n.table)" />
          <text :x="12" :y="21" class="card-title">{{ n.table.name }}</text>
          <text :x="12" :y="39" class="card-group">{{ n.table.group }}</text>
          <g v-if="n.table.name === focusRoot" :transform="`translate(${n.width - 60} 12)`">
            <rect width="48" height="20" rx="10" class="badge-bg" />
            <text x="24" y="14" text-anchor="middle" class="badge">focus</text>
          </g>
          <g v-for="(c, i) in shownColumns(n.table)" :key="c.name">
            <rect v-if="matches(c)" :y="rowY(i) - ROW_HEIGHT / 2" :width="n.width" :height="ROW_HEIGHT" class="row-hit" />
            <text :x="12" :y="rowY(i) + 4" class="col-name" :class="{ pk: c.pk }">{{ c.name }}</text>
            <text :x="n.width - 12" :y="rowY(i) + 4" class="col-type" text-anchor="end">{{ flags(c) ? flags(c) + ' ' : '' }}{{ c.type }}</text>
          </g>
        </g>
      </template>
    </g>
  </svg>
</template>

<style scoped>
.canvas {
  width: 100%;
  height: 100%;
  background: var(--bg);
  touch-action: none;
  cursor: grab;
}
.canvas:active {
  cursor: grabbing;
}
.edge {
  fill: none;
  stroke: var(--edge);
  stroke-width: 1.3;
}
.edge.hot {
  stroke: var(--accent);
  stroke-width: 2.2;
}
.edge.dim {
  opacity: 0.25;
}
.card {
  cursor: pointer;
  outline: none;
}
.card-bg {
  fill: var(--card);
  stroke: var(--border);
  stroke-width: 1;
}
.card.selected .card-bg,
.card:focus-visible .card-bg {
  stroke: var(--accent);
  stroke-width: 2.5;
}
.card.root .card-bg {
  stroke: var(--accent);
  stroke-width: 3.5;
}
.card-title {
  font: 600 13px/1 var(--mono);
  fill: #fff;
}
.card-group {
  font: 500 12px/1 var(--sans);
  fill: #fff;
}
.badge-bg {
  fill: #fff;
}
.badge {
  font: 600 11px/1 var(--sans);
  fill: var(--accent-fg);
  letter-spacing: 0.02em;
}
.col-name {
  font: 12px/1 var(--mono);
  fill: var(--fg);
}
.col-name.pk {
  font-weight: 700;
}
.col-type {
  font: 12px/1 var(--mono);
  fill: var(--muted);
}
.row-hit {
  fill: var(--hit);
}
</style>
