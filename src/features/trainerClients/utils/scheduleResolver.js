export const ISO_WEEKDAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

export function normalizeIsoWeekdays(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  const normalized = [];
  values.forEach((value) => {
    const day = Number(value);
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      return;
    }
    if (!normalized.includes(day)) {
      normalized.push(day);
    }
  });
  return normalized.sort((a, b) => a - b);
}

export function toggleIsoWeekday(values, day) {
  const normalized = normalizeIsoWeekdays(values);
  if (!Number.isInteger(day) || day < 1 || day > 7) {
    return normalized;
  }
  if (normalized.includes(day)) {
    return normalized.filter((item) => item !== day);
  }
  return [...normalized, day].sort((a, b) => a - b);
}

function normalizeLocation(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeExceptionType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'skip' || normalized === 'add') {
    return normalized;
  }
  return null;
}

function toIsoWeekday(targetDateIso) {
  if (!targetDateIso) {
    return null;
  }
  const parsed = new Date(`${targetDateIso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const weekday = parsed.getDay();
  return weekday === 0 ? 7 : weekday;
}

export function resolveTrainerScheduleForDate({
  targetDateIso,
  concreteSchedule = null,
  recurringWeekdays = [],
  selectedDateExceptionType = null,
  selectedDateMeetingLocationOverride = null,
  preferredMeetingLocation = null,
  autoUseTrainerDefaultLocation = true,
  trainerDefaultMeetingLocation = null,
  trainerAutoFillMeetingLocation = true,
} = {}) {
  if (concreteSchedule) {
    return {
      scheduled: true,
      sessionStatus: concreteSchedule?.status || null,
      sessionType: concreteSchedule?.session_type || null,
      sessionStartAt: concreteSchedule?.session_start_at || null,
      sessionEndAt: concreteSchedule?.session_end_at || null,
      meetingLocation: normalizeLocation(concreteSchedule?.meeting_location),
    };
  }

  const weekday = toIsoWeekday(targetDateIso);
  const isRecurringDay = weekday ? normalizeIsoWeekdays(recurringWeekdays).includes(weekday) : false;
  const exceptionType = normalizeExceptionType(selectedDateExceptionType);

  let scheduled = isRecurringDay;
  if (exceptionType === 'skip') {
    scheduled = false;
  } else if (exceptionType === 'add') {
    scheduled = true;
  }

  let meetingLocation = null;
  if (scheduled) {
    meetingLocation = normalizeLocation(selectedDateMeetingLocationOverride)
      || normalizeLocation(preferredMeetingLocation)
      || (
        autoUseTrainerDefaultLocation && trainerAutoFillMeetingLocation
          ? normalizeLocation(trainerDefaultMeetingLocation)
          : null
      );
  }

  return {
    scheduled,
    sessionStatus: scheduled ? 'scheduled' : null,
    sessionType: null,
    sessionStartAt: null,
    sessionEndAt: null,
    meetingLocation,
  };
}

export function resolveClientScheduledForFilter(client, targetDateIso) {
  if (typeof client?.scheduled_today === 'boolean') {
    return client.scheduled_today;
  }
  return resolveTrainerScheduleForDate({
    targetDateIso,
    recurringWeekdays: client?.recurring_weekdays,
    selectedDateExceptionType: client?.selected_date_exception_type,
  }).scheduled;
}

export function formatIsoWeekdaySummary(weekdays) {
  const normalized = normalizeIsoWeekdays(weekdays);
  if (!normalized.length) {
    return 'None';
  }
  const labelsByDay = Object.fromEntries(ISO_WEEKDAY_OPTIONS.map((item) => [item.value, item.label]));
  return normalized.map((day) => labelsByDay[day]).join(', ');
}
