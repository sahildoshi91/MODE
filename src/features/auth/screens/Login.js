import React from 'react';

import AuthChoiceScreen from '../../onboarding/screens/AuthChoiceScreen';

export default function Login({
  onBackToIntro = null,
  email = '',
  onEmailChange = () => {},
  password = '',
  onPasswordChange = () => {},
  showSocialAuth = false,
  showPasswordAuth = false,
  onContinueWithApple = () => {},
  onContinueWithGoogle = () => {},
  onContinueWithEmail = () => {},
  onContinueWithPassword = () => {},
  onForgotPassword = null,
  isSubmitting = false,
  isSignInMode = false,
  onToggleSignInMode = () => {},
  infoMessage = null,
  errorMessage = null,
  layoutMode = 'full',
}) {
  return (
    <AuthChoiceScreen
      email={email}
      onEmailChange={onEmailChange}
      password={password}
      onPasswordChange={onPasswordChange}
      showSocialAuth={showSocialAuth}
      showPasswordAuth={showPasswordAuth}
      onContinueWithApple={onContinueWithApple}
      onContinueWithGoogle={onContinueWithGoogle}
      onContinueWithEmail={onContinueWithEmail}
      onContinueWithPassword={onContinueWithPassword}
      onForgotPassword={onForgotPassword}
      isSubmitting={isSubmitting}
      isSignInMode={isSignInMode}
      onToggleSignInMode={onToggleSignInMode}
      onBack={onBackToIntro}
      infoMessage={infoMessage}
      errorMessage={errorMessage}
      layoutMode={layoutMode}
    />
  );
}
