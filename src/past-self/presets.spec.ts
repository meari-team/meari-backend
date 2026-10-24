import { presetAnchorDate } from './presets.js';

describe('presetAnchorDate', () => {
  it.each([
    ['1W', '2026-10-24', '2026-10-17'],
    ['1M', '2026-10-24', '2026-09-24'],
    ['3M', '2026-10-24', '2026-07-24'],
    ['6M', '2026-10-24', '2026-04-24'],
    ['1Y', '2026-10-24', '2025-10-24'],
    ['1W', '2026-01-03', '2025-12-27'],
    ['1M', '2026-03-31', '2026-02-28'],
    ['1M', '2024-03-31', '2024-02-29'],
    ['1Y', '2024-02-29', '2023-02-28'],
  ] as const)('%s from %s → %s', (preset, today, expected) => {
    expect(presetAnchorDate(preset, today)).toBe(expected);
  });
});
