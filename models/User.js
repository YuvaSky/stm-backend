const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  mobile: { type: String, required: true },
  email: { type: String, default: '' },
  passwordHash: { type: String, required: true },
  role: { 
    type: String, 
    enum: ['CUSTOMER', 'STAFF', 'MANAGER', 'ADMIN'], 
    default: 'CUSTOMER' 
  }
}, { timestamps: true });

userSchema.index({ mobile: 1 });

module.exports = mongoose.model('User', userSchema);
