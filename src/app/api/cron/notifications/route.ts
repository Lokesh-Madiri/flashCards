import { NextResponse } from 'next/server'
import { checkAndSendNotifications } from '@/lib/scheduler'
import { getOrCreateDefaultUser } from '@/lib/user'
import { sendEmail } from '@/lib/email'
import { prisma } from '@/lib/db'
import fs from 'fs'
import path from 'path'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const isTest = searchParams.get('test') === 'true'

    if (isTest) {
      // Trigger an immediate notification send to the default user for testing
      const user = await getOrCreateDefaultUser()
      
      // Fetch user's decks to compile stats
      const userDecks = await prisma.deck.findMany({
        where: { userId: user.id },
        include: { cards: true }
      })

      let deckListHtml = ''
      if (userDecks.length === 0) {
        deckListHtml = '<p>You have no study decks created yet! Upload a CSV to get started.</p>'
      } else {
        deckListHtml = '<ul style="list-style-type: none; padding: 0;">'
        for (const deck of userDecks) {
          const totalCards = deck.cards.length
          const activeCards = deck.cards.filter(c => c.needsRepeat).length
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
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; color: #1e293b;">
          <h2 style="color: #4f46e5; margin-bottom: 8px;">Test Study Reminder 📚</h2>
          <p>Hi ${user.name || 'Student'},</p>
          <p>This is a manual test email triggered from your settings. Here is your current deck study progress:</p>
          <div style="margin: 20px 0;">
            ${deckListHtml}
          </div>
          <p>Click below to open your dashboard and start studying:</p>
          <a href="http://localhost:3000" style="display: inline-block; background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 10px;">Start Study Session</a>
        </div>
      `

      const result = await sendEmail({
        to: user.email,
        subject: 'Test Notification - Antigravity Recall 📚',
        html: emailHtml
      })

      // Try to read simulated log if exists
      let logContents = ''
      try {
        const logPath = path.join(process.cwd(), 'prisma/sent_emails.log')
        if (fs.existsSync(logPath)) {
          logContents = fs.readFileSync(logPath, 'utf8')
        }
      } catch (logErr) {
        console.error('Could not read log file:', logErr)
      }

      return NextResponse.json({ 
        success: true, 
        message: result.message,
        logContents: logContents.split('=========================================').slice(-2).join('=========================================')
      })
    }

    // Standard cron behavior
    await checkAndSendNotifications()
    return NextResponse.json({ success: true, message: 'Cron notifications check completed.' })
  } catch (err: any) {
    console.error('Cron endpoint failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
