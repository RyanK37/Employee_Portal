import { useState } from 'react'
import { ALL_MBTI, MBTI_NAMES, getMbtiGroup } from '../utils/ai'
import styles from './MbtiModal.module.css'

const QUESTIONS = [
  { id: 'ei', label: 'Are you more Extroverted or Introverted?', options: [{ val:'E', label:'E — Extrovert', desc:'Energised by people & activity' }, { val:'I', label:'I — Introvert', desc:'Energised by solitude & reflection' }] },
  { id: 'sn', label: 'Do you prefer Sensing or iNtuition?',      options: [{ val:'S', label:'S — Sensing', desc:'Focus on facts & present reality' }, { val:'N', label:'N — iNtuition', desc:'Focus on patterns & future possibilities' }] },
  { id: 'tf', label: 'Do you rely on Thinking or Feeling?',      options: [{ val:'T', label:'T — Thinking', desc:'Decide with logic & objectivity' }, { val:'F', label:'F — Feeling', desc:'Decide with values & empathy' }] },
  { id: 'jp', label: 'Are you more Judging or Perceiving?',      options: [{ val:'J', label:'J — Judging', desc:'Prefer structure & decisions' }, { val:'P', label:'P — Perceiving', desc:'Prefer flexibility & options' }] },
]

export default function MbtiModal({ onSave }) {
  const [step, setStep] = useState('choose') // choose | know | questions | confirm
  const [knownInput, setKnownInput] = useState('')
  const [answers, setAnswers] = useState({ ei:'', sn:'', tf:'', jp:'' })
  const [result, setResult] = useState('')
  const [error, setError] = useState('')

  function handleKnownSave() {
    const val = knownInput.trim().toUpperCase()
    if (!ALL_MBTI.includes(val)) { setError('Please enter a valid 4-letter MBTI type.'); return }
    setResult(val)
    setStep('confirm')
  }

  function handleQuestionAnswer(id, val) {
    setAnswers(prev => ({ ...prev, [id]: val }))
  }

  function handleQuestionsSave() {
    const { ei, sn, tf, jp } = answers
    if (!ei || !sn || !tf || !jp) { setError('Please answer all 4 questions.'); return }
    const mbti = (ei + sn + tf + jp).toUpperCase()
    setResult(mbti)
    setStep('confirm')
  }

  function handleConfirm() {
    onSave(result)
  }

  const group = result ? getMbtiGroup(result) : null

  return (
    <div className={styles.overlay}>
      <div className={styles.modal + ' scale-in'}>
        <div className={styles.header}>
          <div className={styles.headerIcon}>🧠</div>
          <div>
            <h3 className={styles.title}>Tell us your MBTI</h3>
            <p className={styles.subtitle}>Personalises your chat tags. You can change this anytime.</p>
          </div>
        </div>

        {step === 'choose' && (
          <div className={styles.choices}>
            <button className={styles.choiceBtn} onClick={() => { setStep('know'); setError('') }}>
              <span className={styles.choiceIcon}>✅</span>
              <div>
                <div className={styles.choiceLabel}>I know my MBTI</div>
                <div className={styles.choiceDesc}>Enter your 4-letter type directly</div>
              </div>
            </button>
            <button className={styles.choiceBtn} onClick={() => { setStep('questions'); setError('') }}>
              <span className={styles.choiceIcon}>💬</span>
              <div>
                <div className={styles.choiceLabel}>Answer 4 quick questions</div>
                <div className={styles.choiceDesc}>Takes about 30 seconds</div>
              </div>
            </button>
            <a className={styles.choiceBtn} href="https://www.16personalities.com/free-personality-test" target="_blank" rel="noreferrer">
              <span className={styles.choiceIcon}>🌐</span>
              <div>
                <div className={styles.choiceLabel}>Take the full test</div>
                <div className={styles.choiceDesc}>Opens 16personalities.com in a new tab</div>
              </div>
            </a>
          </div>
        )}

        {step === 'know' && (
          <div className={styles.section}>
            <p className={styles.instruct}>Enter your 4-letter MBTI type:</p>
            <div className={styles.knownRow}>
              <input className="input" value={knownInput} maxLength={4}
                onChange={e => { setKnownInput(e.target.value.toUpperCase()); setError('') }}
                placeholder="e.g. INFP" style={{ textTransform:'uppercase', width:120, textAlign:'center', fontSize:15, fontWeight:600, letterSpacing:1 }} />
              <div className={styles.typeGrid}>
                {ALL_MBTI.map(t => (
                  <button key={t} className={styles.typeBtn + (knownInput===t ? ' '+styles.typeBtnActive : '')}
                    onClick={() => { setKnownInput(t); setError('') }}>{t}</button>
                ))}
              </div>
            </div>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.actions}>
              <button className="btn secondary sm" onClick={() => setStep('choose')}>Back</button>
              <button className="btn sm" onClick={handleKnownSave}>Continue</button>
            </div>
          </div>
        )}

        {step === 'questions' && (
          <div className={styles.section}>
            {QUESTIONS.map((q, i) => (
              <div key={q.id} className={styles.question}>
                <div className={styles.qLabel}><span className={styles.qNum}>{i+1}</span>{q.label}</div>
                <div className={styles.qOptions}>
                  {q.options.map(opt => (
                    <button key={opt.val}
                      className={styles.qOpt + (answers[q.id]===opt.val ? ' '+styles.qOptActive : '')}
                      onClick={() => { handleQuestionAnswer(q.id, opt.val); setError('') }}>
                      <strong>{opt.label}</strong>
                      <span>{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.actions}>
              <button className="btn secondary sm" onClick={() => setStep('choose')}>Back</button>
              <button className="btn sm" onClick={handleQuestionsSave}
                disabled={Object.values(answers).some(v => !v)}>See my type</button>
            </div>
          </div>
        )}

        {step === 'confirm' && group && (
          <div className={styles.section}>
            <div className={styles.resultCard} style={{ borderColor: group.color, background: group.bg }}>
              <div className={styles.resultType} style={{ color: group.text }}>{result}</div>
              <div className={styles.resultName} style={{ color: group.text }}>{MBTI_NAMES[result]}</div>
              <div className={styles.resultGroup} style={{ color: group.color }}>{group.label} · {group.group} group</div>
            </div>
            <p className={styles.instruct} style={{ textAlign:'center' }}>This will appear as a badge on your messages.</p>
            <div className={styles.actions} style={{ justifyContent:'center' }}>
              <button className="btn secondary sm" onClick={() => setStep('choose')}>Change</button>
              <button className="btn sm" onClick={handleConfirm} style={{ background: group.color }}>Save & continue</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
