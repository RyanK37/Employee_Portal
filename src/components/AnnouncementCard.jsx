import styles from './AnnouncementCard.module.css'
import { getAnnouncementContent } from '../utils/chat'

export default function AnnouncementCard({ announcement, currentUid, onReact, compact = false }) {
  const { title, body } = getAnnouncementContent(announcement)
  const likedBy = Array.isArray(announcement?.likedBy) ? announcement.likedBy : []
  const dislikedBy = Array.isArray(announcement?.dislikedBy) ? announcement.dislikedBy : []
  const currentReaction = likedBy.includes(currentUid) ? 'like' : dislikedBy.includes(currentUid) ? 'dislike' : null

  return (
    <div className={styles.card + (compact ? ' ' + styles.compact : '')}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Announcement</div>
          <div className={styles.title}>{title}</div>
          {body && <div className={styles.body}>{body}</div>}
        </div>
      </div>

      <div className={styles.meta}>
        <span className={styles.author}>{toDisplayText(announcement?.senderName, 'Manager')}</span>
        <span className={styles.time}>{formatAnnouncementTime(announcement?.createdAt)}</span>
      </div>

      <div className={styles.reactions}>
        <button
          type="button"
          className={styles.reactionBtn + (currentReaction === 'like' ? ' ' + styles.reactionActive : '')}
          onClick={() => onReact?.(announcement, 'like')}>
          <span>Like</span>
          <span className={styles.count}>{likedBy.length}</span>
        </button>
        <button
          type="button"
          className={styles.reactionBtn + (currentReaction === 'dislike' ? ' ' + styles.reactionActive : '')}
          onClick={() => onReact?.(announcement, 'dislike')}>
          <span>Dislike</span>
          <span className={styles.count}>{dislikedBy.length}</span>
        </button>
      </div>
    </div>
  )
}

function formatAnnouncementTime(ts) {
  if (!ts?.toDate) return 'Just now'

  const date = ts.toDate()
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toDisplayText(value, fallback = '') {
  if (value == null || value === '') return fallback
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value?.toDate) return value.toDate().toLocaleDateString('en-GB')
  return fallback || String(value)
}
