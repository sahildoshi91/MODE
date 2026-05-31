import {
  AI_FITNESS_DISCLAIMER,
  getLegalLinks,
  getLegalLinksFallbackText,
} from '../legalLinks';

describe('legalLinks config', () => {
  it('uses production defaults when URLs are unset or TODO', () => {
    const links = getLegalLinks({
      EXPO_PUBLIC_PRIVACY_POLICY_URL: '',
      EXPO_PUBLIC_TERMS_URL: 'TODO',
      EXPO_PUBLIC_SUPPORT_URL: 'TODO: add later',
    });

    expect(links).toEqual([
      expect.objectContaining({
        id: 'privacy',
        label: 'Privacy Policy',
        url: 'https://modefit.ai/privacy',
        isConfigured: true,
      }),
      expect.objectContaining({
        id: 'terms',
        label: 'Terms',
        url: 'https://modefit.ai/terms',
        isConfigured: true,
      }),
      expect.objectContaining({
        id: 'support',
        label: 'Support',
        url: 'https://modefit.ai/support',
        isConfigured: true,
      }),
    ]);

    expect(getLegalLinksFallbackText(links)).toBeNull();
  });

  it('allows env URLs to override the production defaults', () => {
    const links = getLegalLinks({
      EXPO_PUBLIC_PRIVACY_POLICY_URL: ' https://mode.example/privacy ',
      EXPO_PUBLIC_TERMS_URL: 'https://mode.example/terms',
      EXPO_PUBLIC_SUPPORT_URL: 'https://mode.example/support',
    });

    expect(links).toEqual([
      expect.objectContaining({
        id: 'privacy',
        url: 'https://mode.example/privacy',
        isConfigured: true,
      }),
      expect.objectContaining({
        id: 'terms',
        url: 'https://mode.example/terms',
        isConfigured: true,
      }),
      expect.objectContaining({
        id: 'support',
        url: 'https://mode.example/support',
        isConfigured: true,
      }),
    ]);

    expect(getLegalLinksFallbackText(links)).toBeNull();
  });

  it('keeps the AI fitness disclaimer concise and safety-oriented', () => {
    expect(AI_FITNESS_DISCLAIMER).toContain('AI-generated fitness coaching');
    expect(AI_FITNESS_DISCLAIMER).toContain('not medical advice');
    expect(AI_FITNESS_DISCLAIMER).toContain('doctor, physical therapist, registered dietitian');
    expect(AI_FITNESS_DISCLAIMER).toContain('pain, dizziness, or concerning symptoms');
    expect(AI_FITNESS_DISCLAIMER.length).toBeLessThan(320);
  });
});
