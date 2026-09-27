const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  publicOrderId: { type: String, required: true }, // e.g. JOB-A82K7
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  status: { 
    type: String, 
    enum: [
      'CREATED', 
      'PAYMENT_PENDING', 
      'PAID', 
      'QUEUED', 
      'VERIFIED', 
      'PRINTING', 
      'PRINTED', 
      'READY', 
      'COLLECTED', 
      'EXPIRED',
      'CANCELLED',
      'PRINT_FAILED',
      'PARTIAL_PRINT'
    ], 
    default: 'CREATED' 
  },
  totalAmount: { type: Number, required: true, default: 0 },
  paymentStatus: { type: String, enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED'], default: 'PENDING' },
  qrTokenHash: { type: String, required: true },
  pickupPinHash: { type: String, required: true }, // 4-digit PIN hash
  rawPickupPin: { type: String }, // Stored for display to customer in demo mode
  printCount: { type: Number, default: 0 },
  printedToPrinter: { type: String }, // Name of hardware printer dispatched to
  printedAt: { type: Date },
  readyAt: { type: Date },
  collectedAt: { type: Date },
  expiresAt: { type: Date }
}, { timestamps: true });

orderSchema.index({ publicOrderId: 1 }, { unique: true });
orderSchema.index({ userId: 1 });
orderSchema.index({ branchId: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ createdAt: 1 });

module.exports = mongoose.model('Order', orderSchema);
