export function getInvalidAmountError(amount: number): string | null {
  if (amount < 5) {
    return "Pledge may be at least $5";
  } else if (amount > 500) {
    return "Pledge may be at most $500";
  } else {
    return null;
  }
}
