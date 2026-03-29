process.env.BANNERSAGE_GAME = 'bannerlord'
process.env.BANNERSAGE_TOOLSET ||= 'query-first'

const { main } = await import('../stdio')

if (import.meta.main) {
  main().catch(error => {
    console.error('Fatal startup error:', error)
    process.exit(1)
  })
}
