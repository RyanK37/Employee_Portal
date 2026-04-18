import { Client } from '@gradio/client'

let emotionClient = null
let mbtiClient = null

async function getEmotionClient() {
  if (!emotionClient) {
    emotionClient = await Client.connect('Win02/emotion-classifier')
  }
  return emotionClient
}

async function getMbtiClient() {
  if (!mbtiClient) {
    mbtiClient = await Client.connect('Win02/mbti-predictor')
  }
  return mbtiClient
}

export async function predictEmotion(text) {
  try {
    if (!text || text.trim().length < 3) return null
    const client = await getEmotionClient()
    const result = await client.predict('/predict', { text })
    const data = result.data

    if (Array.isArray(data)) {
      if (typeof data[0] === 'string') return data[0]
      if (data[0]?.label) return data[0].label
    }

    if (typeof data === 'string') return data
    return null
  } catch (err) {
    console.warn('Emotion API error:', err)
    return null
  }
}

export async function predictMBTI(text) {
  try {
    if (!text || text.trim().length < 10) return null
    const client = await getMbtiClient()
    const result = await client.predict('/predict_mbti_chunked', { text })
    const data = result.data

    if (Array.isArray(data)) {
      if (typeof data[0] === 'string') return data[0]
      if (data[0]?.mbti) return data[0].mbti
    }

    if (typeof data === 'string') return data
    return null
  } catch (err) {
    console.warn('MBTI API error:', err)
    return null
  }
}

export const EMOTION_EMOJI = {
  admiration: '🤩',
  amusement: '😂',
  anger: '😠',
  annoyance: '😤',
  approval: '✅',
  caring: '🤗',
  confusion: '😵',
  curiosity: '🤔',
  desire: '💭',
  disappointment: '😞',
  disapproval: '👎',
  disgust: '🤢',
  embarrassment: '😳',
  excitement: '😄',
  fear: '😨',
  gratitude: '🙏',
  grief: '😖',
  joy: '😊',
  love: '🥰',
  nervousness: '😰',
  optimism: '🌟',
  pride: '🏆',
  realization: '💡',
  relief: '😌',
  remorse: '😬',
  sadness: '😢',
  surprise: '😮',
  neutral: '😐',
}

export function getEmotionEmoji(emotion) {
  if (typeof emotion !== 'string') return '😐'
  const key = emotion.toLowerCase().replace(/[^a-z]/g, '')
  return EMOTION_EMOJI[key] || '😐'
}

export const MBTI_GROUPS = {
  NF: { types: ['ENFJ', 'ENFP', 'INFJ', 'INFP'], label: 'Idealist', color: '#2f6b4f', bg: '#e7f1eb', text: '#18382a' },
  NT: { types: ['ENTJ', 'ENTP', 'INTJ', 'INTP'], label: 'Analyst', color: '#3e7d63', bg: '#e4efe8', text: '#1c4c38' },
  SJ: { types: ['ESTJ', 'ESFJ', 'ISTJ', 'ISFJ'], label: 'Guardian', color: '#70817a', bg: '#edf2ef', text: '#3c4a44' },
  SP: { types: ['ESTP', 'ESFP', 'ISTP', 'ISFP'], label: 'Artisan', color: '#6d8250', bg: '#edf3e7', text: '#405028' },
}

export function getMbtiGroup(mbti) {
  if (typeof mbti !== 'string') return null
  for (const [group, data] of Object.entries(MBTI_GROUPS)) {
    if (data.types.includes(mbti.toUpperCase())) return { group, ...data }
  }
  return null
}

export const ALL_MBTI = [
  'ENFJ', 'ENFP', 'INFJ', 'INFP',
  'ENTJ', 'ENTP', 'INTJ', 'INTP',
  'ESTJ', 'ESFJ', 'ISTJ', 'ISFJ',
  'ESTP', 'ESFP', 'ISTP', 'ISFP',
]

export const MBTI_NAMES = {
  ENFJ: 'Protagonist',
  ENFP: 'Campaigner',
  INFJ: 'Advocate',
  INFP: 'Mediator',
  ENTJ: 'Commander',
  ENTP: 'Debater',
  INTJ: 'Architect',
  INTP: 'Logician',
  ESTJ: 'Executive',
  ESFJ: 'Consul',
  ISTJ: 'Logistician',
  ISFJ: 'Defender',
  ESTP: 'Entrepreneur',
  ESFP: 'Entertainer',
  ISTP: 'Virtuoso',
  ISFP: 'Adventurer',
}
