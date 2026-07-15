import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getOrCreateDefaultUser } from '@/lib/user'

export async function GET() {
  try {
    const user = await getOrCreateDefaultUser()
    return NextResponse.json(user)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await getOrCreateDefaultUser()
    const { notificationTime, timezone } = await req.json()

    // Validate notificationTime format (HH:MM)
    if (notificationTime && !/^\d{2}:\d{2}$/.test(notificationTime)) {
      return NextResponse.json({ error: 'Invalid time format. Use HH:MM.' }, { status: 400 })
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        notificationTime: notificationTime || null,
        timezone: timezone || user.timezone,
      },
    })

    return NextResponse.json(updatedUser)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
