import cron from 'node-cron'
import { prisma } from './db'
import { sendEmail } from './email'

let isSchedulerRunning = false

export function startNotificationScheduler() {
  if (isSchedulerRunning) {
    console.log('[Scheduler] Already running.')
    return
  }

  isSchedulerRunning = true
  console.log('[Scheduler] Initializing background email notification scheduler (runs every minute)...')

  // Run every minute
  cron.schedule('* * * * *', async () => {
    try {
      await processSpacedRepetitionReviews()
      await checkAndSendNotifications()
    } catch (err) {
      console.error('[Scheduler] Error running notification check:', err)
    }
  })
}

export async function checkAndSendNotifications() {
  const users = await prisma.user.findMany({
    where: {
      notificationTime: {
        not: null,
      },
    },
    include: {
      decks: {
        include: {
          cards: true,
        },
      },
    },
  })

  const now = new Date()

  for (const user of users) {
    if (!user.notificationTime) continue

    // Determine current hour and minute in the user's timezone
    let currentHourStr = ''
    let currentMinuteStr = ''
    let todayDateStr = ''
    
    try {
      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: user.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      const dateFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: user.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })

      const timeParts = timeFormatter.format(now).split(':')
      currentHourStr = timeParts[0]
      currentMinuteStr = timeParts[1]
      todayDateStr = dateFormatter.format(now)
    } catch (e) {
      // Fallback if timezone is invalid
      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      const dateFormatter = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      const timeParts = timeFormatter.format(now).split(':')
      currentHourStr = timeParts[0]
      currentMinuteStr = timeParts[1]
      todayDateStr = dateFormatter.format(now)
    }

    const [targetHour, targetMinute] = user.notificationTime.split(':')

    // Check if the current time matches the scheduled time
    if (currentHourStr === targetHour && currentMinuteStr === targetMinute) {
      // Check if already notified today
      let alreadyNotified = false
      if (user.lastNotifiedAt) {
        try {
          const dateFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: user.timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          })
          const lastNotifiedDateStr = dateFormatter.format(user.lastNotifiedAt)
          if (lastNotifiedDateStr === todayDateStr) {
            alreadyNotified = true
          }
        } catch (e) {
          // Fallback comparison
          alreadyNotified = user.lastNotifiedAt.toDateString() === now.toDateString()
        }
      }

      if (!alreadyNotified) {
        console.log(`[Scheduler] Sending notification to ${user.email}...`)
        
        // Build study status digest
        let deckListHtml = ''
        if (user.decks.length === 0) {
          deckListHtml = '<p>You have no study decks created yet! Upload a CSV to get started.</p>'
        } else {
          deckListHtml = '<ul style="list-style-type: none; padding: 0;">'
          for (const deck of user.decks) {
            const totalCards = deck.cards.length
            const activeCards = deck.cards.filter((c: { needsRepeat: boolean }) => c.needsRepeat).length
            const masteredCards = totalCards - activeCards
            const pct = totalCards > 0 ? Math.round((masteredCards / totalCards) * 100) : 0
            
            deckListHtml += `
              <li style="margin-bottom: 12px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <strong style="font-size: 16px;">${deck.name}</strong><br/>
                <span style="color: #64748b;">${activeCards} cards left to review / ${masteredCards} mastered (${pct}%)</span>
                <div style="background-color: #f1f5f9; width: 100%; height: 8px; border-radius: 4px; margin-top: 6px; overflow: hidden;">
                  <div style="background-color: #6366f1; width: ${pct}%; height: 100%;"></div>
                </div>
              </li>
            `
          }
          deckListHtml += '</ul>'
        }

        const emailHtml = `
          <div style="font-family: 'Outfit', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; color: #1e293b;">
            <h2 style="color: #4f46e5; margin-bottom: 8px;">Daily Study Reminder 📚</h2>
            <p>Hi ${user.name || 'Student'},</p>
            <p>Consistency is key to retaining knowledge! Here is the status of your study stacks:</p>
            <div style="margin: 20px 0;">
              ${deckListHtml}
            </div>
            <p>Click below to open your dashboard and start studying:</p>
            <a href="http://localhost:3000" style="display: inline-block; background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 10px;">Start Study Session</a>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="font-size: 12px; color: #94a3b8;">To change your reminder time, visit the Settings page in your app.</p>
          </div>
        `

        const emailSent = await sendEmail({
          to: user.email,
          subject: 'Your Daily Flashcards Study Reminder 📚',
          html: emailHtml,
        })

        if (emailSent.success) {
          await prisma.user.update({
            where: { id: user.id },
            data: { lastNotifiedAt: now },
          })
          console.log(`[Scheduler] Notification logged and user updated for ${user.email}.`)
        }
      }
    }
  }
}

export async function processSpacedRepetitionReviews() {
  const now = new Date()
  const pendingDecks = await prisma.deck.findMany({
    where: {
      nextReviewAt: {
        lte: now,
      },
    },
    include: {
      user: true,
    },
  })

  if (pendingDecks.length === 0) return

  console.log(`[SpacedRepetition] Found ${pendingDecks.length} decks due for spaced repetition review.`)

  for (const deck of pendingDecks) {
    // 1. Reset all cards in the deck to needsRepeat = true so it shows revision not completed
    await prisma.card.updateMany({
      where: { deckId: deck.id },
      data: { needsRepeat: true },
    })

    // 2. Clear nextReviewAt so we don't process it again
    await prisma.deck.update({
      where: { id: deck.id },
      data: { nextReviewAt: null },
    })

    // 3. Send the notification email to the user
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const reviewUrl = `${appUrl}/deck/${deck.id}/study`
      const emailHtml = `
        <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #4f46e5; margin-bottom: 16px;">Spaced Repetition Review Required 🔔</h2>
          <p>Hi ${deck.user.name || 'Student'},</p>
          <p>It's time to revise your study deck: <strong>${deck.name}</strong>.</p>
          <p>Consistent active-recall at spaced intervals is key to long-term memory retention. All cards in this stack have been reset to active study mode.</p>
          <div style="margin: 24px 0;">
            <a href="${reviewUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Start Revision Session</a>
          </div>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="font-size: 12px; color: #64748b;">This is an automated notification from your Smart Flashcards & MCQ Platform.</p>
        </div>
      `
      await sendEmail({
        to: deck.user.email,
        subject: `🔔 Spaced Repetition: Time to review "${deck.name}"`,
        html: emailHtml,
      })
      console.log(`[SpacedRepetition] Sent review alert to ${deck.user.email} for deck "${deck.name}"`)
    } catch (emailErr) {
      console.error(`[SpacedRepetition] Failed to send review alert for deck "${deck.name}":`, emailErr)
    }
  }
}
