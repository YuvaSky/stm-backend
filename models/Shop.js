const mongoose = require('mongoose');

const shopSchema = new mongoose.Schema({
  name: { type: String, required: true },
  logo: { type: String, default: '' },
  address: { type: String, required: true },
  phone: { type: String, required: true },
  settings: {
    retentionMinutes: { type: Number, default: 60 },
    autoPrint: { type: Boolean, default: true },
    preferredPrinter: { type: String, default: 'AUTO' },
    pricing: {
      A4_BW: { type: Number, default: 2 },
      A4_COLOUR: { type: Number, default: 10 },
      A3_BW: { type: Number, default: 5 },
      A3_COLOUR: { type: Number, default: 20 },
      doubleSidedMultiplier: { type: Number, default: 1.8 }
    }
  }
}, { timestamps: true });

module.exports = mongoose.model('Shop', shopSchema);
