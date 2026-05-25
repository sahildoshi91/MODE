import {
  AI_FITNESS_DISCLAIMER,
  getLegalLinks,
  getLegalLinksFallbackText,
} from '../legalLinks';

describe('legalLinks config', () => {
  it('resolves configured URLs and treats unset or TODO values as fallback links', () => {
    const links = getLegalLinks({
      EXPO_PUBLIC_PRIVACY_POLICY_URL: ' https://mode.example/privacy ',
      EXPO_PUBLIC_TERMS_URL: 'TODO',
      EXPO_PUBLIC_SUPPORT_URL: '',
    });

    expect(links).toEqual([
      expect.objectContaining({
        id: 'privacy',
        label: 'Privacy Policy',
        url: 'https://mode.example/privacy',
        isConfigured: true,
      }),
      expect.objectContaining({
        id: 'terms',
        label: 'Terms',
        url: null,
        isConfigured: false,
        fallbackText: 'EXPO_PUBLIC_TERMS_URL=TODO',
      }),
      expect.objectContaining({
        id: 'support',
        label: 'Support',
        url: null,
        isConfigured: false,
        fallbackText: 'EXPO_PUBLIC_SUPPORT_URL=TODO',
      }),
    ]);

    expect(getLegalLinksFallbackText(links)).toBe(
      'Configure EXPO_PUBLIC_TERMS_URL, EXPO_PUBLIC_SUPPORT_URL to enable these links.',
    );
  });

  it('keeps the AI fitness disclaimer concise and safety-oriented', () => {
    expect(AI_FITNESS_DISCLAIMER).toContain('AI-generated fitness coaching');
    expect(AI_FITNESS_DISCLAIMER).toContain('not medical advice');
    expect(AI_FITNESS_DISCLAIMER).toContain('doctor, physical therapist, registered dietitian');
    expect(AI_FITNESS_DISCLAIMER).toContain('pain, dizziness, or concerning symptoms');
    expect(AI_FITNESS_DISCLAIMER.length).toBeLessThan(320);
  });
});
