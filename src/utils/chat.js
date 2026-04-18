import { canManageAnnouncements, normalizeRole } from './roles'

export const CHANNELS = [
  { id: 'general', label: '# general', type: 'channel' },
  { id: 'tech-team', label: '# it-support', type: 'channel' },
  { id: 'announcements', label: '# announcements', type: 'channel' },
]

export const ANNOUNCEMENTS_CHANNEL_ID = 'announcements'
export const ANNOUNCEMENTS_ROOM_ID = `channel_${ANNOUNCEMENTS_CHANNEL_ID}`

export { normalizeRole, canManageAnnouncements }

export function getDmId(uid1, uid2) {
  return [uid1, uid2].sort().join('_')
}

export function getRoomId(room, currentUid) {
  if (!room) return ''
  if (room.type === 'channel') return `channel_${room.id}`
  if (room.type === 'group') return `group_${room.id}`
  return getDmId(currentUid, room.id)
}

export function isAnnouncementRoom(room) {
  return room?.type === 'channel' && room?.id === ANNOUNCEMENTS_CHANNEL_ID
}

export function isAnnouncementMessage(message) {
  return message?.roomId === ANNOUNCEMENTS_ROOM_ID || message?.isAnnouncement === true
}

export function splitAnnouncementText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return { title: 'Announcement', body: '' }
  }

  return {
    title: lines[0],
    body: lines.slice(1).join(' '),
  }
}

export function getAnnouncementContent(message) {
  const title = normalizeAnnouncementValue(message?.announcementTitle || message?.title)
  const body = normalizeAnnouncementValue(message?.announcementDescription || message?.description || message?.body)

  if (title || body) {
    return {
      title: title || 'Announcement',
      body: body || '',
    }
  }

  return splitAnnouncementText(message?.text)
}

export function composeAnnouncementText(title, description) {
  return [title, description]
    .map(value => normalizeAnnouncementValue(value))
    .filter(Boolean)
    .join('\n\n')
}

function normalizeAnnouncementValue(value) {
  if (value == null) return ''
  return String(value).trim()
}
