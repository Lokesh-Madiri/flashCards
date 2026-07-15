import { prisma } from './db'

export const DEFAULT_USER_ID = 'default-user-id'

export async function getOrCreateDefaultUser() {
  console.log(`[UserHelper] getOrCreateDefaultUser: querying user ${DEFAULT_USER_ID}`)
  let user = await prisma.user.findUnique({
    where: { id: DEFAULT_USER_ID }
  })
  
  if (!user) {
    console.log(`[UserHelper] getOrCreateDefaultUser: user not found, creating default user...`)
    user = await prisma.user.create({
      data: {
        id: DEFAULT_USER_ID,
        email: 'user@example.com',
        name: 'Personal User',
        notificationTime: '09:00',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      },
    })
    console.log(`[UserHelper] getOrCreateDefaultUser: default user created successfully`)
  } else {
    console.log(`[UserHelper] getOrCreateDefaultUser: default user found`)
  }
  
  return user
}
