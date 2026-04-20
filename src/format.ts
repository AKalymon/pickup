export function describeTimeAgo(timestampMs: number, nowMs: number = Date.now()): string {
  const diff = nowMs - timestampMs
  const m = Math.floor(diff / 60_000)
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(diff / 86_400_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  if (d === 1) return 'yesterday'
  return `${d}d ago`
}

export function abbreviateHomePath(fullPath: string, homeDir: string): string {
  return homeDir && fullPath.startsWith(homeDir) ? `~${fullPath.slice(homeDir.length)}` : fullPath
}

export function truncateMessage(text: string, maxChars = 80): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > maxChars ? clean.slice(0, maxChars - 1) + '…' : clean
}
