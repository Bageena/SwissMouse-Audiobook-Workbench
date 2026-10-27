import { useState } from 'react';
import { idlePlayerMessages, nextIdleMessageIndex } from '../utils/idlePlayerMessages';
import { readStored, writeStored } from '../utils/libraryWorkspace';

export function IdlePlayer() {
  const [message] = useState(() => {
    const index = nextIdleMessageIndex(readStored<number>('swissmouse-idle-message', -1, true));
    writeStored('swissmouse-idle-message', index, true);
    return idlePlayerMessages[index];
  });
  return <section aria-label="Audiobook player" className="book-selector min-w-0 rounded-xl border border-stone-200 bg-stone-50 px-3 py-3">
    <div className="flex min-w-0 items-center gap-3">
      <span role="img" aria-label="Idle player mascot" className="idle-player-logo h-20 w-16 shrink-0 sm:h-24 sm:w-20" />
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Nothing playing</h2>
        <p className="mt-1 text-xs text-stone-600">{message}</p>
        <p className="mt-2 text-[11px] text-stone-500">Choose a book’s Play button to start listening.</p>
      </div>
    </div>
  </section>;
}
