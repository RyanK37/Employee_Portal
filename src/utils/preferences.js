export const PREFERENCE_DEFAULTS = {
  showMoodOnMessages: true,
  showMbtiOnMessages: true,
  autoDetectMood: true,
}

export function getPreferenceValue(preferences, key) {
  if (typeof preferences?.[key] === 'boolean') return preferences[key]
  if (Object.prototype.hasOwnProperty.call(PREFERENCE_DEFAULTS, key)) {
    return PREFERENCE_DEFAULTS[key]
  }
  return false
}

export function updatePreferencesMap(preferences, key, value) {
  return {
    ...(preferences || {}),
    [key]: value,
  }
}
