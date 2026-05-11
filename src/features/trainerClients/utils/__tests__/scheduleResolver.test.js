import {
  resolveClientScheduledForFilter,
  resolveTrainerScheduleForDate,
  toggleIsoWeekday,
} from '../scheduleResolver';

describe('scheduleResolver', () => {
  it('toggles weekday chips with sorted ISO output', () => {
    expect(toggleIsoWeekday([], 3)).toEqual([3]);
    expect(toggleIsoWeekday([3], 1)).toEqual([1, 3]);
    expect(toggleIsoWeekday([1, 3], 3)).toEqual([1]);
    expect(toggleIsoWeekday([1, 3, 5], 9)).toEqual([1, 3, 5]);
  });

  it('resolves default location fallback when auto-fill is enabled', () => {
    const resolved = resolveTrainerScheduleForDate({
      targetDateIso: '2026-04-20',
      recurringWeekdays: [1],
      selectedDateExceptionType: null,
      selectedDateMeetingLocationOverride: null,
      preferredMeetingLocation: null,
      autoUseTrainerDefaultLocation: true,
      trainerDefaultMeetingLocation: 'Main Gym',
      trainerAutoFillMeetingLocation: true,
    });
    expect(resolved.scheduled).toBe(true);
    expect(resolved.meetingLocation).toBe('Main Gym');
  });

  it('applies skip/add exceptions over recurring template', () => {
    const skipped = resolveTrainerScheduleForDate({
      targetDateIso: '2026-04-20',
      recurringWeekdays: [1],
      selectedDateExceptionType: 'skip',
    });
    expect(skipped.scheduled).toBe(false);

    const added = resolveTrainerScheduleForDate({
      targetDateIso: '2026-04-21',
      recurringWeekdays: [],
      selectedDateExceptionType: 'add',
      selectedDateMeetingLocationOverride: 'Satellite Studio',
    });
    expect(added.scheduled).toBe(true);
    expect(added.meetingLocation).toBe('Satellite Studio');
  });

  it('supports scheduled filtering via resolved exception state', () => {
    const unscheduled = resolveClientScheduledForFilter(
      {
        scheduled_today: undefined,
        recurring_weekdays: [1],
        selected_date_exception_type: 'skip',
      },
      '2026-04-20',
    );
    expect(unscheduled).toBe(false);

    const scheduled = resolveClientScheduledForFilter(
      {
        scheduled_today: undefined,
        recurring_weekdays: [],
        selected_date_exception_type: 'add',
      },
      '2026-04-20',
    );
    expect(scheduled).toBe(true);
  });
});
