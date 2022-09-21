export function fahrenheitToCelcius(f: number) {
  return (f - 32) * (5 / 9);
}

export function celciusToFahrenheit(f: number) {
  return f * (9 / 5) + 32;
}
