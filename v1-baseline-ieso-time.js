/* IESO system time helpers — America/Toronto, 24-hour clock, hour-ending labels. */
(() => {
  const TZ = 'America/Toronto';
  const LOCALE = 'en-CA';

  function asDate(value) {
    if (value == null || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date;
  }

  function parts(value = new Date(), withSeconds = false) {
    const date = asDate(value);
    if (!date) return null;
    const options = {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    };
    if (withSeconds) options.second = '2-digit';
    const bag = Object.fromEntries(
      new Intl.DateTimeFormat(LOCALE, options)
        .formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );
    return {
      year: bag.year,
      month: bag.month,
      day: bag.day,
      hour: bag.hour,
      minute: bag.minute,
      second: bag.second || '00',
    };
  }

  function hourEnding(value = new Date()) {
    const bag = parts(value);
    if (!bag) return '—';
    const hour = Number(bag.hour);
    if (!Number.isFinite(hour)) return '—';
    // IESO HE 01–24: at 21:46 the hour ending is HE 22; at 23:xx it is HE 24.
    return String(hour === 23 ? 24 : hour + 1).padStart(2, '0');
  }

  function clock(value = new Date(), withSeconds = false) {
    const bag = parts(value, withSeconds);
    if (!bag) return '—';
    return withSeconds ? `${bag.hour}:${bag.minute}:${bag.second}` : `${bag.hour}:${bag.minute}`;
  }

  function heStamp(value = new Date()) {
    const bag = parts(value);
    if (!bag) return '[HE — - —]';
    return `[HE ${hourEnding(value)} - ${bag.hour}:${bag.minute}]`;
  }

  function dateTime(value, withSeconds = false) {
    const bag = parts(value, withSeconds);
    if (!bag) return '—';
    const time = withSeconds ? `${bag.hour}:${bag.minute}:${bag.second}` : `${bag.hour}:${bag.minute}`;
    return `${bag.year}-${bag.month}-${bag.day} ${time}`;
  }

  function shortDateTime(value) {
    const date = asDate(value);
    if (!date) return '—';
    return new Intl.DateTimeFormat(LOCALE, {
      timeZone: TZ,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date);
  }

  window.NorthstarIesoTime = {
    TZ,
    parts,
    hourEnding,
    clock,
    heStamp,
    dateTime,
    shortDateTime,
    asDate,
  };
})();
