export function clock(initial = Date.UTC(2026, 8, 14)) {
  let current = initial;
  return {
    now: () => current,
    advance: (milliseconds: number) => { current += milliseconds; return current; },
    set: (milliseconds: number) => { current = milliseconds; },
  };
}
