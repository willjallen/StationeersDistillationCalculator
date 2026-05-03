export function numberText(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

export function percentText(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${numberText(value * 100, digits)}%`;
}

export function shortName(name: string): string {
  return name
    .replace("Carbon Dioxide", "CO₂")
    .replace("Nitrous Oxide", "N₂O")
    .replace("Oxygen", "O₂")
    .replace("Nitrogen", "N₂")
    .replace("Hydrogen", "H₂")
    .replace("Methane", "CH₄")
    .replace("Ozone", "O₃")
    .replace("Water", "H₂O");
}
