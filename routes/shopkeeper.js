const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect, authorize } = require('../middleware/auth');
const Order = require('../models/Order');
const Document = require('../models/Document');
const PrintSetting = require('../models/PrintSetting');
const PrintJob = require('../models/PrintJob');
const Printer = require('../models/Printer');
const AuditLog = require('../models/AuditLog');
const Shop = require('../models/Shop');
const { hashToken } = require('../utils/idGenerator');
const { dispatchPrintJob } = require('../utils/printDispatcher');

// All routes require STAFF, MANAGER or ADMIN role
router.use(protect, authorize('STAFF', 'MANAGER', 'ADMIN'));

// Get Active Queue & Dashboard Summary
router.get('/queue', async (req, res) => {
  try {
    const activeOrders = await Order.find({
      status: { $in: ['PAID', 'QUEUED', 'VERIFIED', 'PRINTING', 'PRINTED', 'READY'] }
    })
    .sort({ createdAt: 1 })
    .populate('userId', 'name mobile email')
    .lean();

    const result = await Promise.all(activeOrders.map(async (order) => {
      const documents = await Document.find({ orderId: order._id }).lean();
      const settings = await PrintSetting.find({ orderId: order._id }).lean();
      return {
        ...order,
        documents,
        settings
      };
    }));

    const stats = {
      newOrders: activeOrders.filter(o => ['PAID', 'QUEUED', 'VERIFIED'].includes(o.status)).length,
      printing: activeOrders.filter(o => o.status === 'PRINTING').length,
      ready: activeOrders.filter(o => o.status === 'READY').length,
      collectedToday: await Order.countDocuments({
        status: 'COLLECTED',
        collectedAt: { $gte: new Date(new Date().setHours(0,0,0,0)) }
      })
    };

    res.json({ success: true, stats, queue: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Verify Customer QR Code
router.post('/verify-qr', async (req, res) => {
  try {
    const { qrToken, targetOrderId } = req.body;

    if (!qrToken) {
      return res.status(400).json({ success: false, message: 'QR token is required' });
    }

    const hashed = hashToken(qrToken);
    const order = await Order.findOne({ qrTokenHash: hashed })
      .populate('userId', 'name mobile')
      .lean();

    if (!order) {
      await AuditLog.create({
        staffId: req.user._id,
        action: 'INVALID_QR_SCAN_ATTEMPT',
        metadata: { scannedToken: qrToken }
      });
      return res.status(400).json({ 
        success: false, 
        mismatch: true,
        message: '🔴 ORDER MISMATCH: This QR code is invalid or does not belong to any active order.' 
      });
    }

    // Check if targetOrderId specified and does not match
    if (targetOrderId && order._id.toString() !== targetOrderId.toString()) {
      await AuditLog.create({
        orderId: order._id,
        staffId: req.user._id,
        action: 'WRONG_ORDER_QR_MISMATCH',
        metadata: { expectedOrder: targetOrderId, scannedOrder: order._id }
      });
      return res.status(400).json({ 
        success: false, 
        mismatch: true,
        message: '🔴 ORDER MISMATCH: Scanned QR belongs to order ' + order.publicOrderId + ', not the selected queue order.' 
      });
    }

    if (order.status === 'COLLECTED') {
      return res.status(400).json({
        success: false,
        message: '⚠️ ALREADY COLLECTED: Order ' + order.publicOrderId + ' was already collected.'
      });
    }

    const documents = await Document.find({ orderId: order._id }).lean();
    const settings = await PrintSetting.find({ orderId: order._id }).lean();

    await AuditLog.create({
      orderId: order._id,
      staffId: req.user._id,
      action: 'QR_VERIFIED',
      metadata: { publicOrderId: order.publicOrderId }
    });

    console.log(`\x1b[36m[SHOPKEEPER QR SCAN] Verified Order ${order.publicOrderId} for Customer ${order.userId?.name}\x1b[0m`);

    res.json({
      success: true,
      verified: true,
      order: {
        ...order,
        documents,
        settings
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Verify Pickup PIN Fallback
router.post('/verify-pin', async (req, res) => {
  try {
    const { pickupPin, orderId } = req.body;

    if (!pickupPin) {
      return res.status(400).json({ success: false, message: 'PIN is required' });
    }

    const hashedPin = hashToken(pickupPin);
    let order;

    if (orderId) {
      order = await Order.findById(orderId).populate('userId', 'name mobile').lean();
      if (!order || order.pickupPinHash !== hashedPin) {
        await AuditLog.create({
          orderId: orderId,
          staffId: req.user._id,
          action: 'FAILED_PIN_ATTEMPT',
          metadata: { enteredPin: pickupPin }
        });
        return res.status(400).json({ success: false, message: '🔴 INVALID PICKUP PIN: Verification failed.' });
      }
    } else {
      order = await Order.findOne({ pickupPinHash: hashedPin, status: { $ne: 'COLLECTED' } })
        .populate('userId', 'name mobile')
        .lean();

      if (!order) {
        return res.status(400).json({ success: false, message: '🔴 INVALID PICKUP PIN: No matching order found.' });
      }
    }

    const documents = await Document.find({ orderId: order._id }).lean();
    const settings = await PrintSetting.find({ orderId: order._id }).lean();

    await AuditLog.create({
      orderId: order._id,
      staffId: req.user._id,
      action: 'PIN_VERIFIED',
      metadata: { publicOrderId: order.publicOrderId }
    });

    res.json({
      success: true,
      verified: true,
      order: {
        ...order,
        documents,
        settings
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Send Print Job to Physical Printer via Local Print Agent
// Send Print Job to Physical Printer via Local Print Agent
router.post('/print-now', async (req, res) => {
  try {
    const { orderId, isReprintConfirmed, printerName } = req.body;
    const io = req.app.get('io');

    const result = await dispatchPrintJob({
      orderId,
      io,
      staffId: req.user._id,
      isReprintConfirmed,
      customPrinterName: printerName
    });

    res.json({
      success: true,
      message: `Print job dispatched to Local Agent -> ${result.finalPrinterName}`,
      printJobId: result.printJob._id,
      printerName: result.finalPrinterName,
      publicOrderId: result.order.publicOrderId
    });
  } catch (err) {
    if (err.requiresReprintConfirmation) {
      return res.status(409).json({
        success: false,
        requiresReprintConfirmation: true,
        printCount: err.printCount,
        message: err.message
      });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// Abort an active print job before handing the order to the customer
router.post('/abort-print', async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (!['PAID', 'QUEUED', 'VERIFIED', 'PRINTING', 'PRINTED'].includes(order.status)) {
      return res.status(409).json({
        success: false,
        message: `Order cannot be aborted from status ${order.status}`
      });
    }

    order.status = 'CANCELLED';
    await order.save();

    const activeJobs = await PrintJob.find({
      orderId: order._id,
      status: { $in: ['QUEUED', 'SENDING', 'PRINTING'] }
    }).select('_id').lean();

    await PrintJob.updateMany(
      { orderId: order._id, status: { $in: ['QUEUED', 'SENDING', 'PRINTING'] } },
      { status: 'ABORTED', failureReason: 'Aborted by staff', completedAt: new Date() }
    );

    await AuditLog.create({
      orderId: order._id,
      staffId: req.user._id,
      action: 'PRINT_ABORTED',
      metadata: { publicOrderId: order.publicOrderId }
    });

    const io = req.app.get('io');
    if (io) {
      activeJobs.forEach(job => io.emit('agent_abort_print', { printJobId: job._id }));
      io.emit('order_status_updated', {
        orderId: order._id,
        publicOrderId: order.publicOrderId,
        status: 'CANCELLED'
      });
    }

    res.json({ success: true, message: `Print aborted for ${order.publicOrderId}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get Auto-Print & Preferred Connected Printer Settings
router.get('/autoprint-settings', async (req, res) => {
  try {
    let shop = await Shop.findOne();
    res.json({
      success: true,
      autoPrint: shop?.settings?.autoPrint !== false,
      preferredPrinter: shop?.settings?.preferredPrinter || 'AUTO'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Auto-Print & Preferred Connected Printer Settings
router.post('/autoprint-settings', async (req, res) => {
  try {
    const { autoPrint, preferredPrinter } = req.body;
    let shop = await Shop.findOne();
    if (!shop) {
      shop = await Shop.create({
        name: 'Secure Print Shop',
        address: 'Counter 1',
        phone: '9999999999',
        settings: {}
      });
    }

    if (!shop.settings) shop.settings = {};
    if (autoPrint !== undefined) shop.settings.autoPrint = autoPrint;
    if (preferredPrinter !== undefined) shop.settings.preferredPrinter = preferredPrinter;

    await shop.save();

    // Broadcast update to all connected screens
    const io = req.app.get('io');
    if (io) {
      io.emit('autoprint_settings_updated', {
        autoPrint: shop.settings.autoPrint,
        preferredPrinter: shop.settings.preferredPrinter
      });
    }

    res.json({
      success: true,
      autoPrint: shop.settings.autoPrint,
      preferredPrinter: shop.settings.preferredPrinter,
      message: shop.settings.autoPrint 
        ? '⚡ Automatic Printing enabled! New customer orders will print immediately.'
        : '⏸️ Manual Queue enabled. Orders will wait for staff "PRINT NOW" click.'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Mark Order Ready for Pickup
router.post('/mark-ready', async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    order.status = 'READY';
    order.readyAt = new Date();
    await order.save();

    await PrintJob.updateMany({ orderId: order._id, status: 'PRINTING' }, { status: 'COMPLETED', completedAt: new Date() });

    await AuditLog.create({
      orderId: order._id,
      staffId: req.user._id,
      action: 'ORDER_MARKED_READY',
      metadata: { publicOrderId: order.publicOrderId }
    });

    // Broadcast update
    const io = req.app.get('io');
    if (io) {
      io.emit('order_status_updated', {
        orderId: order._id,
        publicOrderId: order.publicOrderId,
        status: 'READY'
      });
    }

    res.json({ success: true, message: `Order ${order.publicOrderId} marked READY for pickup` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Final Pickup & Physical Packet Handover
router.post('/collect-order', async (req, res) => {
  try {
    const { orderId, physicalJobIdChecked } = req.body;

    let order = null;
    if (mongoose.Types.ObjectId.isValid(orderId)) {
      order = await Order.findById(orderId);
    }
    if (!order) {
      order = await Order.findOne({ publicOrderId: orderId });
    }
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (!physicalJobIdChecked) {
      return res.status(400).json({
        success: false,
        message: '🔴 PHYSICAL PACKET MISMATCH: You must verify that Digital Job ID matches Physical Job ID on tray/envelope.'
      });
    }

    order.status = 'COLLECTED';
    order.collectedAt = new Date();

    // Set retention expiry timer (e.g., 60 mins from collection)
    const retentionMinutes = parseInt(process.env.RETENTION_MINUTES || '60', 10);
    order.expiresAt = new Date(Date.now() + retentionMinutes * 60 * 1000);
    await order.save();

    await AuditLog.create({
      orderId: order._id,
      staffId: req.user._id,
      action: 'ORDER_COLLECTED_HANDOVER_COMPLETE',
      metadata: { publicOrderId: order.publicOrderId, collectedAt: order.collectedAt }
    });

    console.log(`\x1b[32m[HANDOVER COMPLETE] Order ${order.publicOrderId} handed over to Customer. Status: COLLECTED. Physical file retention auto-delete timer initiated.\x1b[0m`);

    // Broadcast update
    const io = req.app.get('io');
    if (io) {
      io.emit('order_status_updated', {
        orderId: order._id,
        publicOrderId: order.publicOrderId,
        status: 'COLLECTED'
      });
    }

    res.json({
      success: true,
      message: `Handover complete for ${order.publicOrderId}. Order status set to COLLECTED. Auto-deletion retention started.`,
      expiresAt: order.expiresAt
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Reports & Analytics
router.get('/reports', async (req, res) => {
  try {
    const todayStart = new Date(new Date().setHours(0,0,0,0));

    const todayOrders = await Order.find({ createdAt: { $gte: todayStart } });
    const totalSales = todayOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const completedOrders = todayOrders.filter(o => o.status === 'COLLECTED').length;

    res.json({
      success: true,
      reports: {
        todayOrdersCount: todayOrders.length,
        todaySales: totalSales,
        completedOrders,
        pendingOrders: todayOrders.length - completedOrders
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get Live Local Print Agent Status & Telemetry
router.get('/agent-status', (req, res) => {
  const io = req.app.get('io');
  const activeAgents = req.app.get('activeAgents');
  const agentRoom = io?.sockets?.adapter?.rooms?.get('print_agents');
  const count = agentRoom ? agentRoom.size : 0;
  const agentsList = activeAgents ? Array.from(activeAgents.values()) : [];

  const list = [];
  agentsList.forEach(agent => {
    if (!agent.printers) return;
    if (Array.isArray(agent.printers)) {
      agent.printers.forEach(p => {
        if (typeof p === 'string') {
          list.push({ name: p, isDefault: false, status: 'Ready' });
        } else if (p && p.name) {
          list.push({
            name: p.name,
            isDefault: Boolean(p.isDefault),
            status: p.status || 'Ready'
          });
        }
      });
    } else if (typeof agent.printers === 'string') {
      const lines = agent.printers.split('\n').filter(l => l.trim() && !l.includes('---') && !l.includes('PrinterStatus'));
      lines.forEach(line => {
        const match = line.match(/^(\S.*?\S)\s{2,}/);
        const name = match ? match[1].trim() : line.trim();
        const isDefault = line.toLowerCase().includes('true');
        if (name && name !== 'Name') {
          list.push({ name, isDefault, status: 'Ready' });
        }
      });
    }
  });

  const seen = new Set();
  const printers = list.filter(p => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });

  res.json({
    success: true,
    online: count > 0,
    count,
    agents: agentsList,
    printers: printers,
    secretConfigured: !!(process.env.AGENT_SECRET || 'agent_secret_token_998877')
  });
});

// Dispatch a Test Print Job Signal to Local Print Agent
router.post('/test-print', async (req, res) => {
  try {
    const io = req.app.get('io');
    const agentRoom = io?.sockets?.adapter?.rooms?.get('print_agents');
    const isOnline = agentRoom && agentRoom.size > 0;
    const testJobId = 'TEST-' + Date.now().toString(36).toUpperCase();

    if (io) {
      io.emit('agent_test_print', {
        testJobId,
        timestamp: new Date(),
        initiatedBy: req.user ? req.user.name : 'Shopkeeper Staff'
      });
    }

    console.log(`\x1b[36m[TEST PRINT DISPATCHED] ID: ${testJobId} | Agent Online: ${!!isOnline}\x1b[0m`);

    res.json({
      success: true,
      testJobId,
      agentConnected: !!isOnline,
      message: isOnline
        ? `✅ Test print signal (${testJobId}) dispatched to connected Local Print Agent!`
        : `⚠️ Test print signal (${testJobId}) sent to WebSocket queue. Start 'npm start' in print-agent to process.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
