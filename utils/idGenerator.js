const crypto = require('crypto');

// Generate non-sequential readable order ID e.g. JOB-A82K7
const generatePublicOrderId = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let randomStr = '';
  for (let i = 0; i < 5; i++) {
    randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `JOB-${randomStr}`;
};

// Generate 4-digit pickup PIN e.g. 5832
const generatePickupPin = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// Simple hash generator for tokens/PINs
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

module.exports = {
  generatePublicOrderId,
  generatePickupPin,
  hashToken
};
