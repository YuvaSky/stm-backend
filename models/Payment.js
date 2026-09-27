const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  amount: { type: Number, required: true },
  method: { type: String, enum: ['CASH', 'UPI', 'ONLINE'], default: 'UPI' },
  status: { type: String, enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED'], default: 'PENDING' },
  transactionReference: { type: String, required: true }
}, { timestamps: true });

paymentSchema.index({ orderId: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
