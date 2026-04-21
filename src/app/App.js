import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Linking, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ModeButton,
  ModeCard,
  ModeText,
  SafeScreen,
} from '../../lib/components';
import { theme } from '../../lib/theme';
import OnboardingLandingScreen from '../features/auth/screens/OnboardingLandingScreen';
import CoachChatScreen from '../features/chat/screens/CoachChatScreen';
import DailyCheckinScreen from '../features/dailyCheckin/screens/DailyCheckinScreen';
import CoachInsightsScreen from '../features/insights/screens/CoachInsightsScreen';
import LiquidBottomNav, {
  NAV_BOTTOM_OFFSET,
  NAV_PILL_HEIGHT,
} from '../features/navigation/components/LiquidBottomNav';
import CoachTabGuardScreen from '../features/onboarding/screens/CoachTabGuardScreen';
import ClientOnboardingFlowScreen from '../features/onboarding/screens/ClientOnboardingFlowScreen';
import ProductPreviewScreen from '../features/onboarding/screens/ProductPreviewScreen';
import RoleSelectionScreen from '../features/onboarding/screens/RoleSelectionScreen';
import TrainerStubScreen from '../features/onboarding/screens/TrainerStubScreen';
import {
  getOnboardingBootstrap,
  ingestMobileEvents,
  setOnboardingRole,
} from '../features/onboarding/services/onboardingApi';
import ProfileScreen from '../features/profile/screens/ProfileScreen';
import ProgressScreen from '../features/progress/screens/ProgressScreen';
import TrainerClientsScreen from '../features/trainerClients/screens/TrainerClientsScreen';
import TrainerHomeScreen from '../features/trainerHome/screens/TrainerHomeScreen';
import TrainerRouteHost from '../features/trainerPlatform/routes/TrainerRouteHost';
import { getTrainerAssignmentStatus } from '../features/trainerAssignment/services/trainerAssignmentApi';
import {
  AUTH_PASSWORD_ENABLED,
  AUTH_SOCIAL_ENABLED,
  BREATHING_TRANSITIONS_ENABLED,
  TRAINER_ROUTE_FOUNDATION_ENABLED,
} from '../config/featureFlags';
import { BREATHING_CONTEXT, BreathingTransitionOverlay } from '../features/shared/loading';
import { supabase } from '../services/supabaseClient';

const FLOATING_NAV_BOTTOM_OFFSET = NAV_BOTTOM_OFFSET;
const FLOATING_NAV_PILL_HEIGHT = NAV_PILL_HEIGHT;
const COACH_CHAT_NAV_GAP = 10;
const COACH_CHAT_DOCK_CLEARANCE =
  FLOATING_NAV_BOTTOM_OFFSET + FLOATING_NAV_PILL_HEIGHT + COACH_CHAT_NAV_GAP;
const ASSIGNMENT_STATUS_AUTO_RETRY_DELAY_MS = 900;
const VIEWER_ROLE = {
  TRAINER: 'trainer',
  CLIENT: 'client',
};
const APP_STATE = {
  SIGNED_OUT: 'signed_out',
  AUTHENTICATED_ROLE_UNKNOWN: 'authenticated_role_unknown',
  CLIENT_ONBOARDING: 'client_onboarding',
  ONBOARDING_PARTIAL: 'onboarding_partial',
  CLIENT_ACTIVE: 'client_active',
  TRAINER_STUB: 'trainer_stub',
};

function resolveOAuthRedirectUrl() {
  return process.env.EXPO_PUBLIC_SUPABASE_REDIRECT_URL || 'mode://auth/callback';
}

function ShellLoadingState({
  title,
  subtitle,
  context = BREATHING_CONTEXT.SHELL_BOOTSTRAP,
  active = true,
  onExitComplete = null,
}) {
  if (BREATHING_TRANSITIONS_ENABLED) {
    return (
      <SafeScreen style={styles.loadingScreen} includeTopInset={false} includeBottomInset={false}>
        <BreathingTransitionOverlay
          active={active}
          context={context}
          variant="screen"
          progressLabel={subtitle}
          onExitComplete={onExitComplete}
          testID="app-shell-breathing-loader"
        />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen style={styles.loadingScreen}>
      <ModeCard variant="tinted" noShadow style={styles.loadingCard}>
        <ActivityIndicator size="small" color={theme.colors.accent.primary} style={styles.loadingSpinner} />
        <ModeText variant="h3" tone="primary" style={styles.loadingTitle}>
          {title}
        </ModeText>
        <ModeText variant="bodySm" tone="secondary" style={styles.loadingSubtitle}>
          {subtitle}
        </ModeText>
      </ModeCard>
    </SafeScreen>
  );
}

function ShellErrorState({ title, subtitle, actionTitle, onPress }) {
  return (
    <SafeScreen style={styles.loadingScreen}>
      <ModeCard variant="tinted" noShadow style={styles.loadingCard}>
        <ModeText variant="h3" tone="primary" style={styles.loadingTitle}>
          {title}
        </ModeText>
        <ModeText variant="bodySm" tone="secondary" style={styles.loadingSubtitle}>
          {subtitle}
        </ModeText>
        <ModeButton title={actionTitle} onPress={onPress} style={styles.errorActionButton} />
      </ModeCard>
    </SafeScreen>
  );
}

function formatAssignmentError(error, fallbackMessage) {
  const message = error?.message || fallbackMessage;
  return {
    message,
    isNetworkError: error?.stage === 'network',
    requestId: error?.request_id || null,
    apiBase: error?.api_base_url || error?.resolved_api_base_url || null,
    attemptedBases: Array.isArray(error?.attempted_base_urls) ? error.attempted_base_urls : [],
    rawNetworkMessage: error?.raw_error_message || null,
  };
}

function AppShell() {
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState(null);
  const [authStage, setAuthStage] = useState('welcome');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUiError, setAuthUiError] = useState(null);
  const [authUiInfo, setAuthUiInfo] = useState(null);
  const [isAuthUiSubmitting, setIsAuthUiSubmitting] = useState(false);
  const [isSignInMode, setIsSignInMode] = useState(true);

  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isBootstrapLoading, setIsBootstrapLoading] = useState(false);
  const [bootstrap, setBootstrap] = useState(null);
  const [bootstrapError, setBootstrapError] = useState(null);
  const [isRoleSubmitting, setIsRoleSubmitting] = useState(false);

  const [isAssignmentStatusLoading, setIsAssignmentStatusLoading] = useState(false);
  const [assignmentStatus, setAssignmentStatus] = useState(null);
  const [assignmentStatusError, setAssignmentStatusError] = useState(null);

  const [activeTab, setActiveTab] = useState('home');
  const [chatLaunchContext, setChatLaunchContext] = useState(null);
  const [coachOverlayContext, setCoachOverlayContext] = useState(null);
  const [progressRoute, setProgressRoute] = useState('progress');
  const [insightsOrigin, setInsightsOrigin] = useState('progress');
  const [shellLoadingState, setShellLoadingState] = useState(null);

  const tabOpacity = useRef(new Animated.Value(1)).current;
  const tabTranslateY = useRef(new Animated.Value(0)).current;
  const assignmentStatusAutoRetryUsedRef = useRef(false);
  const hasTrackedWelcomeViewRef = useRef(false);
  const wasAuthenticatedRef = useRef(false);
  const analyticsQueueRef = useRef([]);
  const isFlushingAnalyticsRef = useRef(false);

  const flushAnalyticsQueue = useCallback(async (accessToken) => {
    if (!accessToken || isFlushingAnalyticsRef.current) {
      return;
    }
    if (!analyticsQueueRef.current.length) {
      return;
    }

    isFlushingAnalyticsRef.current = true;
    const queueSnapshot = [...analyticsQueueRef.current];
    try {
      await ingestMobileEvents({ accessToken, events: queueSnapshot });
      const queueHash = JSON.stringify(queueSnapshot);
      if (JSON.stringify(analyticsQueueRef.current.slice(0, queueSnapshot.length)) === queueHash) {
        analyticsQueueRef.current = analyticsQueueRef.current.slice(queueSnapshot.length);
      }
    } catch (_error) {
      // Non-blocking analytics flush; keep events queued for later.
    } finally {
      isFlushingAnalyticsRef.current = false;
    }
  }, []);

  const trackEvent = useCallback((name, properties = {}) => {
    if (!name || typeof name !== 'string') {
      return;
    }
    analyticsQueueRef.current.push({
      name,
      event_timestamp: new Date().toISOString(),
      properties,
    });
    if (session?.access_token) {
      flushAnalyticsQueue(session.access_token);
    }
  }, [flushAnalyticsQueue, session?.access_token]);

  const loadBootstrap = useCallback(async ({ accessToken }) => {
    if (!accessToken) {
      setBootstrap(null);
      setBootstrapError(null);
      return null;
    }
    setIsBootstrapLoading(true);
    setBootstrapError(null);
    try {
      const response = await getOnboardingBootstrap({ accessToken });
      setBootstrap(response);
      return response;
    } catch (error) {
      setBootstrapError(error?.message || 'Unable to load onboarding bootstrap.');
      return null;
    } finally {
      setIsBootstrapLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!isMounted) {
        return;
      }
      setSession(data.session || null);
      if (!data.session) {
        setAuthStage('welcome');
      }
      setIsSessionLoading(false);
    };

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) {
        return;
      }
      setSession(nextSession || null);
      setActiveTab('home');
      setProgressRoute('progress');
      setInsightsOrigin('progress');
      setChatLaunchContext(null);
      setCoachOverlayContext(null);
      if (!nextSession) {
        setAuthStage('welcome');
        setBootstrap(null);
      }
      setIsSessionLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const handleUrlAuthCallback = async (url) => {
      if (!url || typeof url !== 'string') {
        return;
      }
      let parsed;
      try {
        parsed = new URL(url);
      } catch (_error) {
        return;
      }
      const code = parsed.searchParams.get('code');
      if (!code) {
        return;
      }
      setIsAuthUiSubmitting(true);
      setAuthUiError(null);
      try {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          throw error;
        }
      } catch (error) {
        setAuthUiError(error?.message || 'Unable to complete sign-in.');
      } finally {
        setIsAuthUiSubmitting(false);
      }
    };

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleUrlAuthCallback(url);
    });

    Linking.getInitialURL().then((url) => {
      if (url) {
        handleUrlAuthCallback(url);
      }
    });

    return () => {
      if (typeof subscription?.remove === 'function') {
        subscription.remove();
      }
    };
  }, []);

  useEffect(() => {
    if (!session?.access_token) {
      setBootstrap(null);
      setBootstrapError(null);
      return;
    }
    loadBootstrap({ accessToken: session.access_token });
  }, [session?.access_token, loadBootstrap]);

  useEffect(() => {
    if (session?.access_token) {
      flushAnalyticsQueue(session.access_token);
    }
  }, [session?.access_token, flushAnalyticsQueue, bootstrap]);

  useEffect(() => {
    if (session?.access_token && !wasAuthenticatedRef.current) {
      trackEvent('auth_completed', {
        method: 'session',
      });
    }
    wasAuthenticatedRef.current = Boolean(session?.access_token);
  }, [session?.access_token, trackEvent]);

  const loadAssignmentStatus = useCallback(
    async ({ accessTokenOverride, allowAutoRetry = false } = {}) => {
      const accessToken = accessTokenOverride || session?.access_token;
      if (!accessToken) {
        setAssignmentStatus(null);
        setAssignmentStatusError(null);
        assignmentStatusAutoRetryUsedRef.current = false;
        return null;
      }

      setIsAssignmentStatusLoading(true);
      setAssignmentStatusError(null);

      try {
        const status = await getTrainerAssignmentStatus({ accessToken });
        setAssignmentStatus(status);
        assignmentStatusAutoRetryUsedRef.current = false;
        return status;
      } catch (error) {
        const shouldAutoRetry = Boolean(
          allowAutoRetry
            && !assignmentStatusAutoRetryUsedRef.current
            && error?.stage === 'network',
        );
        if (shouldAutoRetry) {
          assignmentStatusAutoRetryUsedRef.current = true;
          await new Promise((resolve) => setTimeout(resolve, ASSIGNMENT_STATUS_AUTO_RETRY_DELAY_MS));
          return loadAssignmentStatus({ accessTokenOverride: accessToken, allowAutoRetry: false });
        }
        setAssignmentStatus(null);
        setAssignmentStatusError(
          formatAssignmentError(error, 'Unable to load trainer assignment status.'),
        );
        return null;
      } finally {
        setIsAssignmentStatusLoading(false);
      }
    },
    [session?.access_token],
  );

  useEffect(() => {
    if (!session?.access_token) {
      setAssignmentStatus(null);
      setAssignmentStatusError(null);
      assignmentStatusAutoRetryUsedRef.current = false;
      return;
    }
    assignmentStatusAutoRetryUsedRef.current = false;
    loadAssignmentStatus({ accessTokenOverride: session.access_token, allowAutoRetry: true });
  }, [session?.access_token, loadAssignmentStatus]);

  useEffect(() => {
    tabOpacity.setValue(0);
    tabTranslateY.setValue(10);

    Animated.parallel([
      Animated.timing(tabOpacity, {
        toValue: 1,
        duration: theme.animation.duration.normal,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(tabTranslateY, {
        toValue: 0,
        duration: theme.animation.duration.long,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [activeTab, tabOpacity, tabTranslateY]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    assignmentStatusAutoRetryUsedRef.current = false;
    analyticsQueueRef.current = [];
    setSession(null);
    setBootstrap(null);
    setBootstrapError(null);
    setAuthStage('welcome');
    setAuthEmail('');
    setAuthPassword('');
    setAuthUiError(null);
    setAuthUiInfo(null);
    setIsAuthUiSubmitting(false);
    setIsSignInMode(true);
    setActiveTab('home');
    setProgressRoute('progress');
    setInsightsOrigin('progress');
    setChatLaunchContext(null);
    setCoachOverlayContext(null);
    setAssignmentStatus(null);
    setAssignmentStatusError(null);
  };

  const handleOpenChat = (launchContext = null) => {
    if (
      launchContext?.entrypoint === 'generated_workout'
      || launchContext?.entrypoint === 'generated_nutrition'
    ) {
      setCoachOverlayContext(launchContext);
      return;
    }
    setCoachOverlayContext(null);
    setChatLaunchContext(launchContext);
    setActiveTab('coach');
  };

  const handleOpenTrainerCoach = (launchContext = null) => {
    const normalizedLaunchContext = launchContext && typeof launchContext === 'object'
      ? launchContext
      : {};
    const normalizedOnboardingStatus = typeof assignmentStatus?.trainer_onboarding_status === 'string'
      ? assignmentStatus.trainer_onboarding_status.trim().toLowerCase()
      : 'not_started';
    const onboardingComplete = Boolean(
      assignmentStatus?.trainer_onboarding_completed || normalizedOnboardingStatus === 'completed',
    );
    const onboardingInProgress = !onboardingComplete && (
      normalizedOnboardingStatus === 'in_progress'
      || normalizedOnboardingStatus === 'calibration_pending'
      || Number(assignmentStatus?.trainer_onboarding_completed_steps ?? 0) > 0
    );
    const hasExplicitOnboardingAction = typeof normalizedLaunchContext.onboarding_action === 'string'
      && normalizedLaunchContext.onboarding_action.trim().length > 0;
    const fallbackOnboardingAction = onboardingComplete
      ? null
      : (onboardingInProgress ? 'resume' : 'continue');
    setCoachOverlayContext(null);
    setChatLaunchContext({
      entrypoint: 'trainer_agent_training',
      ...normalizedLaunchContext,
      ...(!hasExplicitOnboardingAction && fallbackOnboardingAction
        ? { onboarding_action: fallbackOnboardingAction }
        : {}),
    });
    setActiveTab('coach');
  };

  const appState = useMemo(() => {
    if (!session?.access_token) {
      return APP_STATE.SIGNED_OUT;
    }
    if (!bootstrap?.role) {
      return APP_STATE.AUTHENTICATED_ROLE_UNKNOWN;
    }
    if (bootstrap.role === 'trainer' && !bootstrap.is_legacy_trainer) {
      return APP_STATE.TRAINER_STUB;
    }
    if (bootstrap.role === 'client') {
      if (bootstrap.onboarding_complete) {
        return APP_STATE.CLIENT_ACTIVE;
      }
      if (bootstrap.onboarding_status === 'in_progress') {
        return APP_STATE.ONBOARDING_PARTIAL;
      }
      return APP_STATE.CLIENT_ONBOARDING;
    }
    return APP_STATE.CLIENT_ACTIVE;
  }, [session?.access_token, bootstrap]);

  const viewerRole = assignmentStatus?.viewer_role || (
    bootstrap?.role === 'trainer' && bootstrap?.is_legacy_trainer
      ? VIEWER_ROLE.TRAINER
      : VIEWER_ROLE.CLIENT
  );
  const isTrainerViewer = viewerRole === VIEWER_ROLE.TRAINER;
  const useCoachOsTrainerNav = Boolean(isTrainerViewer && TRAINER_ROUTE_FOUNDATION_ENABLED);
  const normalizedTrainerOnboardingStatus = typeof assignmentStatus?.trainer_onboarding_status === 'string'
    ? assignmentStatus.trainer_onboarding_status.trim().toLowerCase()
    : 'not_started';
  const trainerOnboardingComplete = Boolean(
    assignmentStatus?.trainer_onboarding_completed || normalizedTrainerOnboardingStatus === 'completed',
  );
  const trainerOnboardingInProgress = !trainerOnboardingComplete && (
    normalizedTrainerOnboardingStatus === 'in_progress'
    || normalizedTrainerOnboardingStatus === 'calibration_pending'
    || Number(assignmentStatus?.trainer_onboarding_completed_steps ?? 0) > 0
  );
  const resolvedTrainerCoachLaunchContext = (
    !isTrainerViewer
      || (chatLaunchContext && typeof chatLaunchContext === 'object')
      || trainerOnboardingComplete
  )
    ? chatLaunchContext
    : {
      entrypoint: 'trainer_agent_training',
      onboarding_action: trainerOnboardingInProgress ? 'resume' : 'continue',
    };

  useEffect(() => {
    if (!session?.access_token || !isTrainerViewer) {
      return;
    }
    loadAssignmentStatus({ accessTokenOverride: session.access_token });
  }, [isTrainerViewer, loadAssignmentStatus, session?.access_token]);

  useEffect(() => {
    if (isTrainerViewer && useCoachOsTrainerNav) {
      if (activeTab !== 'coach' && activeTab !== 'clients' && activeTab !== 'system') {
        setActiveTab('coach');
      }
      return;
    }
    if (isTrainerViewer && !useCoachOsTrainerNav && activeTab === 'progress') {
      setActiveTab('clients');
      return;
    }
    if (!isTrainerViewer && (activeTab === 'clients' || activeTab === 'system')) {
      setActiveTab('home');
    }
  }, [activeTab, isTrainerViewer, useCoachOsTrainerNav]);

  const handleTabChange = (nextTab) => {
    if (!isTrainerViewer && (nextTab === 'clients' || nextTab === 'system')) {
      return;
    }
    if (isTrainerViewer) {
      if (nextTab === 'progress') {
        return;
      }
      if (useCoachOsTrainerNav && nextTab === 'home') {
        nextTab = 'coach';
      }
      if (useCoachOsTrainerNav && nextTab === 'profile') {
        nextTab = 'system';
      }
      if (!useCoachOsTrainerNav && nextTab === 'system') {
        nextTab = 'profile';
      }
    }
    setCoachOverlayContext(null);
    setActiveTab(nextTab);
    if (nextTab !== 'coach') {
      setChatLaunchContext(null);
    }
    if (!isTrainerViewer && nextTab !== 'progress') {
      setProgressRoute('progress');
    }
    if (!isTrainerViewer && nextTab !== 'progress' && nextTab !== 'home') {
      setInsightsOrigin('progress');
    }
  };

  const handleOpenHomeInsights = () => {
    setInsightsOrigin('home');
    setActiveTab('progress');
    setProgressRoute('insights');
  };

  const handleOpenProgressInsights = () => {
    setInsightsOrigin('progress');
    setProgressRoute('insights');
  };

  const handleBackFromInsights = () => {
    if (insightsOrigin === 'home') {
      setActiveTab('home');
      setProgressRoute('progress');
      return;
    }
    setActiveTab('progress');
    setProgressRoute('progress');
  };

  const handleContinueWithProvider = async (provider) => {
    if (isAuthUiSubmitting) {
      return;
    }
    setIsAuthUiSubmitting(true);
    setAuthUiError(null);
    setAuthUiInfo(null);
    trackEvent('auth_started', { provider });
    try {
      const redirectTo = resolveOAuthRedirectUrl();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });
      if (error) {
        throw error;
      }
      if (data?.url) {
        await Linking.openURL(data.url);
        setAuthUiInfo('Continue in your browser and return to MODE.');
      }
    } catch (error) {
      setAuthUiError(error?.message || 'Unable to start OAuth sign-in.');
    } finally {
      setIsAuthUiSubmitting(false);
    }
  };

  const handleContinueWithEmail = async () => {
    if (isAuthUiSubmitting) {
      return;
    }
    const normalizedEmail = authEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setAuthUiError('Enter your email to continue.');
      return;
    }
    setIsAuthUiSubmitting(true);
    setAuthUiError(null);
    setAuthUiInfo(null);
    trackEvent('auth_started', { provider: 'email_otp' });
    try {
      const redirectTo = resolveOAuthRedirectUrl();
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser: !isSignInMode,
          emailRedirectTo: redirectTo,
        },
      });
      if (error) {
        throw error;
      }
      setAuthUiInfo('Check your email for the secure sign-in link.');
    } catch (error) {
      setAuthUiError(error?.message || 'Unable to send sign-in link.');
    } finally {
      setIsAuthUiSubmitting(false);
    }
  };

  const handleContinueWithPassword = async () => {
    if (isAuthUiSubmitting) {
      return;
    }
    const normalizedEmail = authEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setAuthUiError('Enter your email to continue.');
      return;
    }
    if (!authPassword) {
      setAuthUiError('Enter your password to continue.');
      return;
    }

    setIsAuthUiSubmitting(true);
    setAuthUiError(null);
    setAuthUiInfo(null);
    trackEvent('auth_started', {
      provider: 'email_password',
      mode: isSignInMode ? 'sign_in' : 'sign_up',
    });

    try {
      if (isSignInMode) {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password: authPassword,
        });
        if (error) {
          throw error;
        }
        setAuthUiInfo('Signed in successfully.');
      } else {
        const redirectTo = resolveOAuthRedirectUrl();
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password: authPassword,
          options: {
            emailRedirectTo: redirectTo,
          },
        });
        if (error) {
          throw error;
        }
        if (data?.session?.access_token) {
          setAuthUiInfo('Account created and signed in.');
        } else {
          setAuthUiInfo('Account created. Check your email if verification is required.');
        }
      }
    } catch (error) {
      setAuthUiError(error?.message || 'Unable to continue with password.');
    } finally {
      setIsAuthUiSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    if (isAuthUiSubmitting) {
      return;
    }
    const normalizedEmail = authEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setAuthUiError('Enter your email first so we know where to send reset instructions.');
      return;
    }

    setIsAuthUiSubmitting(true);
    setAuthUiError(null);
    setAuthUiInfo(null);
    trackEvent('auth_password_reset_requested', {
      mode: isSignInMode ? 'sign_in' : 'sign_up',
    });

    try {
      const redirectTo = resolveOAuthRedirectUrl();
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo,
      });
      if (error) {
        throw error;
      }
      setAuthUiInfo('Password reset link sent. Check your email to continue.');
    } catch (error) {
      setAuthUiError(error?.message || 'Unable to send password reset instructions.');
    } finally {
      setIsAuthUiSubmitting(false);
    }
  };

  const handleSelectRole = async (role) => {
    if (!session?.access_token || isRoleSubmitting) {
      return;
    }
    setIsRoleSubmitting(true);
    setBootstrapError(null);
    trackEvent('role_selected', { role });
    try {
      const updated = await setOnboardingRole({
        accessToken: session.access_token,
        role,
      });
      setBootstrap(updated);
      setActiveTab('home');
    } catch (error) {
      setBootstrapError(error?.message || 'Unable to save your role right now.');
    } finally {
      setIsRoleSubmitting(false);
    }
  };

  const handleRefreshBootstrapAndStatus = useCallback(async () => {
    if (!session?.access_token) {
      return;
    }
    await Promise.all([
      loadBootstrap({ accessToken: session.access_token }),
      loadAssignmentStatus({ accessTokenOverride: session.access_token }),
    ]);
  }, [loadAssignmentStatus, loadBootstrap, session?.access_token]);

  useEffect(() => {
    if (authStage === 'welcome' && !hasTrackedWelcomeViewRef.current) {
      hasTrackedWelcomeViewRef.current = true;
      trackEvent('welcome_viewed', {});
    }
  }, [authStage, trackEvent]);

  const isBlockingAssignmentLoad = isAssignmentStatusLoading
    && isTrainerViewer
    && !assignmentStatus
    && !assignmentStatusError;
  const shellLoadingConfig = useMemo(() => {
    if (isSessionLoading) {
      return {
        context: BREATHING_CONTEXT.SHELL_BOOTSTRAP,
        title: 'Preparing MODE',
        subtitle: 'Checking your session and loading your training workspace.',
      };
    }
    if (isBootstrapLoading) {
      return {
        context: BREATHING_CONTEXT.SHELL_BOOTSTRAP,
        title: 'Preparing MODE',
        subtitle: 'Loading your role and onboarding state.',
      };
    }
    if (isBlockingAssignmentLoad) {
      return {
        context: BREATHING_CONTEXT.SHELL_BOOTSTRAP,
        title: 'Syncing Your Coach',
        subtitle: 'Loading assignment status before we open your dashboard.',
      };
    }
    return null;
  }, [isBlockingAssignmentLoad, isBootstrapLoading, isSessionLoading]);

  useEffect(() => {
    if (!BREATHING_TRANSITIONS_ENABLED) {
      setShellLoadingState(null);
      return;
    }

    if (shellLoadingConfig) {
      setShellLoadingState((current) => {
        if (
          current
          && current.active
          && current.context === shellLoadingConfig.context
          && current.title === shellLoadingConfig.title
          && current.subtitle === shellLoadingConfig.subtitle
        ) {
          return current;
        }
        return {
          ...shellLoadingConfig,
          active: true,
        };
      });
      return;
    }

    setShellLoadingState((current) => {
      if (!current || !current.active) {
        return current;
      }
      return {
        ...current,
        active: false,
      };
    });
  }, [shellLoadingConfig]);

  if (BREATHING_TRANSITIONS_ENABLED && shellLoadingState) {
    return (
      <ShellLoadingState
        title={shellLoadingState.title}
        subtitle={shellLoadingState.subtitle}
        context={shellLoadingState.context}
        active={shellLoadingState.active}
        onExitComplete={() => {
          setShellLoadingState((current) => {
            if (shellLoadingConfig) {
              return {
                ...shellLoadingConfig,
                active: true,
              };
            }
            if (current && !current.active) {
              return null;
            }
            return current;
          });
        }}
      />
    );
  }

  if (!BREATHING_TRANSITIONS_ENABLED && isSessionLoading) {
    return (
      <ShellLoadingState
        title="Preparing MODE"
        subtitle="Checking your session and loading your training workspace."
      />
    );
  }

  if (!session?.access_token) {
    if (authStage === 'preview') {
      return (
        <ProductPreviewScreen
          onBack={() => setAuthStage('welcome')}
          onContinue={() => setAuthStage('welcome')}
        />
      );
    }

    return (
      <OnboardingLandingScreen
        onOpenPreview={() => setAuthStage('preview')}
        authProps={{
          email: authEmail,
          onEmailChange: setAuthEmail,
          password: authPassword,
          onPasswordChange: setAuthPassword,
          showSocialAuth: AUTH_SOCIAL_ENABLED,
          showPasswordAuth: AUTH_PASSWORD_ENABLED,
          onContinueWithApple: () => handleContinueWithProvider('apple'),
          onContinueWithGoogle: () => handleContinueWithProvider('google'),
          onContinueWithEmail: handleContinueWithEmail,
          onContinueWithPassword: handleContinueWithPassword,
          onForgotPassword: handleForgotPassword,
          isSubmitting: isAuthUiSubmitting,
          isSignInMode,
          onToggleSignInMode: () => setIsSignInMode((current) => !current),
          infoMessage: authUiInfo,
          errorMessage: authUiError,
          layoutMode: 'inline',
        }}
      />
    );
  }

  if (!BREATHING_TRANSITIONS_ENABLED && isBootstrapLoading) {
    return (
      <ShellLoadingState
        title="Preparing MODE"
        subtitle="Loading your role and onboarding state."
      />
    );
  }

  if (!bootstrap) {
    return (
      <ShellErrorState
        title="We couldn't load your setup"
        subtitle={bootstrapError || 'Unable to reach onboarding services right now.'}
        actionTitle="Retry"
        onPress={() => loadBootstrap({ accessToken: session.access_token })}
      />
    );
  }

  if (appState === APP_STATE.AUTHENTICATED_ROLE_UNKNOWN) {
    return (
      <RoleSelectionScreen
        onSelectClient={() => handleSelectRole('client')}
        onSelectTrainer={() => handleSelectRole('trainer')}
        isSubmitting={isRoleSubmitting}
        errorMessage={bootstrapError}
      />
    );
  }

  if (appState === APP_STATE.CLIENT_ONBOARDING || appState === APP_STATE.ONBOARDING_PARTIAL) {
    return (
      <ClientOnboardingFlowScreen
        accessToken={session.access_token}
        bootstrap={bootstrap}
        onBootstrapUpdate={setBootstrap}
        onFinished={() => {
          setActiveTab('home');
        }}
        onTrackEvent={trackEvent}
      />
    );
  }

  if (appState === APP_STATE.TRAINER_STUB) {
    return (
      <TrainerStubScreen
        accessToken={session.access_token}
        bootstrap={bootstrap}
        onBootstrapUpdate={setBootstrap}
        onSignOut={handleSignOut}
      />
    );
  }

  const navBottomInset = insets.bottom;
  const floatingNavClearance = navBottomInset + FLOATING_NAV_BOTTOM_OFFSET + FLOATING_NAV_PILL_HEIGHT;
  const contentBottomInset = navBottomInset + 108;
  const coachChatBottomInset = navBottomInset + COACH_CHAT_DOCK_CLEARANCE;
  const shouldUseTrainerRouteFoundation = useCoachOsTrainerNav;
  const hasAssignedTrainer = Boolean(assignmentStatus?.assigned_trainer_id || bootstrap?.assigned_trainer_id);

  if (!BREATHING_TRANSITIONS_ENABLED && isBlockingAssignmentLoad) {
    return (
      <ShellLoadingState
        title="Syncing Your Coach"
        subtitle="Loading assignment status before we open your dashboard."
      />
    );
  }

  return (
    <View style={styles.shell}>
      <Animated.View
        style={[
          styles.screenContainer,
          {
            opacity: tabOpacity,
            transform: [{ translateY: tabTranslateY }],
          },
        ]}
      >
        {shouldUseTrainerRouteFoundation ? (
          <TrainerRouteHost
            activeTab={activeTab}
            accessToken={session.access_token}
            chatLaunchContext={chatLaunchContext}
            contentBottomInset={contentBottomInset}
            coachChatBottomInset={coachChatBottomInset}
            assignmentStatus={assignmentStatus}
            session={session}
            onOpenTrainerCoach={handleOpenTrainerCoach}
            onSignOut={handleSignOut}
          />
        ) : (
          <>
            {!isTrainerViewer && activeTab === 'home' ? (
              <DailyCheckinScreen
                accessToken={session.access_token}
                bottomInset={contentBottomInset}
                floatingNavClearance={floatingNavClearance}
                onOpenChat={handleOpenChat}
                onOpenInsights={handleOpenHomeInsights}
              />
            ) : null}

            {isTrainerViewer && activeTab === 'home' ? (
              <TrainerHomeScreen
                accessToken={session.access_token}
                bottomInset={contentBottomInset}
                viewerDisplayName={assignmentStatus?.viewer_display_name || null}
                trainerOnboardingCompleted={Boolean(assignmentStatus?.trainer_onboarding_completed)}
                trainerOnboardingStatus={assignmentStatus?.trainer_onboarding_status || 'not_started'}
                trainerOnboardingCompletedSteps={assignmentStatus?.trainer_onboarding_completed_steps ?? 0}
                trainerOnboardingTotalSteps={assignmentStatus?.trainer_onboarding_total_steps ?? 8}
                trainerOnboardingLastStep={assignmentStatus?.trainer_onboarding_last_step || null}
                onOpenCoachTraining={handleOpenTrainerCoach}
              />
            ) : null}

            {activeTab === 'coach' && hasAssignedTrainer ? (
              <CoachChatScreen
                accessToken={session.access_token}
                launchContext={resolvedTrainerCoachLaunchContext}
                bottomInset={coachChatBottomInset}
              />
            ) : null}

            {activeTab === 'coach' && !hasAssignedTrainer && !isTrainerViewer ? (
              <CoachTabGuardScreen
                accessToken={session.access_token}
                bottomInset={contentBottomInset}
                onAttached={handleRefreshBootstrapAndStatus}
                onBackHome={() => setActiveTab('home')}
              />
            ) : null}

            {!isTrainerViewer && activeTab === 'progress' && progressRoute === 'progress' ? (
              <ProgressScreen
                accessToken={session.access_token}
                bottomInset={contentBottomInset}
                onOpenInsights={handleOpenProgressInsights}
                initialSection="habits"
              />
            ) : null}

            {!isTrainerViewer && activeTab === 'progress' && progressRoute === 'insights' ? (
              <CoachInsightsScreen
                accessToken={session.access_token}
                onBack={handleBackFromInsights}
                bottomInset={contentBottomInset}
              />
            ) : null}

            {isTrainerViewer && activeTab === 'clients' ? (
              <TrainerClientsScreen
                accessToken={session.access_token}
                bottomInset={contentBottomInset}
                onOpenTrainerCoach={handleOpenTrainerCoach}
              />
            ) : null}

            {(activeTab === 'profile' || activeTab === 'system') ? (
              <ProfileScreen
                session={session}
                assignmentStatus={assignmentStatus}
                accessToken={session.access_token}
                onSignOut={handleSignOut}
                bottomInset={contentBottomInset}
              />
            ) : null}
          </>
        )}
      </Animated.View>

      {coachOverlayContext ? (
        <View style={styles.coachOverlay}>
          <CoachChatScreen
            accessToken={session.access_token}
            launchContext={coachOverlayContext}
            bottomInset={navBottomInset}
            onBack={() => setCoachOverlayContext(null)}
          />
        </View>
      ) : null}

      {!coachOverlayContext ? (
        <LiquidBottomNav
          activeTab={activeTab}
          onTabChange={handleTabChange}
          bottomInset={navBottomInset}
          role={isTrainerViewer ? 'trainer' : 'client'}
          trainerNavMode={isTrainerViewer && useCoachOsTrainerNav ? 'coach_os' : 'legacy'}
        />
      ) : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: theme.colors.background.app,
  },
  screenContainer: {
    flex: 1,
  },
  coachOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background.app,
    paddingHorizontal: theme.spacing[3],
  },
  loadingCard: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    backgroundColor: theme.colors.surface.glass,
    borderColor: theme.colors.border.default,
    marginBottom: 0,
  },
  loadingSpinner: {
    marginBottom: theme.spacing[2],
  },
  loadingTitle: {
    textAlign: 'center',
  },
  loadingSubtitle: {
    marginTop: theme.spacing[1],
    textAlign: 'center',
  },
  errorActionButton: {
    marginTop: theme.spacing[2],
    width: '100%',
  },
});
