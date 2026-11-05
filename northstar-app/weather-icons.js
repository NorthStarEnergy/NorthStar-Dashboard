(() => {
  const cloud = '<svg class="weather-cloud-icon" viewBox="0 0 32 22" width="1em" height="1em" aria-hidden="true" focusable="false"><path d="M8.2 20C4.2 20 1 17.1 1 13.5S4 7.1 7.8 7c1.4-3.6 4.8-6 8.8-6 5.1 0 9.2 3.9 9.5 8.8 2.8.5 4.9 2.5 4.9 5.1 0 2.8-2.5 5.1-5.7 5.1H8.2Z" fill="#fff" stroke="#101820" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  // Vector fog avoids platform-dependent color emoji tiles and scales with every weather view.
  const fog = '<svg class="weather-fog-icon" viewBox="0 0 32 32" width="1em" height="1em" style="display:inline-block;vertical-align:middle" aria-hidden="true" focusable="false"><g fill="none" stroke="#101820" stroke-width="4" stroke-linecap="round"><path d="M6 8h20M3 14h21M8 20h21M4 26h20"/></g><g fill="none" stroke="#e4edf2" stroke-width="2.5" stroke-linecap="round"><path d="M6 8h20M3 14h21M8 20h21M4 26h20"/></g></svg>';
  const night = (isDay, time) => isDay != null ? Number(isDay) === 0 : /T(0\d|1\d|2[0-3]):/.test(time || '') && (Number((time || '').slice(11, 13)) < 6 || Number((time || '').slice(11, 13)) >= 20);
  function icon(code, isDay, time) {
    if (code == null || code === '' || !Number.isFinite(Number(code))) return '—';
    const value = Number(code), dark = night(isDay, time);
    if (value >= 95) return '⛈️';
    if (value >= 85 && value <= 86) return '🌨️';
    if (value >= 71 && value <= 77) return '❄️';
    if (value >= 80 && value <= 82) return '🌧️';
    if (value >= 51 && value <= 67) return '🌧️';
    if (value >= 45 && value <= 48) return fog;
    if (value === 0) return dark ? '🌙' : '☀️';
    if (value <= 2) return dark ? cloud : '🌤️';
    if (value === 3) return cloud;
    return cloud;
  }
  function condition(code) {
    const value = Number(code);
    if (value >= 95) return 'Thunderstorms';
    if (value >= 85) return 'Snow';
    if (value >= 71) return 'Snow';
    if ((value >= 80 && value <= 82) || (value >= 51 && value <= 67)) return 'Rain';
    if (value >= 45 && value <= 48) return 'Fog';
    if (value === 0) return 'Clear';
    if (value <= 3) return 'Cloudy';
    return 'Weather unavailable';
  }
  window.NorthstarWeatherIcon = icon;
  window.precipType = condition;
  window.precipitationKind = condition;
})();
