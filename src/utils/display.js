export function toDisplayText(value, fallback = '') {
  if (value == null || value === '') return fallback
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value?.toDate) {
    return value.toDate().toLocaleDateString('en-GB')
  }
  return fallback || String(value)
}

export function formatDateValue(value, fallback = '-') {
  if (value?.toDate) return value.toDate().toLocaleDateString('en-GB')
  return toDisplayText(value, fallback)
}

export function getInitials(value, fallback = '?') {
  return toDisplayText(value, fallback)
    .split(' ')
    .map(part => part[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function firstName(value, fallback = '') {
  return toDisplayText(value, fallback).split(' ')[0]
}

export function toCountValue(value, fallback = '0') {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return toDisplayText(value, fallback)
}

export function getLeaveRemaining(leaveBalance, leaveTaken = null) {
  if (typeof leaveBalance === 'number' && Number.isFinite(leaveBalance)) return leaveBalance

  const annual = normalizeCounter(leaveBalance?.annual)
  const used = normalizeCounter(leaveBalance?.used)
  const remaining = normalizeCounter(leaveBalance?.remaining)

  if (remaining != null) return remaining
  if (annual != null && used != null) return Math.max(annual - used, 0)
  if (annual != null && typeof leaveTaken === 'number' && Number.isFinite(leaveTaken)) {
    return Math.max(annual - leaveTaken, 0)
  }

  return null
}

export function getLeaveUsed(leaveBalance, leaveTaken = null) {
  if (typeof leaveTaken === 'number' && Number.isFinite(leaveTaken)) return leaveTaken

  const annual = normalizeCounter(leaveBalance?.annual)
  const used = normalizeCounter(leaveBalance?.used)
  const remaining = normalizeCounter(leaveBalance?.remaining)

  if (used != null) return used
  if (annual != null && remaining != null) return Math.max(annual - remaining, 0)

  return null
}

function normalizeCounter(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
