const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const PrintJob = require('../models/PrintJob');
const Printer = require('../models/Printer');
const Document = require('../models/Document');
const Order = require('../models/Order');

// Middleware verifying agent authentication key
const verifyAgent = (req, res, next) => {
  const token = req.headers['x-agent-secret'];
  if (!token || token !== (process.env.AGENT_SECRET || 'agent_secret_token_998877')) {
    return res.status(401).json({ success: false, message: 'Invalid agent credentials' });
  }
  next();
};

router.use(verifyAgent);

// Agent fetches pending print jobs
router.get('/pending-jobs', async (req, res) => {
  try {
    const jobs = await PrintJob.find({ status: 'PRINTING' })
      .populate('orderId')
      .populate('printerId')
      .lean();

    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Download raw document payload for direct physical printing
router.get('/download/:docId', async (req, res) => {
  try {
    const doc = await Document.findById(req.params.docId);
    if (!doc || doc.deletedAt) {
      return res.status(404).json({ success: false, message: 'Document not found or expired' });
    }

    const absolutePath = path.isAbsolute(doc.storageKey)
      ? doc.storageKey
      : path.join(__dirname, '../', doc.storageKey);

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ success: false, message: 'Physical file not found' });
    }

    res.download(absolutePath, doc.originalFileName);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Print Job Status
router.post('/job-status', async (req, res) => {
  try {
    const { printJobId, status, failureReason } = req.body;
    const printJob = await PrintJob.findById(printJobId);
    if (!printJob) {
      return res.status(404).json({ success: false, message: 'Print job not found' });
    }

    if (printJob.status === 'ABORTED') {
      return res.status(409).json({ success: false, message: 'Print job was aborted by staff' });
    }

    printJob.status = status;
    let updatedOrder = null;
    if (status === 'COMPLETED') {
      printJob.completedAt = new Date();
      updatedOrder = await Order.findByIdAndUpdate(
        printJob.orderId, 
        { status: 'PRINTED' }, 
        { new: true }
      );
    } else if (status === 'FAILED') {
      printJob.failureReason = failureReason || 'Printer error';
      updatedOrder = await Order.findByIdAndUpdate(
        printJob.orderId, 
        { status: 'PRINT_FAILED' }, 
        { new: true }
      );
    }

    await printJob.save();

    // Broadcast live update to shopkeeper dashboard
    const io = req.app.get('io');
    if (io && updatedOrder) {
      io.emit('order_status_updated', {
        orderId: updatedOrder._id,
        publicOrderId: updatedOrder.publicOrderId,
        status: updatedOrder.status,
        printedToPrinter: updatedOrder.printedToPrinter,
        printCount: updatedOrder.printCount
      });
    }

    res.json({ success: true, printJob });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Printer Telemetry (Online/Paper Low/Offline)
router.post('/printer-status', async (req, res) => {
  try {
    const { printerId, status } = req.body;
    const printer = await Printer.findById(printerId);
    if (printer) {
      printer.status = status;
      printer.lastSeenAt = new Date();
      await printer.save();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
