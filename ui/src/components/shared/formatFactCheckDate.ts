export function formatFactCheckDate(dateGenerated?: string | null): string | null {
  if (!dateGenerated) return null

  const parsed = new Date(`${dateGenerated}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return dateGenerated

  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
