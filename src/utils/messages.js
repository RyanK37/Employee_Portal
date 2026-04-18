export function mergeMessagesByNewest(...lists) {
  const seen = new Map()

  lists.flat().forEach(message => {
    if (!message?.id) return
    seen.set(message.id, message)
  })

  return Array.from(seen.values()).sort((a, b) => getMessageTimestampMs(b?.createdAt) - getMessageTimestampMs(a?.createdAt))
}

export function getMessageTimestampMs(value) {
  if (value?.toDate) return value.toDate().getTime()
  if (typeof value?.seconds === 'number') return value.seconds * 1000
  return 0
}
