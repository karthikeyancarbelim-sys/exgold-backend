"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectNerotixAadhaarEvidence = exports.extractNerotixAadhaarEvidence = exports.extractMaskedAadhaar = void 0;
const normalizedKey = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const findValueDeep = (input, keys) => {
    if (!input || typeof input !== "object")
        return null;
    if (Array.isArray(input)) {
        for (const item of input) {
            const value = findValueDeep(item, keys);
            if (value !== null && value !== undefined && value !== "")
                return value;
        }
        return null;
    }
    for (const [key, value] of Object.entries(input)) {
        if (keys.includes(normalizedKey(key)) && value !== null && value !== undefined && value !== "") {
            return value;
        }
        const nested = findValueDeep(value, keys);
        if (nested !== null && nested !== undefined && nested !== "")
            return nested;
    }
    return null;
};
const textValue = (input, keys) => {
    const value = findValueDeep(input, keys);
    const text = value === null || value === undefined ? "" : String(value).trim();
    return text || null;
};
const maskAadhaar = (value) => {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length < 4)
        return null;
    return `XXXX XXXX ${digits.slice(-4)}`;
};
const extractMaskedAadhaar = (payload) => {
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
    if (!text)
        return null;
    if (/[x*]/i.test(text))
        return text;
    return maskAadhaar(text);
};
exports.extractMaskedAadhaar = extractMaskedAadhaar;
const extractNerotixAadhaarEvidence = (payload) => {
    const data = payload?.data && typeof payload.data === "object" ? payload.data : null;
    const transactionId = textValue(data, ["txnid", "transactionid"]);
    const name = textValue(data, ["name", "fullname"]);
    const dob = textValue(data, ["dob", "dateofbirth"]);
    const yearOfBirth = textValue(data, ["yearofbirth"]);
    const gender = textValue(data, ["gender"]);
    const hasAddressEvidence = Boolean(findValueDeep(data, ["address", "splitaddress"]));
    const hasDemographicEvidence = Boolean(dob || yearOfBirth || gender || hasAddressEvidence);
    const verified = Boolean(payload?.success === true &&
        Number(payload?.statusCode) === 1 &&
        transactionId &&
        name &&
        hasDemographicEvidence);
    return {
        verified,
        verifiedVia: verified ? "digilocker" : null,
        masked: (0, exports.extractMaskedAadhaar)(payload),
        name,
        dob,
        yearOfBirth,
        gender,
        hasAddressEvidence,
        transactionId,
    };
};
exports.extractNerotixAadhaarEvidence = extractNerotixAadhaarEvidence;
const selectNerotixAadhaarEvidence = (...payloads) => {
    const evidence = payloads
        .filter((payload) => payload && typeof payload === "object")
        .map(exports.extractNerotixAadhaarEvidence);
    return (evidence.find((item) => item.verified) ||
        evidence.find((item) => item.masked ||
            item.transactionId ||
            item.name ||
            item.dob ||
            item.yearOfBirth ||
            item.gender ||
            item.hasAddressEvidence) ||
        (0, exports.extractNerotixAadhaarEvidence)(null));
};
exports.selectNerotixAadhaarEvidence = selectNerotixAadhaarEvidence;
