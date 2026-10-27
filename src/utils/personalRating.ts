export type PersonalRatingValue = number | null;

export function normalizePersonalRating(value: unknown): PersonalRatingValue {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10 ? value : null;
}

/** Use each actual star's bounds, so gaps and responsive layouts do not shift half-star hit targets. */
export function personalRatingAtPosition(clientX: number, stars: readonly { left: number; width: number }[]): number | null {
  if (!Number.isFinite(clientX) || !stars.length) return null;
  for (let index = 0; index < Math.min(stars.length, 5); index++) {
    const star = stars[index];
    if (clientX < star.left + star.width / 2) return index * 2 + 1;
    if (clientX <= star.left + star.width) return index * 2 + 2;
    const next = stars[index + 1];
    if (next && clientX < next.left) return index * 2 + 2;
  }
  return Math.min(stars.length, 5) * 2;
}

export function personalRatingForKey(value: PersonalRatingValue, key: string): PersonalRatingValue | undefined {
  switch (key) {
    case 'ArrowRight': case 'ArrowUp': return Math.min(10, (value ?? 0) + 1);
    case 'ArrowLeft': case 'ArrowDown': return Math.max(0, (value ?? 0) - 1);
    case 'Home': return 0;
    case 'End': return 10;
    case 'Delete': case 'Backspace': return null;
    default: return undefined;
  }
}

export interface PersonalRatingState {
  value: PersonalRatingValue;
  saving: boolean;
  error: string | null;
}

/** One controller per book; pending writes survive its view unmounting. */
export class PersonalRatingController {
  private state: PersonalRatingState;
  private confirmed: PersonalRatingValue;
  private dirty = false;
  private revision = 0;
  private writes: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();

  constructor(value: PersonalRatingValue, private save: (value: PersonalRatingValue) => Promise<void>) {
    this.confirmed = normalizePersonalRating(value);
    this.state = { value: this.confirmed, saving: false, error: null };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(next: PersonalRatingState) {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  syncSaved(value: PersonalRatingValue) {
    if (this.state.saving || this.dirty) return;
    this.confirmed = normalizePersonalRating(value);
    if (this.confirmed !== this.state.value) this.publish({ ...this.state, value: this.confirmed });
  }

  preview(value: PersonalRatingValue) {
    this.dirty = true;
    this.publish({ ...this.state, value: normalizePersonalRating(value), error: null });
  }

  commit(value: PersonalRatingValue = this.state.value): Promise<void> {
    const selected = normalizePersonalRating(value);
    const revision = ++this.revision;
    this.dirty = false;
    this.publish({ value: selected, saving: true, error: null });
    // A clear always follows earlier click writes, including slow network responses.
    this.writes = this.writes.then(async () => {
      try {
        await this.save(selected);
        this.confirmed = selected;
        if (revision === this.revision) this.publish({ ...this.state, saving: false, error: null });
      } catch (error) {
        if (revision === this.revision) this.publish({
          value: this.dirty ? this.state.value : this.confirmed,
          saving: false,
          error: error instanceof Error ? error.message : 'Could not save your rating. Please try again.',
        });
      }
    });
    return this.writes;
  }

  flush = () => {
    if (this.dirty) void this.commit();
  };
}
