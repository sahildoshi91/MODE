import { QUICK_WIN_OPTIONS, QUICK_WIN_RECOMMENDATIONS } from '../quickWin';

describe('quick win recommendation mapping', () => {
  it('has a deterministic recommendation for every quick win option', () => {
    QUICK_WIN_OPTIONS.forEach((option) => {
      const recommendation = QUICK_WIN_RECOMMENDATIONS[option.key];
      expect(recommendation).toBeDefined();
      expect(typeof recommendation.todayMove).toBe('string');
      expect(recommendation.todayMove.length).toBeGreaterThan(0);
      expect(typeof recommendation.support).toBe('string');
      expect(recommendation.support.length).toBeGreaterThan(0);
    });
  });
});
