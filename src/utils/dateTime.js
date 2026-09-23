const startOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const addDays = (value, days) => {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
};

const minutesBetween = (start, end) => Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));

const parseTimeOnDate = (date, time) => {
  const [hour, minute] = String(time || "00:00").split(":").map(Number);
  const parsed = new Date(date);
  parsed.setHours(hour || 0, minute || 0, 0, 0);
  return parsed;
};

const monthRange = (year, month) => {
  const from = new Date(Number(year), Number(month) - 1, 1);
  from.setHours(0, 0, 0, 0);
  const to = new Date(Number(year), Number(month), 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
};

const parseMonthParam = (value) => {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (month < 1 || month > 12) {
    return null;
  }

  return { year, month, ...monthRange(year, month) };
};

const daysBetweenInclusive = (fromDate, toDate) => {
  const from = startOfDay(fromDate);
  const to = startOfDay(toDate);
  return Math.floor((to - from) / 86400000) + 1;
};

const eachDateInclusive = (fromDate, toDate) => {
  const dates = [];
  let cursor = startOfDay(fromDate);
  const end = startOfDay(toDate);

  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }

  return dates;
};

const isSameDay = (left, right) => startOfDay(left).getTime() === startOfDay(right).getTime();

module.exports = {
  startOfDay,
  endOfDay,
  addDays,
  minutesBetween,
  parseTimeOnDate,
  monthRange,
  parseMonthParam,
  daysBetweenInclusive,
  eachDateInclusive,
  isSameDay,
};
