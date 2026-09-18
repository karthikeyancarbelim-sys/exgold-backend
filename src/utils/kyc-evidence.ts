const normalizedKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const findValueDeep = (input: any, keys: string[]): any => {
  if (!input || typeof input !== "object") return null;

  if (Array.isArray(input)) {
    for (const item of input) {
      const value = findValueDeep(item, keys);
      if (value !== null && value !== undefined && value !== "") return value;
    }
    return null;
  }

  for (const [key, value] of Object.entries(input)) {
    if (keys.includes(normalizedKey(key)) && value !== null && value !== undefined && value !== "") {
      return value;
    }

    const nested = findValueDeep(value, keys);
    if (nested !== null && nested !== undefined && nested !== "") return nested;
  }

  return null;
};

const textValue = (input: any, keys: string[]) => {
  const value = findValueDeep(input, keys);
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text || null;
};

const maskAadhaar = (value: any) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `XXXX XXXX ${digits.slice(-4)}`;
};

export const extractMaskedAadhaar = (payload: any) => {
  const value = findValueDeep(payload, [
    "aadhaar",
    "aadhaarnumber",
    "aadharnumber",
    "uid",
    "uidnumber",
    "maskednumber",
    "maskedaadhaar",
    "maskedaadhaarnumber",
  ]);
  const text = String(value || "").trim();
  if (!text) return null;
  if (/[x*]/i.test(text)) return text;
  return maskAadhaar(text);
};

export interface AadhaarEvidence {
  verified: boolean;
  verifiedVia: "digilocker" | null;
  masked: string | null;
  name: string | null;
  dob: string | null;
  yearOfBirth: string | null;
  gender: string | null;
  hasAddressEvidence: boolean;
  transactionId: string | null;
}

export const extractNerotixAadhaarEvidence = (payload: any): AadhaarEvidence => {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : null;
  const transactionId = textValue(data, ["txnid", "transactionid"]);
  const name = textValue(data, ["name", "fullname"]);
  const dob = textValue(data, ["dob", "dateofbirth"]);
  const yearOfBirth = textValue(data, ["yearofbirth"]);
  const gender = textValue(data, ["gender"]);
  const hasAddressEvidence = Boolean(findValueDeep(data, ["address", "splitaddress"]));
  const hasDemographicEvidence = Boolean(dob || yearOfBirth || gender || hasAddressEvidence);
  const verified = Boolean(
    payload?.success === true &&
      Number(payload?.statusCode) === 1 &&
      transactionId &&
      name &&
      hasDemographicEvidence
  );

  return {
    verified,
    verifiedVia: verified ? "digilocker" : null,
    masked: extractMaskedAadhaar(payload),
    name,
    dob,
    yearOfBirth,
    gender,
    hasAddressEvidence,
    transactionId,
  };
};

export const selectNerotixAadhaarEvidence = (...payloads: any[]): AadhaarEvidence => {
  const evidence = payloads
    .filter((payload) => payload && typeof payload === "object")
    .map(extractNerotixAadhaarEvidence);

  return (
    evidence.find((item) => item.verified) ||
    evidence.find(
      (item) =>
        item.masked ||
        item.transactionId ||
        item.name ||
        item.dob ||
        item.yearOfBirth ||
        item.gender ||
        item.hasAddressEvidence
    ) ||
    extractNerotixAadhaarEvidence(null)
  );
};
