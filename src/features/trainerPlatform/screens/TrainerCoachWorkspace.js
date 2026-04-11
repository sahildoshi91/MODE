import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import CoachChatScreen from '../../chat/screens/CoachChatScreen';
import { TRAINER_REVIEW_ENABLED } from '../../../config/featureFlags';
import TrainerReviewScreen from '../../trainerReview/screens/TrainerReviewScreen';

const COACH_SUBVIEW = {
  CHAT: 'chat',
  REVIEW: 'review',
};

function CoachSubviewSwitcher({ activeSubview, onChange }) {
  const options = useMemo(() => (
    TRAINER_REVIEW_ENABLED
      ? [
        { key: COACH_SUBVIEW.CHAT, label: 'Chat' },
        { key: COACH_SUBVIEW.REVIEW, label: 'Review' },
      ]
      : [{ key: COACH_SUBVIEW.CHAT, label: 'Chat' }]
  ), []);

  return (
    <View style={styles.switchRow}>
      {options.map((option) => {
        const isActive = activeSubview === option.key;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            style={({ pressed }) => [
              styles.switchOption,
              isActive && styles.switchOptionActive,
              pressed && styles.switchOptionPressed,
            ]}
          >
            <ModeText
              variant="caption"
              tone={isActive ? 'inverse' : 'secondary'}
              style={styles.switchOptionText}
            >
              {option.label}
            </ModeText>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TrainerCoachWorkspace({
  accessToken,
  chatLaunchContext,
  coachChatBottomInset,
}) {
  const [activeSubview, setActiveSubview] = useState(COACH_SUBVIEW.CHAT);
  const toolbar = (
    <CoachSubviewSwitcher
      activeSubview={activeSubview}
      onChange={setActiveSubview}
    />
  );

  if (activeSubview === COACH_SUBVIEW.REVIEW && TRAINER_REVIEW_ENABLED) {
    return (
      <TrainerReviewScreen
        accessToken={accessToken}
        bottomInset={coachChatBottomInset}
        topToolbar={toolbar}
      />
    );
  }

  return (
    <CoachChatScreen
      accessToken={accessToken}
      launchContext={chatLaunchContext}
      bottomInset={coachChatBottomInset}
      topToolbar={toolbar}
    />
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.subtle,
    padding: 2,
    gap: 4,
  },
  switchOption: {
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchOptionActive: {
    backgroundColor: theme.colors.brand.progressCore,
  },
  switchOptionPressed: {
    opacity: 0.88,
  },
  switchOptionText: {
    fontWeight: '600',
  },
});
