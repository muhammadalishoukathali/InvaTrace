/** Potted-plant geometry from Tabler Icons (MIT); foliage grows, pot stays still. */
export function PlantLoader({ label = 'Loading…', compact = false }: { label?: string; compact?: boolean }) {
  return <span className={`plant-loader${compact ? ' plant-loader--compact' : ''}`}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g className="plant-loader__growth">
        <path d="M12 9a6 6 0 0 0 -6 -6h-3v2a6 6 0 0 0 6 6h3" />
        <path d="M12 11a6 6 0 0 1 6 -6h3v1a6 6 0 0 1 -6 6h-3" />
        <path d="M12 15l0 -6" />
      </g>
      <path className="plant-loader__pot" d="M7 15h10v4a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-4z" />
    </svg>
    <span className="sr-only">{label}</span>
  </span>
}
