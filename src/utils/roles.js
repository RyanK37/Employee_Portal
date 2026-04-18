export function normalizeRole(role) {
  return String(role || '').trim().toLowerCase()
}

export function isManagerOrAdmin(role) {
  const normalized = normalizeRole(role)
  return normalized.includes('manager') || normalized.includes('admin')
}

export function canManageAnnouncements(profile) {
  return isManagerOrAdmin(profile?.role)
}

export function canReviewLeave(profile) {
  return isManagerOrAdmin(profile?.role)
}

export function canViewAllPayroll(profile) {
  return isManagerOrAdmin(profile?.role)
}

export function canManagePayroll(profile) {
  return isManagerOrAdmin(profile?.role)
}
