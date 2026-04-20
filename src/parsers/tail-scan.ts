type LineClassifier = (parsed: unknown) => { role: 'user' | 'agent'; content: string } | null

/**
 * Scans JSONL tail text (already sliced to relevant portion) for the most
 * recent user and agent messages. Lines are processed in reverse order so the
 * first match for each role wins.
 *
 * @param text    JSONL text, one JSON object per line
 * @param classify Function that inspects a parsed line and returns its role +
 *                 content, or null if the line is not a relevant message
 */
export function scanTailForLastMessages(
  text: string,
  classify: LineClassifier,
): { lastUser?: string; lastAgent?: string } {
  const lines = text.split('\n').filter(Boolean).reverse()
  let lastUser: string | undefined
  let lastAgent: string | undefined

  for (const line of lines) {
    if (lastUser && lastAgent) break
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const result = classify(parsed)
    if (!result) continue
    if (!lastUser && result.role === 'user') lastUser = result.content
    if (!lastAgent && result.role === 'agent') lastAgent = result.content
  }

  return { lastUser, lastAgent }
}
