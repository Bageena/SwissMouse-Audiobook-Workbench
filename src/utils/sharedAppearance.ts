export async function readSharedTheme(): Promise<string | null> {
  const response = await fetch('/api/appearance', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not read the shared theme.');
  return (await response.json()).theme;
}

// Serialize writes so quickly switching themes cannot persist them out of order.
let writes: Promise<unknown> = Promise.resolve();
export function saveSharedTheme(theme: string, initialize = false): Promise<string> {
  const write = writes.catch(() => {}).then(async () => {
    const response = await fetch('/api/appearance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme, initialize }),
    });
    if (!response.ok) throw new Error('The theme changed here, but could not be saved for other app windows.');
    return (await response.json()).theme as string;
  });
  writes = write;
  return write;
}
