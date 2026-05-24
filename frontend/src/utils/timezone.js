export const EXDA_DISPLAY_TIME_ZONE = 'Europe/Copenhagen';

const asDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatExdaClock = (value) => {
  const date = asDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: EXDA_DISPLAY_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
};

export const formatExdaTime = (value) => {
  const date = asDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: EXDA_DISPLAY_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
};

export const formatExdaDate = (value) => {
  const date = asDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: EXDA_DISPLAY_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

export const formatExdaDateTime = (value) => {
  const date = asDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: EXDA_DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(',', '');
};
