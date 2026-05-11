import React from 'react';
import { BarChart3, Dumbbell, Home, User, Users } from 'lucide-react-native';

import {
  PremiumTabBar,
  PREMIUM_TAB_BAR_BOTTOM_OFFSET,
  PREMIUM_TAB_BAR_HEIGHT,
} from '../../../../lib/components';

const CLIENT_TABS = [
  { key: 'coach', label: 'Coach', Icon: Dumbbell },
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'progress', label: 'Progress', Icon: BarChart3 },
  { key: 'profile', label: 'Settings', Icon: User },
];

const TRAINER_TABS_COACH_OS = [
  { key: 'coach', label: 'Coach', Icon: Dumbbell },
  { key: 'clients', label: 'Clients', Icon: Users },
  { key: 'system', label: 'System', Icon: User },
];

const TRAINER_TABS_LEGACY = [
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'coach', label: 'Coach', Icon: Dumbbell },
  { key: 'clients', label: 'Clients', Icon: Users },
  { key: 'profile', label: 'Settings', Icon: User },
];

export const NAV_BOTTOM_OFFSET = PREMIUM_TAB_BAR_BOTTOM_OFFSET;
export const NAV_PILL_HEIGHT = PREMIUM_TAB_BAR_HEIGHT;

export default function LiquidBottomNav({
  activeTab,
  onTabChange,
  bottomInset = 0,
  role = 'client',
  trainerNavMode = 'coach_os',
}) {
  const tabs = role === 'trainer'
    ? (trainerNavMode === 'legacy' ? TRAINER_TABS_LEGACY : TRAINER_TABS_COACH_OS)
    : CLIENT_TABS;

  return (
    <PremiumTabBar
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={onTabChange}
      bottomInset={bottomInset}
    />
  );
}
