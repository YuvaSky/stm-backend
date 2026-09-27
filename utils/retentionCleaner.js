const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const Order = require('../models/Order');
const Document = require('../models/Document');
const AuditLog = require('../models/AuditLog');

const initRetentionCleaner = () => {
  // Run every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    console.log('[Retention Cleaner Job]: Checking for expired documents...');
    try {
      const now = new Date();
      // Find collected orders where expiresAt is past
      const expiredOrders = await Order.find({
        status: 'COLLECTED',
        expiresAt: { $lte: now }
      });

      for (const order of expiredOrders) {
        const documents = await Document.find({ orderId: order._id, deletedAt: null });

        for (const doc of documents) {
          if (doc.storageKey) {
            const absolutePath = path.isAbsolute(doc.storageKey)
              ? doc.storageKey
              : path.join(__dirname, '../', doc.storageKey);

            if (fs.existsSync(absolutePath)) {
              try {
                fs.unlinkSync(absolutePath);
                console.log(`[Retention Cleaner]: Deleted physical file ${doc.originalFileName} for order ${order.publicOrderId}`);
              } catch (unlinkErr) {
                console.error(`[Retention Cleaner]: Error deleting file ${doc.storageKey}: ${unlinkErr.message}`);
              }
            }
          }
          doc.deletedAt = now;
          await doc.save();
        }

        order.status = 'EXPIRED';
        await order.save();

        await AuditLog.create({
          orderId: order._id,
          action: 'AUTOMATIC_DOCUMENT_DELETION',
          metadata: { publicOrderId: order.publicOrderId, deletedAt: now }
        });
      }
    } catch (err) {
      console.error('[Retention Cleaner Error]:', err.message);
    }
  });
};

module.exports = initRetentionCleaner;
