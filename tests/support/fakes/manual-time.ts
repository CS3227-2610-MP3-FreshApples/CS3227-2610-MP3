/**
 * Deterministic time sources for the K10 controller (D-69). The clock only moves when a sleep fires or the
 * test calls `advance`, so deadline rules can be checked without waiting.
 */
export interface ManualTime {
  /** Monotonic milliseconds. */
  readonly clock: () => number;
  /** Resolves when `ms` have passed on the manual clock, or at once when `cancel` aborts (no time passes). */
  readonly sleep: (ms: number, cancel?: AbortSignal) => Promise<void>;
  /** Returns the value set by `setRandom` (0 by default). */
  readonly random: () => number;
  /** Moves the clock forward and fires every sleep that is now due. */
  advance(ms: number): void;
  setRandom(value: number): void;
  /** The length of every sleep that fired (not cancelled), in firing order. */
  readonly firedSleeps: readonly number[];
}

interface PendingSleep {
  readonly due: number;
  readonly ms: number;
  readonly resolve: () => void;
}

/**
 * @param options.autoAdvance when true (the default), each sleep fires on the next macrotask by moving the
 * clock to its due time, unless it is cancelled first. A provider that answers at once therefore cancels its
 * attempt timer before it fires. When false, sleeps fire only through `advance`.
 */
export function createManualTime(options: { readonly autoAdvance?: boolean } = {}): ManualTime {
  const autoAdvance = options.autoAdvance ?? true;
  let now = 1_000_000;
  let randomValue = 0;
  const pending = new Set<PendingSleep>();
  const firedSleeps: number[] = [];

  function fire(entry: PendingSleep): void {
    if (!pending.delete(entry)) {
      return;
    }
    now = Math.max(now, entry.due);
    firedSleeps.push(entry.ms);
    entry.resolve();
  }

  return {
    firedSleeps,
    clock: () => now,
    random: () => randomValue,
    setRandom(value) {
      randomValue = value;
    },
    advance(ms) {
      now += ms;
      for (const entry of [...pending].sort((a, b) => a.due - b.due)) {
        if (entry.due <= now) {
          fire(entry);
        }
      }
    },
    sleep(ms, cancel) {
      return new Promise<void>((resolve) => {
        if (cancel?.aborted) {
          resolve();
          return;
        }
        const entry: PendingSleep = { due: now + ms, ms, resolve };
        pending.add(entry);
        cancel?.addEventListener(
          "abort",
          () => {
            pending.delete(entry);
            resolve();
          },
          { once: true },
        );
        if (autoAdvance) {
          setImmediate(() => fire(entry));
        }
      });
    },
  };
}
