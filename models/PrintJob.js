const mongoose = require('mongoose');

const printJobSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  printerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Printer' },
  status: { 
    type: String, 
    enum: ['QUEUED', 'SENDING', 'PRINTING', 'COMPLETED', 'FAILED', 'ABORTED', 'REPRINT_REQUIRED'],
    default: 'QUEUED' 
  },
  attemptNumber: { type: Number, default: 1 },
  startedAt: { type: Date },
  completedAt: { type: Date },
  failureReason: { type: String, default: '' }
}, { timestamps: true });

printJobSchema.index({ orderId: 1 });
printJobSchema.index({ printerId: 1 });
printJobSchema.index({ status: 1 });

module.exports = mongoose.model('PrintJob', printJobSchema);
