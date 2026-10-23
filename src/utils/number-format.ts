export function padTwoDigits(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
