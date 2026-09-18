export const buildAugmontProfile = (context: any) => {
  const name = String(context.user_name || '').trim();
  const mobile = String(context.user_phone || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  const pincode = String(context.address_pincode || '').trim();
  const email = String(context.user_email || '').trim().toLowerCase();
  const line1 = String(context.address_line1 || '').trim();
  const line2 = String(context.address_line2 || '').trim();
  const city = String(context.address_city || '').trim();
  const state = String(context.address_state || '').trim();
  const missing = [
    !context.firebase_uid ? 'profile identifier' : '',
    name.length < 2 ? 'profile name' : '',
    !/^[6-9]\d{9}$/.test(mobile) ? 'profile mobile number' : '',
    !line1 ? 'address' : '',
    !city ? 'address city' : '',
    !state ? 'address state' : '',
    !/^[1-9]\d{5}$/.test(pincode) ? 'six-digit address pincode' : '',
  ].filter(Boolean);
  return {
    missing,
    payload: {
      uniqueId: String(context.firebase_uid || ''), userName: name.slice(0, 50),
      mobileNumber: mobile, userPincode: pincode,
      // NOTE: field names below (userAddress/userCity/userState) follow Augmont's
      // userName/userPincode naming convention but are not confirmed against
      // Augmont's POST /merchant/v1/users documentation. Verify against Augmont
      // support/docs and correct the keys if their API expects different names.
      ...(line1 ? { userAddress: line2 ? `${line1}, ${line2}` : line1 } : {}),
      ...(city ? { userCity: city } : {}),
      ...(state ? { userState: state } : {}),
      ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { emailId: email } : {}),
    },
  };
};
