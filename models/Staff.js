const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  role: { type: String, enum: ['STAFF', 'MANAGER', 'ADMIN'], default: 'STAFF' },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' }
}, { timestamps: true });

staffSchema.index({ userId: 1 });
staffSchema.index({ branchId: 1 });

module.exports = mongoose.model('Staff', staffSchema);
