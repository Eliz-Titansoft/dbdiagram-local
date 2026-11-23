<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { groupColour } from '../lib/graph'
import { CARD_PADDING, HEADER_HEIGHT, ROW_HEIGHT, type Layout } from '../lib/layout'
import type { Column, Table } from '../lib/schema'

const props = defineProps<{
  layout: Layout | null
  groups: string[]
  selected: string | null
  highlightColumn: string
  compact: boolean
}>()
const emit = defineEmits<{ select: [table: string]; focus: [table: string] }>()

// Pan and zoom live in one transform on the drawing group. The wheel zooms about the
// pointer, a drag on empty canvas pans.
const scale = ref(1)
const tx = ref(40)
const ty = ref(40)
const svg = ref<SVGSVGElement | null>(null)
const transform = computed(() => `translate(${tx.value} ${ty.value}) scale(${scale.value})`)

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const rect = svg.value!.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  const factor = Math.exp(-e.deltaY * 0.0015)
  const next = Math.min(3, Math.max(0.1, scale.value * factor))
  tx.value = px - ((px - tx.value) * next) / scale.value
  ty.value = py - ((py - ty.value) * next) / scale.value
  scale.value = next
}
let drag: { x: number; y: number; tx: number; ty: number } | null = null
function onPointerDown(e: PointerEvent) {
  if ((e.target as Element).closest('[data-card]')) return
  drag = { x: e.clientX, y: e.clientY, tx: tx.value, ty: ty.value }
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!drag) return
  tx.value = drag.tx + (e.clientX - drag.x)
  ty.value = drag.ty + (e.clientY - drag.y)
}
function onPointerUp() {
  drag = null
}

// A fresh layout is fitted to the viewport once, then left to the user's pan and zoom.
function fit() {
  if (!props.layout || !svg.value) return
  const rect = svg.value.getBoundingClientRect()
  const w = props.layout.width || 1
  const h = props.layout.height || 1
  scale.value = Math.min(1, (rect.width - 80) / w, (rect.height - 80) / h)
  tx.value = (rect.width - w * scale.value) / 2
  ty.value = (rect.height - h * scale.value) / 2
}
watch(() => props.layout, () => requestAnimationFrame(fit))
defineExpose({ fit })

const shownColumns = (t: Table): Column[] => (props.compact ? t.columns.filter((c) => c.pk || c.name.endsWith('_id')) : t.columns)
const colour = (t: Table) => groupColour(t.group, props.groups)
const rowY = (i: number) => HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2 + CARD_PADDING / 2
const matches = (c: Column) => props.highlightColumn !== '' && c.name.toLowerCase().includes(props.highlightColumn.toLowerCase())
const edgePath = (points: { x: number; y: number }[]) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
const touchesSelected = (e: Layout['edges'][number]) => props.selected !== null && (e.ref.from.table === props.selected || e.ref.to.table === props.selected)
const flags = (c: Column) => [c.pk ? 'PK' : '', c.unique ? 'U' : '', c.notNull && !c.pk ? '!' : ''].filter(Boolean).join(' ')
</script>

<template>
  <svg
    ref="svg"
    class="canvas"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <defs>
      <marker id="many" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10" fill="none" stroke="currentColor" stroke-width="1.5" />
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
          :class="{ selected: n.table.name === selected }"
          data-card
          @click.stop="emit('select', n.table.name)"
          @dblclick.stop="emit('focus', n.table.name)"
        >
          <rect :width="n.width" :height="n.height" rx="6" class="card-bg" />
          <rect :width="n.width" :height="HEADER_HEIGHT" rx="6" :fill="colour(n.table)" />
          <rect :y="HEADER_HEIGHT - 6" :width="n.width" height="6" :fill="colour(n.table)" />
          <text :x="10" :y="19" class="card-title">{{ n.table.name }}</text>
          <text :x="10" :y="35" class="card-group">{{ n.table.group }}</text>
          <g v-for="(c, i) in shownColumns(n.table)" :key="c.name" :class="{ hit: matches(c) }">
            <rect v-if="matches(c)" :y="rowY(i) - ROW_HEIGHT / 2" :width="n.width" :height="ROW_HEIGHT" class="row-hit" />
            <text :x="10" :y="rowY(i) + 4" class="col-name" :class="{ pk: c.pk }">{{ c.name }}</text>
            <text :x="n.width - 10" :y="rowY(i) + 4" class="col-type" text-anchor="end">{{ flags(c) ? flags(c) + ' ' : '' }}{{ c.type }}</text>
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
  color: var(--edge);
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
  color: var(--accent);
}
.edge.dim {
  opacity: 0.25;
}
.card {
  cursor: pointer;
}
.card-bg {
  fill: var(--card);
  stroke: var(--border);
  stroke-width: 1;
}
.card.selected .card-bg {
  stroke: var(--accent);
  stroke-width: 2.5;
}
.card-title {
  font: 600 13px/1 var(--mono);
  fill: #fff;
}
.card-group {
  font: 10px/1 var(--sans);
  fill: rgba(255, 255, 255, 0.8);
}
.col-name {
  font: 12px/1 var(--mono);
  fill: var(--fg);
}
.col-name.pk {
  font-weight: 700;
}
.col-type {
  font: 10px/1 var(--mono);
  fill: var(--muted);
}
.row-hit {
  fill: var(--hit);
}
</style>
