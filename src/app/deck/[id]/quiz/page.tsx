'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { 
  ArrowLeft, 
  ArrowRight, 
  Check, 
  X, 
  RotateCcw, 
  ChevronDown, 
  ChevronUp, 
  AlertCircle,
  Database,
  Award,
  Sparkles
} from 'lucide-react'
import styles from './page.module.css'

interface Question {
  id: string
  question: string
  options: string[]
  correctAnswer: string
  originalRow: string
}

export default function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const { id: deckId } = use(params)
  
  const [deckName, setDeckName] = useState('')
  const [loading, setLoading] = useState(true)
  const [questions, setQuestions] = useState<Question[]>([])
  
  // Game states
  const [currentIdx, setCurrentIdx] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null)
  const [isAnswered, setIsAnswered] = useState(false)
  const [wrongCardIds, setWrongCardIds] = useState<string[]>([])
  const [correctCount, setCorrectCount] = useState(0)
  const [quizFinished, setQuizFinished] = useState(false)
  const [savingResults, setSavingResults] = useState(false)

  // Track wrong answers for review screen
  const [wrongAnswersReview, setWrongAnswersReview] = useState<Array<{
    question: string
    userAnswer: string
    correctAnswer: string
  }>>([])

  // Expand metadata state
  const [showMetadata, setShowMetadata] = useState(false)

  useEffect(() => {
    loadQuiz()
  }, [deckId])

  const loadQuiz = async () => {
    try {
      setLoading(true)
      
      // Load deck info to get the name
      const decksRes = await fetch('/api/decks')
      if (decksRes.ok) {
        const decksData = await decksRes.json()
        const currentDeck = decksData.find((d: any) => d.id === deckId)
        if (currentDeck) {
          setDeckName(currentDeck.name)
        }
      }

      // Load quiz questions
      const quizRes = await fetch(`/api/quiz?deckId=${deckId}`)
      if (quizRes.ok) {
        const data = await quizRes.json()
        setQuestions(data)
      }
    } catch (err) {
      console.error('Failed to load quiz:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectAnswer = (option: string) => {
    if (isAnswered) return
    
    setSelectedAnswer(option)
    setIsAnswered(true)
    
    const currentQ = questions[currentIdx]
    const isCorrect = option.toLowerCase() === currentQ.correctAnswer.toLowerCase()

    if (isCorrect) {
      setCorrectCount(prev => prev + 1)
    } else {
      setWrongCardIds(prev => [...prev, currentQ.id])
      setWrongAnswersReview(prev => [...prev, {
        question: currentQ.question,
        userAnswer: option,
        correctAnswer: currentQ.correctAnswer
      }])
    }
  }

  const handleNext = () => {
    setIsAnswered(false)
    setSelectedAnswer(null)
    setShowMetadata(false)

    if (currentIdx + 1 < questions.length) {
      setCurrentIdx(currentIdx + 1)
    } else {
      setQuizFinished(true)
    }
  }

  const handleFinishQuiz = async () => {
    setSavingResults(true)
    const score = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0
    
    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckId,
          score,
          totalQ: questions.length,
          correctQ: correctCount,
          wrongCardIds,
        }),
      })

      if (res.ok) {
        // Redirect back to study screen if they have wrong answers, so they can learn them again!
        if (wrongCardIds.length > 0) {
          alert(`Quiz results saved! ${wrongCardIds.length} incorrect questions have been injected back into your active study stack for review.`)
          router.push(`/deck/${deckId}/study`)
        } else {
          alert('Perfect score! You have successfully mastered this deck.')
          router.push('/')
        }
      }
    } catch (err) {
      console.error('Failed to save quiz results:', err)
      setSavingResults(false)
    }
  }

  if (loading) {
    return <div className="container" style={{ textAlign: 'center', padding: '60px 0' }}>Loading Quiz Questions...</div>
  }

  if (questions.length === 0) {
    return (
      <div className={`${styles.quizContainer} container animate-fade-in`}>
        <div className={styles.header}>
          <Link href="/" className={styles.backLink}>
            <ArrowLeft size={16} />
            <span>Dashboard</span>
          </Link>
        </div>
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
          <h2>No questions available</h2>
          <p style={{ color: 'var(--text-muted)', margin: '12px 0 24px' }}>
            We could not generate any quiz questions for this deck. Please make sure the deck has flashcards.
          </p>
          <Link href="/" className="btn-primary">Return to Dashboard</Link>
        </div>
      </div>
    )
  }

  // Quiz Finished Results Screen
  if (quizFinished) {
    const scorePct = Math.round((correctCount / questions.length) * 100)
    const isPerfect = scorePct === 100

    return (
      <div className={`${styles.quizContainer} container animate-fade-in`}>
        <div className={styles.header}>
          <div className={styles.backLink} style={{ cursor: 'pointer' }} onClick={() => router.push('/')}>
            <ArrowLeft size={16} />
            <span>Dashboard</span>
          </div>
          <div className={styles.deckName}>{deckName}</div>
        </div>

        <div className={`${styles.resultsCard} glass-panel`}>
          <div className={`${styles.scoreCircle} ${isPerfect ? styles.perfect : ''}`}>
            <span className={styles.scoreNum}>{scorePct}%</span>
            <span className={styles.scoreLabel}>Score</span>
          </div>

          <div className={styles.resultsSummary}>
            <h2>{isPerfect ? 'Excellent Job! 🏆' : 'Quiz Completed!'}</h2>
            <p>You answered {correctCount} out of {questions.length} questions correctly.</p>
          </div>

          {wrongCardIds.length > 0 ? (
            <div className={styles.requeuedStats}>
              <AlertCircle size={18} />
              <span>{wrongCardIds.length} wrong answers will be re-queued back in your Flashcards stack!</span>
            </div>
          ) : (
            <div className={`${styles.requeuedStats} ${styles.perfect}`}>
              <Sparkles size={18} />
              <span>Perfect score! All flashcards in this stack remain mastered!</span>
            </div>
          )}

          {wrongAnswersReview.length > 0 && (
            <div className={styles.reviewSection}>
              <h3>Review Wrong Answers</h3>
              <div className={styles.reviewList}>
                {wrongAnswersReview.map((item, idx) => (
                  <div key={idx} className={styles.reviewItem}>
                    <div className={styles.reviewQuestion}>{item.question}</div>
                    <div className={styles.reviewAnswers}>
                      <span className={styles.wrongAnswer}>
                        <X size={14} />
                        <span>Your answer: {item.userAnswer}</span>
                      </span>
                      <span className={styles.rightAnswer}>
                        <Check size={14} />
                        <span>Correct: {item.correctAnswer}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleFinishQuiz}
            className="btn-primary"
            disabled={savingResults}
            style={{ width: '100%' }}
          >
            {savingResults ? 'Saving Results...' : wrongCardIds.length > 0 ? 'Complete Quiz & Re-study Wrong Cards' : 'Finish & Exit'}
          </button>
        </div>
      </div>
    )
  }

  const currentQ = questions[currentIdx]
  const progressPct = Math.round(((currentIdx) / questions.length) * 100)

  // Parse Metadata CSV row for displaying below question
  let parsedRow: Record<string, string> | null = null
  let isJson = false
  try {
    const parsed = JSON.parse(currentQ.originalRow)
    if (typeof parsed === 'object' && parsed !== null) {
      parsedRow = parsed
      isJson = true
    }
  } catch (e) {
    // Keep parsedRow null, it will display as raw string
  }

  return (
    <div className={`${styles.quizContainer} container animate-fade-in`}>
      
      {/* Header */}
      <div className={styles.header}>
        <Link href={`/deck/${deckId}/study`} className={styles.backLink}>
          <ArrowLeft size={16} />
          <span>Exit Quiz</span>
        </Link>
        <div className={styles.deckName}>{deckName}</div>
      </div>

      {/* Progress */}
      <div className={styles.quizProgress}>
        <div className={styles.progressLabel}>
          <span>Question {currentIdx + 1} of {questions.length}</span>
          <span>{progressPct}%</span>
        </div>
        <div className={styles.progressBar}>
          <div 
            className={styles.progressFill}
            style={{ width: `${progressPct}%` }}
          ></div>
        </div>
      </div>

      {/* Question Card */}
      <div className={`${styles.questionCard} glass-panel`}>
        <div className={styles.questionText}>
          {currentQ.question}
        </div>

        <div className={styles.optionsList}>
          {currentQ.options.map((option, idx) => {
            const isSelected = selectedAnswer === option
            const isCorrect = option.toLowerCase() === currentQ.correctAnswer.toLowerCase()
            
            let btnClass = styles.optionBtn
            let icon = null

            if (isAnswered) {
              if (isCorrect) {
                btnClass = `${styles.optionBtn} ${styles.correct}`
                icon = <Check size={16} style={{ color: 'var(--success)' }} />
              } else if (isSelected) {
                btnClass = `${styles.optionBtn} ${styles.incorrect}`
                icon = <X size={16} style={{ color: 'var(--danger)' }} />
              }
            } else if (isSelected) {
              btnClass = `${styles.optionBtn} ${styles.selected}`
            }

            return (
              <button
                key={idx}
                onClick={() => handleSelectAnswer(option)}
                disabled={isAnswered}
                className={btnClass}
              >
                <span>{option}</span>
                {icon}
              </button>
            )
          })}
        </div>

        {isAnswered && (
          <div className={styles.footer}>
            <button 
              onClick={handleNext} 
              className="btn-primary"
            >
              <span>{currentIdx + 1 < questions.length ? 'Next Question' : 'View Quiz Results'}</span>
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* CSV Context Metadata Panel */}
      <div className={`${styles.metadataPanel} glass-panel`}>
        <div 
          className={styles.metadataHeader} 
          onClick={() => setShowMetadata(!showMetadata)}
        >
          <h4>
            <Database size={14} />
            <span>CSV Source Metadata Context</span>
          </h4>
          {showMetadata ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
        
        {showMetadata && (
          <div className={styles.metadataContent}>
            {isJson && parsedRow ? (
              <div className={styles.metadataGrid}>
                {Object.entries(parsedRow).map(([key, val]) => (
                  <div key={key} style={{ display: 'contents' }}>
                    <span className={styles.metaLabel}>{key}:</span>
                    <span className={styles.metaValue}>{val}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.metaValue}>{currentQ.originalRow}</p>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
