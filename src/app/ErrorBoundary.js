import React from 'react';
import { DevSettings, Platform, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';

import { ModeButton, ModeCard, ModeText } from '../../lib/components';
import { theme } from '../../lib/theme';

const REDACTED = '[REDACTED]';

function redactDiagnosticText(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return String(value)
    .replace(/(authorization:\s*bearer\s+)[^\s,]+/gi, `$1${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(
      /([?&](?:access_token|refresh_token|token|code|password|secret|api_key|apikey)=)[^&#\s]+/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /\b(?:access_token|refresh_token|token|password|secret|api_key|apikey)\s*[:=]\s*['"]?[^'",\s}]+/gi,
      (match) => match.replace(/[:=]\s*['"]?[^'",\s}]+/, `: ${REDACTED}`),
    )
    .replace(
      /\b(?:mode|ai\.modefit\.app):\/\/auth\/callback[?#][^\s)]*/gi,
      (match) => match.replace(/[?#].*$/, `?${REDACTED}`),
    )
    .replace(/\bhttps?:\/\/[^\s)]+(?:reset|recovery|callback)[^\s)]*/gi, REDACTED);
}

export function buildRedactedErrorDiagnostics(error, errorInfo, { isAuthenticated } = {}) {
  const diagnostics = {
    name: redactDiagnosticText(error?.name || 'Error'),
    message: redactDiagnosticText(error?.message || 'Unexpected render error'),
    stack: error?.stack ? redactDiagnosticText(error.stack) : null,
    componentStack: errorInfo?.componentStack ? redactDiagnosticText(errorInfo.componentStack) : null,
    platform: Platform.OS,
    timestamp: new Date().toISOString(),
    appVersion: Constants.expoConfig?.version || null,
    appBuild: (
      Constants.expoConfig?.ios?.buildNumber
      || Constants.expoConfig?.android?.versionCode
      || Constants.easConfig?.projectId
      || null
    ),
  };

  if (typeof isAuthenticated === 'boolean') {
    diagnostics.isAuthenticated = isAuthenticated;
  }

  return diagnostics;
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      restartAttempted: false,
    };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    const diagnostics = buildRedactedErrorDiagnostics(error, errorInfo, {
      isAuthenticated: this.props.isAuthenticated,
    });

    if (typeof __DEV__ === 'boolean' && __DEV__) {
      console.error('MODE render crash captured by ErrorBoundary', diagnostics);
    }
  }

  handleRestart = () => {
    if (DevSettings && typeof DevSettings.reload === 'function') {
      DevSettings.reload();
      return;
    }

    this.setState({
      hasError: false,
      restartAttempted: true,
    });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <View style={styles.screen} testID="app-error-boundary-fallback">
        <ModeCard variant="tinted" noShadow style={styles.card}>
          <ModeText variant="h3" tone="primary" style={styles.title}>
            Something went wrong
          </ModeText>
          <ModeText variant="bodySm" tone="secondary" style={styles.body}>
            MODE hit an unexpected issue. Tap below to restart.
          </ModeText>
          <ModeButton
            title="Restart app"
            onPress={this.handleRestart}
            style={styles.button}
            testID="app-error-boundary-restart-button"
          />
          {this.state.restartAttempted ? (
            <ModeText variant="caption" tone="tertiary" style={styles.retryNote}>
              Restarting the app was unavailable. Trying to render again.
            </ModeText>
          ) : null}
        </ModeCard>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background.app,
    paddingHorizontal: theme.spacing[3],
  },
  card: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    backgroundColor: theme.colors.surface.glass,
    borderColor: theme.colors.border.default,
    marginBottom: 0,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    marginTop: theme.spacing[1],
    textAlign: 'center',
  },
  button: {
    marginTop: theme.spacing[2],
    width: '100%',
  },
  retryNote: {
    marginTop: theme.spacing[1],
    textAlign: 'center',
  },
});
