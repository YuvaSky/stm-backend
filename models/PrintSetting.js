const mongoose = require('mongoose');

const printSettingSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  paperSize: { type: String, enum: ['A4', 'A3'], default: 'A4' },
  colorMode: { type: String, enum: ['BW', 'COLOUR'], default: 'BW' },
  sides: { type: String, enum: ['SINGLE', 'DOUBLE'], default: 'SINGLE' },
  copies: { type: Number, default: 1 },
  orientation: { type: String, enum: ['PORTRAIT', 'LANDSCAPE'], default: 'PORTRAIT' },
  pageRange: { type: String, default: 'ALL' }
}, { timestamps: true });

printSettingSchema.index({ orderId: 1 });
printSettingSchema.index({ documentId: 1 });

module.exports = mongoose.model('PrintSetting', printSettingSchema);
