const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  originalFileName: { type: String, required: true },
  fileType: { type: String, required: true }, // pdf, docx, png, jpg, etc.
  sourceType: { 
    type: String, 
    enum: ['UPLOAD', 'CAMERA_CAPTURE', 'CAMERA_SCAN', 'GALLERY'], 
    required: true 
  },
  fileSize: { type: Number, required: true },
  pageCount: { type: Number, default: 1 },
  storageKey: { type: String, required: true }, // private relative file path
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

documentSchema.index({ orderId: 1 });
documentSchema.index({ userId: 1 });

module.exports = mongoose.model('Document', documentSchema);
