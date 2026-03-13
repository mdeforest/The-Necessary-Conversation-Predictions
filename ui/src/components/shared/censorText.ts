const CENSOR_PATTERNS = [
  /\bmotherfucking\b/gi,
  /\bmotherfucker(?:s)?\b/gi,
  /\bbullshit\b/gi,
  /\bgoddamn(?:ed|ing)?\b/gi,
  /\bfuck(?:ing|ed|er|ers)?\b/gi,
  /\bshit(?:s|ty)?\b/gi,
  /\basshole(?:s)?\b/gi,
  /\bbitch(?:es|y)?\b/gi,
  /\bbastard(?:s)?\b/gi,
  /\bdamn(?:ed|ing)?\b/gi,
] as const

function maskWord(word: string): string {
  if (word.length <= 1) return '*'
  return `${word[0]}${'*'.repeat(word.length - 1)}`
}

export function censorText(text: string): string {
  return CENSOR_PATTERNS.reduce((current, pattern) => current.replace(pattern, match => maskWord(match)), text)
}
