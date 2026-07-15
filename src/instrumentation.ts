export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startNotificationScheduler } = await import('./lib/scheduler')
    startNotificationScheduler()
  }
}
