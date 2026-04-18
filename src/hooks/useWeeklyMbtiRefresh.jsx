import { useEffect, useRef } from 'react'
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { ALL_MBTI, predictMBTI } from '../utils/ai'
import { getMessageTimestampMs } from '../utils/messages'
import { isAnnouncementMessage } from '../utils/chat'
import { isManagerOrAdmin } from '../utils/roles'

const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const RUNNING_GRACE_MS = 15 * 60 * 1000
const MAX_MESSAGES_PER_USER = 40
const MAX_CORPUS_LENGTH = 6000
const MIN_MESSAGES_PER_USER = 3
const MIN_CORPUS_LENGTH = 80

export function useWeeklyMbtiRefresh(user, profile) {
  const hasCheckedRef = useRef(false)

  useEffect(() => {
    if (!user?.uid || !profile || !isManagerOrAdmin(profile?.role) || hasCheckedRef.current) return

    hasCheckedRef.current = true
    let cancelled = false

    async function refreshMbtiProfiles() {
      const refreshRef = doc(db, 'system', 'mbtiClassifier')
      const actorName = String(profile?.displayName || user.email || user.uid)
      const debugPrefix = '[MBTI Refresh]'

      try {
        console.info(`${debugPrefix} check started`, {
          actorUid: user.uid,
          actorRole: profile?.role,
        })
        const refreshSnap = await getDoc(refreshRef)
        const refreshData = refreshSnap.exists() ? refreshSnap.data() : {}
        const lastRunMs = getTimestampMs(refreshData?.lastRunAt)
        const startedAtMs = getTimestampMs(refreshData?.startedAt)
        const status = String(refreshData?.status || '')

        window.__mbtiRefreshDebug = {
          stage: 'checked',
          actorUid: user.uid,
          actorRole: profile?.role,
          status,
          lastRunMs,
          startedAtMs,
          checkedAt: Date.now(),
        }

        if (lastRunMs && Date.now() - lastRunMs < REFRESH_INTERVAL_MS) {
          console.info(`${debugPrefix} skipped because cooldown is active`, {
            msRemaining: REFRESH_INTERVAL_MS - (Date.now() - lastRunMs),
            status,
          })
          window.__mbtiRefreshDebug = {
            ...window.__mbtiRefreshDebug,
            stage: 'skipped-cooldown',
            msRemaining: REFRESH_INTERVAL_MS - (Date.now() - lastRunMs),
          }
          return
        }
        if (status === 'running' && startedAtMs && Date.now() - startedAtMs < RUNNING_GRACE_MS) {
          console.info(`${debugPrefix} skipped because another run is marked as running`, {
            msRemaining: RUNNING_GRACE_MS - (Date.now() - startedAtMs),
          })
          window.__mbtiRefreshDebug = {
            ...window.__mbtiRefreshDebug,
            stage: 'skipped-running',
            msRemaining: RUNNING_GRACE_MS - (Date.now() - startedAtMs),
          }
          return
        }

        await setDoc(refreshRef, {
          status: 'running',
          startedAt: serverTimestamp(),
          startedByUid: user.uid,
          startedByName: actorName,
          lastError: '',
        }, { merge: true })
        console.info(`${debugPrefix} started`)

        const [usersSnap, messagesSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'messages')),
        ])

        if (cancelled) return

        const users = usersSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
        const messagesByUser = groupMessagesBySender(messagesSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })))
        console.info(`${debugPrefix} loaded source data`, {
          users: users.length,
          messages: messagesSnap.size,
        })

        let processedUsers = 0
        let updatedUsers = 0
        let skippedForLowSignal = 0

        for (const userRecord of users) {
          if (cancelled) return

          const userId = String(userRecord?.uid || userRecord?.id || '')
          if (!userId) continue

          const corpus = buildUserCorpus(messagesByUser.get(userId) || [])
          if (!corpus) {
            skippedForLowSignal += 1
            continue
          }

          processedUsers += 1
          const predictedMbti = normalizePredictedMbti(await predictMBTI(corpus))
          console.info(`${debugPrefix} classified user`, {
            userId,
            previousMbti: String(userRecord?.mbti || '').toUpperCase(),
            predictedMbti,
          })
          if (!predictedMbti) continue

          if (predictedMbti === String(userRecord?.mbti || '').toUpperCase()) continue

          await updateDoc(doc(db, 'users', userId), {
            mbti: predictedMbti,
            mbtiUpdatedAt: serverTimestamp(),
            mbtiSource: 'weekly-classifier',
          })

          updatedUsers += 1
        }

        await setDoc(refreshRef, {
          status: 'idle',
          lastRunAt: serverTimestamp(),
          lastRunByUid: user.uid,
          lastRunByName: actorName,
          processedUsers,
          updatedUsers,
          lastError: '',
        }, { merge: true })
        console.info(`${debugPrefix} completed`, {
          processedUsers,
          updatedUsers,
          skippedForLowSignal,
        })
        window.__mbtiRefreshDebug = {
          ...window.__mbtiRefreshDebug,
          stage: 'completed',
          processedUsers,
          updatedUsers,
          skippedForLowSignal,
          completedAt: Date.now(),
        }
      } catch (err) {
        console.error(`${debugPrefix} failed`, err)
        if (cancelled) return

        await setDoc(refreshRef, {
          status: 'error',
          lastError: String(err?.message || 'MBTI refresh failed'),
          lastRunByUid: user.uid,
          lastRunByName: actorName,
        }, { merge: true })
        window.__mbtiRefreshDebug = {
          ...window.__mbtiRefreshDebug,
          stage: 'error',
          error: String(err?.message || 'MBTI refresh failed'),
          failedAt: Date.now(),
        }
      }
    }

    refreshMbtiProfiles()

    return () => {
      cancelled = true
    }
  }, [profile, user])
}

function groupMessagesBySender(messages) {
  const grouped = new Map()

  messages
    .filter(message => !isAnnouncementMessage(message) && typeof message?.text === 'string' && message.text.trim())
    .sort((left, right) => getMessageTimestampMs(right?.createdAt) - getMessageTimestampMs(left?.createdAt))
    .forEach(message => {
      const senderId = String(message?.senderId || '')
      if (!senderId) return

      if (!grouped.has(senderId)) grouped.set(senderId, [])
      grouped.get(senderId).push(message.text.trim())
    })

  return grouped
}

function buildUserCorpus(messages) {
  if (!Array.isArray(messages) || messages.length < MIN_MESSAGES_PER_USER) return ''

  const selectedMessages = messages.slice(0, MAX_MESSAGES_PER_USER)
  let corpus = selectedMessages.join('\n\n')

  if (corpus.length > MAX_CORPUS_LENGTH) {
    corpus = corpus.slice(0, MAX_CORPUS_LENGTH)
  }

  return corpus.trim().length >= MIN_CORPUS_LENGTH ? corpus.trim() : ''
}

function normalizePredictedMbti(value) {
  const normalized = String(value || '').trim().toUpperCase()
  return ALL_MBTI.includes(normalized) ? normalized : ''
}

function getTimestampMs(value) {
  if (value?.toDate) return value.toDate().getTime()
  return 0
}
