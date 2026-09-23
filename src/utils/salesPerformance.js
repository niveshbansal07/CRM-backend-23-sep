const mongoose = require("mongoose");
const ApiError = require("./ApiError");

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const moneyNumber = (value) => {
  if (value == null) return 0;
  if (typeof value === "object" && typeof value.toString === "function") return Number(value.toString()) || 0;
  return Number(value) || 0;
};
const moneyDecimal = (value) => mongoose.Types.Decimal128.fromString(roundMoney(value).toFixed(2));

const assertMoney = (value, label = "Amount") => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new ApiError(400, `${label} must be a non-negative number`);
  return roundMoney(number);
};

const assertTimezone = (timezone) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch (_) {
    throw new ApiError(400, "Invalid IANA timezone");
  }
  return timezone;
};

const zonedParts = (date, timeZone) => Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", {
    timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])
);

const zonedDateTimeToUtc = ({ year, month, day = 1, hour = 0, minute = 0, second = 0 }, timeZone) => {
  assertTimezone(timeZone);
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = new Date(desired);
  for (let pass = 0; pass < 3; pass += 1) {
    const actual = zonedParts(guess, timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour % 24, actual.minute, actual.second);
    guess = new Date(guess.getTime() + desired - represented);
  }
  return guess;
};

const resolveMonthPeriod = ({ year, month, timezone = "Asia/Kolkata", fiscalStartMonth = 4 }) => {
  const y = Number(year);
  const m = Number(month);
  const fiscalMonth = Number(fiscalStartMonth);
  if (!Number.isInteger(y) || y < 2000 || y > 2200 || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new ApiError(400, "Valid target year and month are required");
  }
  if (!Number.isInteger(fiscalMonth) || fiscalMonth < 1 || fiscalMonth > 12) throw new ApiError(400, "Fiscal start month must be 1-12");
  const nextYear = m === 12 ? y + 1 : y;
  const nextMonth = m === 12 ? 1 : m + 1;
  const fiscalYearStart = m >= fiscalMonth ? y : y - 1;
  return {
    periodStart: zonedDateTimeToUtc({ year: y, month: m }, timezone),
    periodEndExclusive: zonedDateTimeToUtc({ year: nextYear, month: nextMonth }, timezone),
    periodKey: `${y}-${String(m).padStart(2, "0")}`,
    fiscalYearLabel: `FY${fiscalYearStart}-${String(fiscalYearStart + 1).slice(-2)}`,
  };
};

module.exports = { roundMoney, moneyNumber, moneyDecimal, assertMoney, assertTimezone, resolveMonthPeriod, zonedDateTimeToUtc };
