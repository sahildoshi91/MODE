export const AI_FITNESS_DISCLAIMER =
  'MODE provides AI-generated fitness coaching and accountability. It is not medical advice and is not a substitute for a doctor, physical therapist, registered dietitian, or other qualified professional. Stop exercising and seek professional advice if you experience pain, dizziness, or concerning symptoms.';

const LEGAL_LINK_DEFINITIONS = [
  {
    id: 'privacy',
    label: 'Privacy Policy',
    envVar: 'EXPO_PUBLIC_PRIVACY_POLICY_URL',
    defaultUrl: 'https://modefit.ai/privacy',
  },
  {
    id: 'terms',
    label: 'Terms',
    envVar: 'EXPO_PUBLIC_TERMS_URL',
    defaultUrl: 'https://modefit.ai/terms',
  },
  {
    id: 'support',
    label: 'Support',
    envVar: 'EXPO_PUBLIC_SUPPORT_URL',
    defaultUrl: 'https://modefit.ai/support',
  },
];

const DEFAULT_LEGAL_LINK_ENV = {
  EXPO_PUBLIC_PRIVACY_POLICY_URL: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL,
  EXPO_PUBLIC_TERMS_URL: process.env.EXPO_PUBLIC_TERMS_URL,
  EXPO_PUBLIC_SUPPORT_URL: process.env.EXPO_PUBLIC_SUPPORT_URL,
};

function normalizeConfiguredUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.toUpperCase() === 'TODO' || trimmed.toUpperCase().startsWith('TODO:')) {
    return null;
  }
  return trimmed;
}

export function getLegalLinks(env = DEFAULT_LEGAL_LINK_ENV) {
  return LEGAL_LINK_DEFINITIONS.map((definition) => {
    const {
      id,
      label,
      envVar,
      defaultUrl,
    } = definition;
    const url = normalizeConfiguredUrl(env?.[envVar]) || defaultUrl;
    return {
      id,
      label,
      envVar,
      url,
      fallbackText: `${envVar}=TODO`,
      isConfigured: Boolean(url),
    };
  });
}

export function getLegalLinksFallbackText(links = getLegalLinks()) {
  const missingEnvVars = links
    .filter((link) => !link.isConfigured)
    .map((link) => link.envVar);
  if (missingEnvVars.length === 0) {
    return null;
  }
  return `Configure ${missingEnvVars.join(', ')} to enable these links.`;
}
