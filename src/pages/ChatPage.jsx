import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { addDoc, arrayRemove, arrayUnion, collection, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase'
import AnnouncementCard from '../components/AnnouncementCard'
import { useAuth } from '../hooks/useAuth'
import { getEmotionEmoji, getMbtiGroup, predictEmotion } from '../utils/ai'
import { getAllUserIds, notifyUsers } from '../utils/notifications'
import { getPreferenceValue } from '../utils/preferences'
import { ANNOUNCEMENTS_CHANNEL_ID, CHANNELS, canManageAnnouncements, composeAnnouncementText, getRoomId, isAnnouncementMessage, isAnnouncementRoom } from '../utils/chat'
import styles from './ChatPage.module.css'

const DEFAULT_ROOM = CHANNELS[0]

export default function ChatPage() {
  const { user, profile } = useAuth()
  const location = useLocation()
  const [activeRoom, setActiveRoom] = useState(DEFAULT_ROOM)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [announcementForm, setAnnouncementForm] = useState({ title: '', description: '' })
  const [sending, setSending] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [previewMood, setPreviewMood] = useState(null)
  const [users, setUsers] = useState([])
  const [groups, setGroups] = useState([])
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [groupForm, setGroupForm] = useState({ name: '', memberIds: [] })
  const [groupError, setGroupError] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const bottomRef = useRef(null)
  const detectTimeout = useRef(null)
  const lastMarkedReadRef = useRef({})

  const mbtiGroup = profile?.mbti ? getMbtiGroup(profile.mbti) : null
  const canPostAnnouncements = canManageAnnouncements(profile)
  const announcementRoomActive = isAnnouncementRoom(activeRoom)
  const roomIsReadOnly = announcementRoomActive && !canPostAnnouncements
  const showMoodOnMessages = getPreferenceValue(profile?.preferences, 'showMoodOnMessages')
  const showMbtiOnMessages = getPreferenceValue(profile?.preferences, 'showMbtiOnMessages')
  const autoDetectMood = getPreferenceValue(profile?.preferences, 'autoDetectMood')

  useEffect(() => {
    if (location.state?.room !== ANNOUNCEMENTS_CHANNEL_ID) return
    const room = CHANNELS.find(channel => channel.id === ANNOUNCEMENTS_CHANNEL_ID)
    if (room) setActiveRoom(room)
  }, [location.state])

  useEffect(() => {
    if (!user) return
    getDocs(collection(db, 'users')).then(snapshot => {
      const nextUsers = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(teamUser => teamUser.uid !== user.uid)
        .sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || '')))
      setUsers(nextUsers)
    })
  }, [user])

  useEffect(() => {
    if (!user) return
    const roomsQuery = query(collection(db, 'chatRooms'), where('memberIds', 'array-contains', user.uid))
    const unsub = onSnapshot(roomsQuery, snapshot => {
      const nextGroups = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      setGroups(nextGroups)
    })
    return unsub
  }, [user])

  useEffect(() => {
    if (!user) return
    const roomId = getRoomId(activeRoom, user.uid)
    if (!roomId) return

    const messagesQuery = activeRoom.type === 'channel'
      ? query(
          collection(db, 'messages'),
          where('roomId', '==', roomId),
          where('roomType', '==', 'channel'),
          orderBy('createdAt', 'asc'),
          limit(80)
        )
      : query(
          collection(db, 'messages'),
          where('roomId', '==', roomId),
          where('memberIds', 'array-contains', user.uid),
          orderBy('createdAt', 'asc'),
          limit(80)
        )

    const unsub = onSnapshot(messagesQuery, snapshot => {
      const nextMessages = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
      setMessages(nextMessages)
      markRoomAsRead(roomId, nextMessages)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    })

    return unsub
  }, [activeRoom, user])

  useEffect(() => {
    setText('')
    setAnnouncementForm({ title: '', description: '' })
    setPreviewMood(null)
    setDetecting(false)
    clearTimeout(detectTimeout.current)
  }, [activeRoom])

  useEffect(() => () => clearTimeout(detectTimeout.current), [])

  const markRoomAsRead = useCallback(async (roomId, roomMessages) => {
    if (!user?.uid || !roomId || !Array.isArray(roomMessages) || roomMessages.length === 0) return

    const latestMessage = roomMessages[roomMessages.length - 1]
    const latestMessageMs = latestMessage?.createdAt?.toDate?.()?.getTime?.() || 0
    if (!latestMessageMs) return

    if (lastMarkedReadRef.current[roomId] === latestMessageMs) return
    lastMarkedReadRef.current[roomId] = latestMessageMs

    try {
      const nextPreferences = {
        ...(profile?.preferences || {}),
        lastReadByRoom: {
          ...(profile?.preferences?.lastReadByRoom || {}),
          [roomId]: new Date(latestMessageMs).toISOString(),
        },
      }

      await updateDoc(doc(db, 'users', user.uid), {
        preferences: nextPreferences,
      })
    } catch (err) {
      console.error('Mark room as read failed', err)
    }
  }, [profile?.preferences, user?.uid])

  const handleTextChange = useCallback((value) => {
    setText(value)
    if (announcementRoomActive || !autoDetectMood || !showMoodOnMessages) {
      setDetecting(false)
      setPreviewMood(null)
      return
    }

    clearTimeout(detectTimeout.current)
    if (value.trim().length < 8) {
      setPreviewMood(null)
      return
    }

    detectTimeout.current = setTimeout(async () => {
      setDetecting(true)
      const mood = await predictEmotion(value)
      setPreviewMood(mood)
      setDetecting(false)
    }, 900)
  }, [announcementRoomActive, autoDetectMood, showMoodOnMessages])

  async function handleSend(e) {
    e.preventDefault()
    if (!user || sending || roomIsReadOnly) return

    const nextText = text.trim()
    const announcementTitle = announcementForm.title.trim()
    const announcementDescription = announcementForm.description.trim()

    if (announcementRoomActive) {
      if (!announcementTitle || !announcementDescription) return
    } else if (!nextText) {
      return
    }

    setSending(true)
    try {
      const roomId = getRoomId(activeRoom, user.uid)
      const mood = announcementRoomActive || !showMoodOnMessages
        ? null
        : (previewMood || (await predictEmotion(nextText)) || 'neutral')
      const senderGroup = profile?.mbti ? getMbtiGroup(profile.mbti) : null
      const memberIds = activeRoom.type === 'channel'
        ? []
        : activeRoom.type === 'group'
          ? (activeRoom.memberIds || [])
          : [user.uid, activeRoom.id]
      const messageText = announcementRoomActive
        ? composeAnnouncementText(announcementTitle, announcementDescription)
        : nextText

      const payload = {
        roomId,
        roomKey: activeRoom.id,
        roomLabel: activeRoom.label,
        roomType: activeRoom.type,
        memberIds,
        senderId: user.uid,
        senderName: profile?.displayName || user.displayName || 'Unknown',
        senderRole: profile?.role || 'Employee',
        senderMbti: announcementRoomActive || !showMbtiOnMessages ? null : (profile?.mbti || null),
        senderMbtiGroup: announcementRoomActive || !showMbtiOnMessages ? null : (senderGroup?.group || null),
        text: messageText,
        mood,
        isAnnouncement: announcementRoomActive,
        showMoodOnMessages,
        showMbtiOnMessages,
        createdAt: serverTimestamp(),
      }

      if (announcementRoomActiv
        payload.announcementTitle = announcementTitle
        payload.announcementDescription = announcementDescription
        payload.likedBy = []
        payload.dislikedBy = []
      }

      await addDoc(collection(db, 'messages'), payload)

      if (announcementRoomActive) {
        const recipients = await getAllUserIds(db, [user.uid])
        await notifyUsers(db, recipients, {
          type: 'announcement',
          text: `New announcement from ${payload.senderName}`,
          sub: announcementTitle || 'Open the announcements channel to read it.',
        })
      }

      setText('')
      setAnnouncementForm({ title: '', description: '' })
      setPreviewMood(null)
    } finally {
      setSending(false)
    }
  }

  async function handleAnnouncementReaction(message, reaction) {
    if (!user) return

    const likedBy = message?.likedBy || []
    const dislikedBy = message?.dislikedBy || []
    const hasLike = likedBy.includes(user.uid)
    const hasDislike = dislikedBy.includes(user.uid)
    const updates = {}

    if (reaction === 'like') {
      updates.likedBy = hasLike ? arrayRemove(user.uid) : arrayUnion(user.uid)
      if (hasDislike) updates.dislikedBy = arrayRemove(user.uid)
    } else {
      updates.dislikedBy = hasDislike ? arrayRemove(user.uid) : arrayUnion(user.uid)
      if (hasLike) updates.likedBy = arrayRemove(user.uid)
    }

    await updateDoc(doc(db, 'messages', message.id), updates)
  }

  function toggleGroupMember(memberId) {
    setGroupForm(current => ({
      ...current,
      memberIds: current.memberIds.includes(memberId)
        ? current.memberIds.filter(id => id !== memberId)
        : [...current.memberIds, memberId],
    }))
  }

  async function handleCreateGroup(e) {
    e.preventDefault()
    if (!user) return

    const name = groupForm.name.trim()
    const memberIds = Array.from(new Set([user.uid, ...groupForm.memberIds]))

    if (!name) {
      setGroupError('Enter a group name.')
      return
    }

    if (memberIds.length < 2) {
      setGroupError('Select at least one teammate.')
      return
    }

    setCreatingGroup(true)
    const groupRef = await addDoc(collection(db, 'chatRooms'), {
      name,
      memberIds,
      createdBy: user.uid,
      createdByName: profile?.displayName || user.displayName || 'Unknown',
      createdAt: serverTimestamp(),
    })

    setActiveRoom({
      id: groupRef.id,
      type: 'group',
      label: `# ${name}`,
      name,
      memberIds,
    })
    setShowGroupModal(false)
    setGroupForm({ name: '', memberIds: [] })
    setGroupError('')
    setCreatingGroup(false)
  }

  const roomBadge = activeRoom.type === 'channel'
    ? 'Public'
    : activeRoom.type === 'group'
      ? `${(activeRoom.memberIds || []).length || 0} members`
      : 'Direct'

  return (
    <>
      {showGroupModal && (
        <div className={styles.overlay}>
          <div className={styles.groupModal + ' scale-in'}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalTitle}>Create group chat</div>
                <div className={styles.modalSub}>Pick a group name and choose who should be in it.</div>
              </div>
              <button className="btn secondary sm" type="button" onClick={() => setShowGroupModal(false)}>Close</button>
            </div>

            <form onSubmit={handleCreateGroup}>
              <div className={styles.modalField}>
                <label>Group name</label>
                <input
                  className="input"
                  value={groupForm.name}
                  onChange={e => {
                    setGroupForm(current => ({ ...current, name: e.target.value }))
                    setGroupError('')
                  }}
                  placeholder="Project Phoenix"
                />
              </div>

              <div className={styles.modalField}>
                <label>Members</label>
                <div className={styles.memberList}>
                  {users.map(teamUser => {
                    const checked = groupForm.memberIds.includes(teamUser.uid)
                    return (
                      <label key={teamUser.uid} className={styles.memberRow}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            toggleGroupMember(teamUser.uid)
                            setGroupError('')
                          }}
                        />
                        <span className={styles.memberName}>{teamUser.displayName}</span>
                        <span className={styles.memberMeta}>{teamUser.role || 'Employee'}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              {groupError && <div className={styles.groupError}>{groupError}</div>}

              <div className={styles.modalActions}>
                <div className={styles.memberSummary}>{groupForm.memberIds.length + 1} people including you</div>
                <button className="btn sm" type="submit" disabled={creatingGroup}>
                  {creatingGroup ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Create group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className={styles.wrap}>
        <div className={styles.sidebar}>
          <div className={styles.sideSection}>
            <div className={styles.sideLabel} style={{ paddingLeft: 20, paddingBottom: 10 , fontSize: 12}}>Channels</div>
            {CHANNELS.map(channel => (
              <button
                key={channel.id}
                className={styles.roomBtn + (activeRoom.id === channel.id && activeRoom.type === 'channel' ? ' ' + styles.roomActive : '')}
                onClick={() => setActiveRoom({ ...channel })}>
                <span className={styles.roomName}>{channel.label}</span>
              </button>
            ))}
          </div>

          <div className={styles.sideSection}>
            <div className={styles.sideHeader}>
              <div className={styles.sideLabel}>Groups</div>
              <button className={styles.inlineAction} type="button" onClick={() => setShowGroupModal(true)}>New</button>
            </div>
            {groups.length === 0 && <div className={styles.emptySidebar}>No groups yet</div>}
            {groups.map(group => (
              <button
                key={group.id}
                className={styles.roomBtn + (activeRoom.id === group.id && activeRoom.type === 'group' ? ' ' + styles.roomActive : '')}
                onClick={() => setActiveRoom({
                  id: group.id,
                  type: 'group',
                  label: `# ${group.name}`,
                  name: group.name,
                  memberIds: group.memberIds || [],
                })}>
                <span className={styles.roomName}># {group.name}</span>
                <span className={styles.roomMeta}>{(group.memberIds || []).length}</span>
              </button>
            ))}
          </div>

          <div className={styles.sideSection}>
            <div className={styles.sideLabel} style={{ paddingLeft: 10, paddingBottom: 10 }}>Direct messages</div>
            {users.map(teamUser => {
              const group = teamUser.mbti ? getMbtiGroup(teamUser.mbti) : null
              return (
                <button
                  key={teamUser.uid}
                  className={styles.roomBtn + (activeRoom.id === teamUser.uid && activeRoom.type === 'dm' ? ' ' + styles.roomActive : '')}
                  onClick={() => setActiveRoom({ id: teamUser.uid, type: 'dm', label: teamUser.displayName })}>
                  <span className={styles.dmAvatar} style={{ background: group?.bg || 'var(--surface2)', color: group?.text || 'var(--text2)' }}>
                    {(teamUser.displayName || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                  <span className={styles.dmName}>{teamUser.displayName}</span>
                  {group && <span className="mbti-badge" style={{ background: group.bg, color: group.text, fontSize: 9 }}>{teamUser.mbti}</span>}
                </button>
              )
            })}
          </div>
        </div>

        <div className={styles.main}>
          <div className={styles.chatHeader}>
            <span className={styles.chatTitle}>{activeRoom.label}</span>
            <span className={styles.publicBadge}>{roomBadge}</span>
            {announcementRoomActive && (
              <span className={styles.announcementHint}>
                {canPostAnnouncements ? 'Managers and admins can publish here.' : 'Read only for employees.'}
              </span>
            )}
          </div>

          <div className={styles.messages}>
            {messages.length === 0 && <div className={styles.emptyMessages}>No messages yet</div>}
            {messages.map((message, index) => {
              if (isAnnouncementMessage(message)) {
                return (
                  <div key={message.id} className={styles.announcementWrap}>
                    <AnnouncementCard
                      announcement={message}
                      currentUid={user?.uid}
                      onReact={handleAnnouncementReaction}
                    />
                  </div>
                )
              }

              const isMe = message.senderId === user?.uid
              const previousMessage = messages[index - 1]
              const showSender = !previousMessage || previousMessage.senderId !== message.senderId
              const displayMbti = shouldShowMessageMbti(message)
              const displayMood = shouldShowMessageMood(message)
              const senderGroup = displayMbti && message.senderMbti ? getMbtiGroup(message.senderMbti) : null
              const emoji = displayMood ? getEmotionEmoji(message.mood) : null

              return (
                <div
                  key={message.id}
                  className={styles.msgWrap + (isMe ? ' ' + styles.msgMe : '')}
                  style={{ marginTop: showSender && index > 0 ? 12 : 3 }}>
                  {showSender && !isMe && (
                    <div className={styles.senderRow}>
                      <div className={styles.senderAvatar} style={{ background: senderGroup?.bg || 'var(--surface2)', color: senderGroup?.text || 'var(--text2)' }}>
                        {(message.senderName || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <span className={styles.senderName}>{message.senderName}</span>
                      {senderGroup && <span className="mbti-badge" style={{ background: senderGroup.bg, color: senderGroup.text }}>{message.senderMbti}</span>}
                    </div>
                  )}
                  <div className={styles.bubble + (isMe ? ' ' + styles.bubbleMe : '')}>{message.text}</div>
                  <div className={styles.msgMeta + (isMe ? ' ' + styles.msgMetaMe : '')}>
                    {displayMood && <span className="mood-badge">{emoji} {message.mood}</span>}
                    {isMe && senderGroup && <span className="mbti-badge" style={{ background: senderGroup.bg, color: senderGroup.text }}>{message.senderMbti}</span>}
                    <span className={styles.msgTime}>{formatTime(message.createdAt)}</span>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          <form className={styles.inputRow} onSubmit={handleSend}>
            {detecting && !announcementRoomActive && autoDetectMood && showMoodOnMessages && <div className={styles.detectingBadge}>detecting mood...</div>}
            {previewMood && !detecting && !announcementRoomActive && showMoodOnMessages && (
              <div className={styles.moodPreview}>
                {getEmotionEmoji(previewMood)} {previewMood}
              </div>
            )}
            {mbtiGroup && !announcementRoomActive && showMbtiOnMessages && (
              <span className="mbti-badge" style={{ background: mbtiGroup.bg, color: mbtiGroup.text, flexShrink: 0 }}>
                {profile.mbti}
              </span>
            )}
            {announcementRoomActive ? (
              <div className={styles.announcementComposer}>
                <input
                  className={styles.textInput}
                  value={announcementForm.title}
                  onChange={e => setAnnouncementForm(current => ({ ...current, title: e.target.value }))}
                  placeholder={canPostAnnouncements ? 'Announcement title' : 'Only managers and admins can post announcements'}
                  disabled={sending || roomIsReadOnly}
                />
                <textarea
                  className={styles.announcementTextarea}
                  value={announcementForm.description}
                  onChange={e => setAnnouncementForm(current => ({ ...current, description: e.target.value }))}
                  placeholder={canPostAnnouncements ? 'Announcement description' : 'Only managers and admins can post announcements'}
                  disabled={sending || roomIsReadOnly}
                />
              </div>
            ) : (
              <input
                className={styles.textInput}
                value={text}
                onChange={e => handleTextChange(e.target.value)}
                placeholder={`Message ${activeRoom.label}...`}
                disabled={sending}
              />
            )}
            <button
              className="btn sm"
              type="submit"
              disabled={
                sending
                || roomIsReadOnly
                || (announcementRoomActive
                  ? !announcementForm.title.trim() || !announcementForm.description.trim()
                  : !text.trim())
              }>
              {sending ? <span className="spinner" style={{ width: 12, height: 12 }} /> : (announcementRoomActive ? 'Post' : 'Send')}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}

function formatTime(ts) {
  if (!ts?.toDate) return ''
  return ts.toDate().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function shouldShowMessageMood(message) {
  if (!message?.mood) return false
  if (typeof message?.showMoodOnMessages === 'boolean') return message.showMoodOnMessages
  return true
}

function shouldShowMessageMbti(message) {
  if (!message?.senderMbti) return false
  if (typeof message?.showMbtiOnMessages === 'boolean') return message.showMbtiOnMessages
  return true
}
