import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { name } = await req.json()
    
    if (!name || name.trim() === '') {
      return NextResponse.json({ error: 'Deck name cannot be empty.' }, { status: 400 })
    }

    const updatedDeck = await prisma.deck.update({
      where: { id },
      data: { name: name.trim() },
    })

    return NextResponse.json(updatedDeck)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await prisma.deck.delete({
      where: { id },
    })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
