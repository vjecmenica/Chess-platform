/** The reserved rail is deliberately non-interactive until chat is implemented. */
export function FutureChat({ siteGame }: { siteGame: boolean }) {
  if (!siteGame) return null;
  return <aside className="future-chat" aria-label="Chat — coming later">
    <h2>Chat — coming later</h2>
  </aside>;
}
