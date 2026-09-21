"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAugmontProfile = void 0;
const buildAugmontProfile = (context) => {
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
            userAddress: [line1, line2].filter(Boolean).join(', ').slice(0, 255),
            // The service resolves these local names to Augmont master-data IDs.
            ...(city ? { userCity: city } : {}),
            ...(state ? { userState: state } : {}),
            ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { emailId: email } : {}),
        },
    };
};
exports.buildAugmontProfile = buildAugmontProfile;
