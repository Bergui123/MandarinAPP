import * as Calendar from 'expo-calendar';
import * as Location from 'expo-location';

// Everything here is best-effort: a denied permission or a failed fetch just
// means that one line is omitted from the tutor's context, never a thrown
// error that would block starting a call.

async function getWeatherLine(): Promise<string | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    const { latitude, longitude } = position.coords;

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,precipitation_probability_max&timezone=auto&temperature_unit=celsius`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();

    const current = Math.round(data.current?.temperature_2m);
    const high = Math.round(data.daily?.temperature_2m_max?.[0]);
    const rainChance = data.daily?.precipitation_probability_max?.[0];
    if (Number.isNaN(current)) return null;

    let line = `Weather right now: ${current}°C`;
    if (!Number.isNaN(high)) line += `, high of ${high}°C today`;
    if (typeof rainChance === 'number' && rainChance >= 30) line += `, ${rainChance}% chance of rain`;
    return line;
  } catch {
    return null;
  }
}

async function getScheduleLine(): Promise<string | null> {
  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') return null;

    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const calendarIds = calendars.map((c) => c.id);
    if (calendarIds.length === 0) return null;

    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const events = await Calendar.getEventsAsync(calendarIds, now, endOfDay);
    if (events.length === 0) return 'Nothing left on the calendar today.';

    const upcoming = events
      .slice(0, 3)
      .map((e) => `${e.title} at ${new Date(e.startDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    return `Rest of today's schedule: ${upcoming.join(', ')}.`;
  } catch {
    return null;
  }
}

function getTimeLine(): string {
  const now = new Date();
  return `It's currently ${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} on ${now.toLocaleDateString(undefined, { weekday: 'long' })}.`;
}

// Fetched once per call, folded into the system prompt — lets the tutor bring
// these up naturally ("it's raining today, did you bring an umbrella?") the
// same way it occasionally introduces new vocabulary: unforced, not every turn.
export async function getContextSignals(): Promise<string> {
  const [weather, schedule] = await Promise.all([getWeatherLine(), getScheduleLine()]);
  return [getTimeLine(), weather, schedule].filter(Boolean).join(' ');
}
