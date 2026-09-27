const mongoose = require('mongoose');

const printerSchema = new mongoose.Schema({
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  name: { type: String, required: true }, // e.g. "Main Shop HP LaserJet Pro A4"
  type: { type: String, default: 'LASER' },
  capabilities: {
    paperSizes: [{ type: String, enum: ['A4', 'A3'] }],
    color: { type: Boolean, default: false },
    duplex: { type: Boolean, default: true }
  },
  status: { 
    type: String, 
    enum: ['ONLINE', 'OFFLINE', 'ERROR', 'PAPER_LOW', 'TONER_LOW'], 
    default: 'ONLINE' 
  },
  lastSeenAt: { type: Date, default: Date.now }
}, { timestamps: true });

printerSchema.index({ branchId: 1 });

module.exports = mongoose.model('Printer', printerSchema);
