export function getSpeakerDisplayName(name: string): string {
  if (name === 'Mary Lou Kultgen') return 'Mary Lou'
  return name.split(' ')[0] ?? name
}
