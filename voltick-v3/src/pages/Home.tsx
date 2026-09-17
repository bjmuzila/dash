import BoardPage from '@/board/BoardPage'

// Home is the terminal: a customizable card board (see src/board/BoardPage.tsx
// and src/board/catalog.tsx for the card registry). The plumbing underneath —
// socket, store, cache, perf budgets — is already live; wire a card's `render`
// to useField()/useFrame() when its data path is ready.

export default function Home() {
  return <BoardPage />
}
