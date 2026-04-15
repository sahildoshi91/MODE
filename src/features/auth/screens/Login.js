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
  isSubmitting = false,
  isSignInMode = false,
  onToggleSignInMode = () => {},
  infoMessage = null,
  errorMessage = null,
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
      isSubmitting={isSubmitting}
      isSignInMode={isSignInMode}
      onToggleSignInMode={onToggleSignInMode}
      onBack={onBackToIntro}
      infoMessage={infoMessage}
      errorMessage={errorMessage}
    />
  );
}
