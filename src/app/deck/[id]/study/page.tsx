'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { 
  ArrowLeft, 
  HelpCircle, 
  CheckCircle, 
  RotateCcw, 
  ChevronDown, 
  ChevronUp, 
  BookOpen, 
  Award,
  Database
} from 'lucide-react'
import styles from './page.module.css'

interface Card {
  id: string
  question: string
  answer: string
  originalRow: string
  state: string
  needsRepeat: boolean
  wrongInQuiz: boolean
}

export default function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const { id: deckId } = use(params)
  
  const [deckName, setDeckName] = useState('')
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState<Card[]>([])
  const [activeQueue, setActiveQueue] = useState<Card[]>([])
  
  // Stats
  const [initialActiveCount, setInitialActiveCount] = useState(0)
  const [completedCount, setCompletedCount] = useState(0)
  
  // Flip State
  const [flipped, setFlipped] = useState(false)
  
  // Expand metadata state
  const [showMetadata, setShowMetadata] = useState(false)

  useEffect(() => {
    loadDeck()
  }, [deckId])

  useEffect(() => {
    if (cards.length > 0 && activeQueue.length === 0 && initialActiveCount > 0) {
      fetch(`/api/decks/${deckId}/complete`, { method: 'POST' })
        .catch(err => console.error('Failed to report deck completion:', err))
    }
  }, [activeQueue.length, cards.length, deckId, initialActiveCount])

  const loadDeck = async () => {
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

      // Load active cards
      const cardsRes = await fetch(`/api/cards?deckId=${deckId}`)
      if (cardsRes.ok) {
        const cardsData = await cardsRes.json()
        setCards(cardsData)
        setActiveQueue(cardsData)
        setInitialActiveCount(cardsData.length)
      }
    } catch (err) {
      console.error('Failed to load study deck:', err)
    } finally {
      setLoading(false)
    }
  }

  // Answer response: Yes, repeat this card later
  const handleRepeatCard = () => {
    setFlipped(false)
    setShowMetadata(false)
    
    // Rotate: Move the front card to the back of the queue
    setTimeout(() => {
      if (activeQueue.length > 1) {
        setActiveQueue([...activeQueue.slice(1), activeQueue[0]])
      }
    }, 200) // slight delay to let flip animation finish
  }

  // Answer response: No, card is mastered for now
  const handleMasteredCard = async () => {
    if (activeQueue.length === 0) return
    
    const currentCard = activeQueue[0]
    setFlipped(false)
    setShowMetadata(false)

    // Save mastered state in the DB
    try {
      await fetch('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId: currentCard.id,
          needsRepeat: false,
          state: 'mastered',
        }),
      })
    } catch (err) {
      console.error('Failed to save card progress:', err)
    }

    // Remove from active queue
    setTimeout(() => {
      setActiveQueue(activeQueue.slice(1))
      setCompletedCount(prev => prev + 1)
    }, 200)
  }

  if (loading) {
    return <div className="container" style={{ textAlign: 'center', padding: '60px 0' }}>Loading Flashcards...</div>
  }

  // Handle empty deck case on load
  if (cards.length === 0 && initialActiveCount === 0) {
    return (
      <div className={`${styles.studyContainer} container animate-fade-in`}>
        <div className={styles.header}>
          <Link href="/" className={styles.backLink}>
            <ArrowLeft size={16} />
            <span>Back to Dashboard</span>
          </Link>
        </div>
        <div className={`${styles.completedScreen} glass-panel`}>
          <div className={styles.completionIcon}>
            <Award size={40} />
          </div>
          <h2>Fully Mastered! 🎉</h2>
          <p>
            Amazing! You have mastered all cards in the <strong>{deckName}</strong> stack.
            There are no cards in the active study queue.
          </p>
          <button 
            onClick={() => router.push(`/deck/${deckId}/quiz`)}
            className="btn-primary"
          >
            Take the MCQ Quiz
          </button>
        </div>
      </div>
    )
  }

  // Study completed screen
  if (activeQueue.length === 0) {
    return (
      <div className={`${styles.studyContainer} container animate-fade-in`}>
        <div className={styles.header}>
          <Link href="/" className={styles.backLink}>
            <ArrowLeft size={16} />
            <span>Dashboard</span>
          </Link>
          <div className={styles.deckName}>{deckName}</div>
        </div>

        <div className={`${styles.completedScreen} glass-panel`}>
          <div className={styles.completionIcon}>
            <CheckCircle size={40} />
          </div>
          <h2>Study Stack Completed!</h2>
          <p>
            You reviewed all the flashcards in this session. Now test your knowledge by taking a multiple-choice question exam!
          </p>
          
          <div className="flex gap-4" style={{ display: 'flex', gap: '16px' }}>
            <button 
              onClick={() => router.push(`/deck/${deckId}/quiz`)}
              className="btn-primary"
            >
              Start MCQ Quiz
            </button>
            <button 
              onClick={loadDeck} 
              className="btn-secondary"
            >
              <RotateCcw size={16} />
              <span>Review Deck Again</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  const currentCard = activeQueue[0]
  
  // Attempt to parse metadata (CSV originalRow)
  let parsedRow: Record<string, string> | null = null
  let isJson = false
  try {
    const parsed = JSON.parse(currentCard.originalRow)
    if (typeof parsed === 'object' && parsed !== null) {
      parsedRow = parsed
      isJson = true
    }
  } catch (e) {
    // Keep parsedRow null, it will fall back to raw string
  }

  const studyProgress = initialActiveCount > 0 
    ? Math.round((completedCount / initialActiveCount) * 100) 
    : 0

  return (
    <div className={`${styles.studyContainer} container animate-fade-in`}>
      
      {/* Header */}
      <div className={styles.header}>
        <Link href="/" className={styles.backLink}>
          <ArrowLeft size={16} />
          <span>Dashboard</span>
        </Link>
        <div className={styles.deckName}>{deckName}</div>
      </div>

      {/* Progress Bar */}
      <div className={styles.progressBarContainer}>
        <div className={styles.progressStats}>
          <span>Session Progress</span>
          <span>{completedCount} of {initialActiveCount} cards learned</span>
        </div>
        <div className={styles.progressBar}>
          <div 
            className={styles.progressFill} 
            style={{ width: `${studyProgress}%` }}
          ></div>
        </div>
      </div>

      {/* 3D Flashcard */}
      <div className={styles.cardWrapper} onClick={() => setFlipped(!flipped)}>
        <div className={`${styles.cardInner} ${flipped ? styles.flipped : ''}`}>
          
          {/* Card Front */}
          <div className={styles.cardFront}>
            <span className={styles.cardLabel}>Question</span>
            <p className={styles.questionText}>{currentCard.question}</p>
            <span className={styles.hint}>
              <HelpCircle size={14} />
              <span>Click card to reveal answer</span>
            </span>
          </div>

          {/* Card Back */}
          <div className={styles.cardBack}>
            <span className={styles.cardLabel}>Answer</span>
            <p className={styles.answerText}>{currentCard.answer}</p>
            <span className={styles.hint}>
              <span>Click card to show question</span>
            </span>
          </div>

        </div>
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        {!flipped ? (
          <button 
            onClick={() => setFlipped(true)} 
            className={`${styles.revealBtn} btn-primary`}
          >
            Reveal Answer
          </button>
        ) : (
          <div className={styles.promptBox}>
            <p className={styles.promptTitle}>Ask again in the current stack?</p>
            <div className={styles.promptBtns}>
              <button 
                onClick={handleRepeatCard}
                className={styles.yesBtn}
              >
                Yes (Repeat)
              </button>
              <button 
                onClick={handleMasteredCard}
                className={styles.noBtn}
              >
                No (Mastered)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Metadata Context Drawer */}
      <div className={`${styles.metadataPanel} glass-panel`}>
        <div 
          className={styles.metadataHeader} 
          onClick={() => setShowMetadata(!showMetadata)}
        >
          <h4>
            <Database size={16} />
            <span>CSV Source Metadata Context</span>
          </h4>
          {showMetadata ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
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
              <p className={styles.metaValue}>{currentCard.originalRow}</p>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
