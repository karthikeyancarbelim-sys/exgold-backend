const assert = require('node:assert/strict');
const { buildAugmontProfile } = require('../dist/utils/augmont-profile');
const fixture = { firebase_uid: 'profile-test', user_name: 'Profile Name',
  user_phone: '+919876543210', user_email: 'DEMO@EXAMPLE.COM',
  address_line1: 'Test address', address_city: 'Coimbatore',
  address_state: 'Tamil Nadu', address_pincode: '641001' };
const noKyc = buildAugmontProfile(fixture);
assert.deepEqual(noKyc.missing, []);
assert.equal(noKyc.payload.mobileNumber, '9876543210');
assert.equal(noKyc.payload.emailId, 'demo@example.com');
assert.deepEqual(buildAugmontProfile({ ...fixture, pan_name: 'Different KYC Name',
  aadhaar_status: 'rejected', pan_status: 'pending' }), noKyc);
assert.ok(buildAugmontProfile({ ...fixture, address_line1: '' }).missing.includes('address'));
assert.ok(buildAugmontProfile({ ...fixture, user_phone: '123' }).missing.includes('profile mobile number'));
assert.ok(buildAugmontProfile({ ...fixture, address_pincode: '641001999' }).missing.includes('six-digit address pincode'));
assert.ok(!Object.keys(noKyc.payload).some(key => /pan|aadhaar|kyc|status/i.test(key)));
console.log('Augmont profile: complete address/mobile, no KYC gate or approval fields passed');
