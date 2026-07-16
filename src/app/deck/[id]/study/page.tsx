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

function sortCardsByGroupAndPriority(cards: Card[]): Card[] {
  const getPriorityWeight = (priorityStr: string): number => {
    if (!priorityStr) return 0;
    if (priorityStr.includes('★★★★★')) return 5;
    if (priorityStr.includes('★★★★☆')) return 4;
    if (priorityStr.includes('★★★☆☆')) return 3;
    if (priorityStr.includes('★★☆☆☆')) return 2;
    if (priorityStr.includes('★☆☆☆☆')) return 1;
    return 0;
  };

  const mapped = cards.map(card => {
    let category = 'Miscellaneous';
    let priority = 0;
    try {
      const parsed = JSON.parse(card.originalRow);
      if (parsed) {
        category = parsed['Category'] || parsed['category'] || 'Miscellaneous';
        const priStr = parsed['AFCAT Priority'] || parsed['afcatPriority'] || parsed['Priority'] || '';
        priority = getPriorityWeight(priStr);
      }
    } catch (e) {
      // JSON parse error, fall back to default
    }
    return { card, category, priority };
  });

  mapped.sort((a, b) => {
    const catCompare = a.category.localeCompare(b.category);
    if (catCompare !== 0) return catCompare;
    return b.priority - a.priority; // higher priority first
  });

  return mapped.map(item => item.card);
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
        const sortedCards = sortCardsByGroupAndPriority(cardsData)
        setCards(sortedCards)
        setActiveQueue(sortedCards)
        setInitialActiveCount(sortedCards.length)
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
  let parsedRow: Record<string, any> | null = null
  let isJson = false
  try {
    const parsed = JSON.parse(currentCard.originalRow)
    if (typeof parsed === 'object' && parsed !== null) {
      parsedRow = parsed
      isJson = true
    }
  } catch (e) {
    // Keep parsedRow null
  }

  const getTags = (): string[] => {
    if (!parsedRow) return []
    const rawTags = parsedRow['Tags'] || parsedRow['tags'] || parsedRow['Tag'] || parsedRow['tag'] || ''
    if (Array.isArray(rawTags)) return rawTags
    if (typeof rawTags === 'string') {
      return rawTags.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0)
    }
    return []
  }

  const tagsList = getTags()
  const category = parsedRow ? (parsedRow['Category'] || parsedRow['category'] || '') : ''
  const qTemplate = parsedRow ? (parsedRow['Question Template'] || parsedRow['questionTemplate'] || '') : ''
  const topicProb = parsedRow ? (parsedRow['Topic Probability'] || parsedRow['topicProbability'] || parsedRow['AFCAT Priority'] || parsedRow['Priority'] || '') : ''
  const staticAnchor = parsedRow ? (parsedRow['Static Anchor'] || parsedRow['staticAnchor'] || '') : ''
  const factProb = parsedRow ? (parsedRow['Fact Probability'] || parsedRow['factProbability'] || '') : ''
  const reason = parsedRow ? (parsedRow['Reason'] || parsedRow['reason'] || '') : ''
  const staticGk = parsedRow ? (parsedRow['Static GK'] || parsedRow['staticGk'] || parsedRow['static_gk'] || '') : ''
  const sourceContext = parsedRow ? (parsedRow['Source'] || parsedRow['source'] || '') : ''

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
            <div className={styles.cardHeader}>
              <span className={styles.cardLabel}>Question</span>
              <div className={styles.tagBadgeContainer}>
                {category && <span className={styles.categoryBadge}>{category}</span>}
                {qTemplate && <span className={styles.templateBadge}>{qTemplate}</span>}
                {topicProb && <span className={styles.priorityBadge}>Topic: {topicProb}</span>}
              </div>
            </div>
            
            {tagsList.length > 0 && (
              <div className={styles.tagsContainer}>
                {tagsList.map((tag, idx) => (
                  <span key={idx} className={styles.tagPill}>#{tag}</span>
                ))}
              </div>
            )}
            
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
            
            {(staticAnchor || factProb || reason || staticGk || sourceContext) && (
              <div className={styles.cardBackMetadata} onClick={(e) => e.stopPropagation()}>
                {staticAnchor && (
                  <div className={styles.metadataItem}>
                    <strong>Static Anchor:</strong> <span className={styles.highlightText}>{staticAnchor}</span> {factProb && <span className={styles.factProbBadge}>Fact Prob: {factProb}</span>}
                  </div>
                )}
                {reason && (
                  <div className={styles.metadataItem}>
                    <strong>AFCAT Focus Reason:</strong> <span style={{ color: '#e2e8f0' }}>{reason}</span>
                  </div>
                )}
                {staticGk && (
                  <div className={styles.metadataItem}>
                    <strong>Static GK:</strong> {typeof staticGk === 'object' ? JSON.stringify(staticGk) : String(staticGk)}
                  </div>
                )}
                {sourceContext && (
                  <div className={styles.metadataItem}>
                    <strong>Source Context:</strong> {typeof sourceContext === 'object' ? JSON.stringify(sourceContext) : String(sourceContext)}
                  </div>
                )}
              </div>
            )}
            
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

    </div>
  )
}
