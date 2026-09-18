const accountDigits = (value: unknown) => String(value || "").replace(/\D+/g, "");

export const accountLast4 = (value: unknown) => accountDigits(value).slice(-4);

export const maskAccountNumber = (value: unknown) => {
  const digits = accountDigits(value);
  if (!digits) return "";
  if (digits.length <= 4) return digits;
  return `${"*".repeat(Math.min(digits.length - 4, 8))}${digits.slice(-4)}`;
};

export const redactProviderPayload = (value: any): any => {
  if (Array.isArray(value)) return value.map(redactProviderPayload);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, next]) => {
      if (/account.?number/i.test(key)) return [key, maskAccountNumber(next)];
      if (/token|password|secret|authorization/i.test(key)) return [key, "[REDACTED]"];
      return [key, redactProviderPayload(next)];
    })
  );
};

export const normalizeIfsc = (value: unknown) =>
  String(value || "").replace(/\s+/g, "").toUpperCase();

export const readDeep = (value: any, keys: string[]): any => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = readDeep(item, keys);
      if (found !== undefined && found !== null && found !== "") return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;

  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== "") {
      return value[key];
    }
  }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object") {
      const found = readDeep(nested, keys);
      if (found !== undefined && found !== null && found !== "") return found;
    }
  }
  return undefined;
};

export const readDeepArray = (value: any, keys: string[]): any[] => {
  const found = readDeep(value, keys);
  if (Array.isArray(found)) return found;
  if (found && typeof found === "object") return [found];
  return [];
};
