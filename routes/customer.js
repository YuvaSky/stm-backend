const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const Order = require('../models/Order');
const Document = require('../models/Document');
const PrintSetting = require('../models/PrintSetting');
const Payment = require('../models/Payment');
const Shop = require('../models/Shop');
const Branch = require('../models/Branch');
const AuditLog = require('../models/AuditLog');
const { generatePublicOrderId, generatePickupPin, hashToken } = require('../utils/idGenerator');
const { convertImagesToPDF } = require('../utils/pdfMerger');
const { dispatchPrintJob } = require('../utils/printDispatcher');

// Helper to parse page range strings like "1-5", "2,3,4", "1 to 5"
function parsePageRange(rangeStr, maxPages = 9999) {
  if (!rangeStr || rangeStr.trim().toUpperCase() === 'ALL') {
    return Array.from({ length: maxPages }, (_, i) => i + 1);
  }
  let clean = rangeStr.replace(/\bto\b/gi, '-');
  clean = clean.replace(/\s*-\s*/g, '-');
  const parts = clean.split(/[,;\s]+/).filter(Boolean);
  const pages = new Set();
  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        const low = Math.max(1, Math.min(start, end));
        const high = Math.min(maxPages, Math.max(start, end));
        for (let p = low; p <= high; p++) pages.add(p);
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1 && num <= maxPages) {
        pages.add(num);
      }
    }
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);
  return sorted.length > 0 ? sorted : Array.from({ length: maxPages }, (_, i) => i + 1);
}

// Upload individual or multiple files with explicit Multer error catching
router.post('/upload', protect, (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) {
      console.error('[Multer Upload Error]:', err.message);
      return res.status(400).json({ success: false, message: err.message || 'File upload error' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    const uploadedDocs = await Promise.all(req.files.map(async file => {
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
      let pageCount = 1;
      if (ext === 'pdf') {
        try {
          const bytes = fs.readFileSync(file.path);
          const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
          pageCount = pdfDoc.getPageCount();
        } catch (e) {
          console.warn('[PDF Read Warning]:', e.message);
        }
      }
      return {
        originalFileName: file.originalname,
        fileType: ext || 'pdf',
        fileSize: file.size,
        tempPath: file.path,
        fileUrl: `/uploads/temp/${path.basename(file.path)}`,
        pageCount: pageCount,
        totalPages: pageCount,
        pageRange: 'ALL',
        sourceType: req.body.sourceType || 'UPLOAD'
      };
    }));

    console.log(`\x1b[32m[FILE UPLOADED] ${uploadedDocs.length} file(s) uploaded successfully by ${req.user ? req.user.name : 'Customer'}\x1b[0m`);

    res.json({ success: true, documents: uploadedDocs });
  } catch (err) {
    console.error('[Upload API Processing Error]:', err.message);
    res.status(500).json({ success: false, message: 'Upload processing failed: ' + err.message });
  }
});

// Upload Multi-page Camera Scans / Captures and Merge to Single PDF
router.post('/camera-scan', protect, (req, res, next) => {
  upload.array('pages', 20)(req, res, (err) => {
    if (err) {
      console.error('[Multer Camera Error]:', err.message);
      return res.status(400).json({ success: false, message: err.message || 'Camera scan error' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No scanned pages uploaded' });
    }

    const imagePaths = req.files.map(f => f.path);
    const outputFilename = `Scanned_Doc_${Date.now()}.pdf`;
    const outputPath = path.join(__dirname, '../uploads/temp', outputFilename);

    const pageCount = await convertImagesToPDF(imagePaths, outputPath);

    // Clean up temporary image pages
    imagePaths.forEach(p => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });

    const stats = fs.statSync(outputPath);

    res.json({
      success: true,
      document: {
        originalFileName: outputFilename,
        fileType: 'pdf',
        fileSize: stats.size,
        tempPath: outputPath,
        fileUrl: `/uploads/temp/${outputFilename}`,
        pageCount,
        totalPages: pageCount,
        pageRange: 'ALL',
        sourceType: req.body.sourceType || 'CAMERA_SCAN'
      }
    });
  } catch (err) {
    console.error('[Camera Scan Error]:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Calculate Pricing preview
router.post('/calculate-price', protect, async (req, res) => {
  try {
    const { items, shopId } = req.body;
    let shop = null;
    if (shopId) {
      shop = await Shop.findById(shopId);
    }
    if (!shop) {
      shop = await Shop.findOne() || {
        settings: {
          pricing: { A4_BW: 2, A4_COLOUR: 10, A3_BW: 5, A3_COLOUR: 20, doubleSidedMultiplier: 1.8 }
        }
      };
    }

    const pricing = shop.settings.pricing;
    let totalAmount = 0;

    const breakdown = (items || []).map(item => {
      const totalPages = item.totalPages || item.pageCount || 1;
      const isCustomRange = item.pageRange && item.pageRange.trim().toUpperCase() !== 'ALL';
      const selectedPages = isCustomRange ? parsePageRange(item.pageRange, totalPages) : Array.from({ length: totalPages }, (_, i) => i + 1);
      const pageCount = selectedPages.length;
      const copies = item.copies || 1;
      const isColour = item.colorMode === 'COLOUR';
      const isA3 = item.paperSize === 'A3';
      const isDouble = item.sides === 'DOUBLE';

      let basePrice = 2; // Default A4 BW
      if (isA3 && isColour) basePrice = pricing.A3_COLOUR || 20;
      else if (isA3 && !isColour) basePrice = pricing.A3_BW || 5;
      else if (!isA3 && isColour) basePrice = pricing.A4_COLOUR || 10;
      else basePrice = pricing.A4_BW || 2;

      let itemTotal = pageCount * basePrice * copies;
      if (isDouble && pageCount > 1) {
        itemTotal = itemTotal * (pricing.doubleSidedMultiplier || 0.9);
      }

      itemTotal = Math.ceil(itemTotal);
      totalAmount += itemTotal;

      return {
        fileName: item.originalFileName,
        pageCount,
        totalPages,
        selectedPages,
        pageRange: item.pageRange || 'ALL',
        copies,
        paperSize: item.paperSize || 'A4',
        colorMode: item.colorMode || 'BW',
        sides: item.sides || 'SINGLE',
        calculatedPrice: itemTotal
      };
    });

    res.json({ success: true, totalAmount, breakdown });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Create Order with Documents & Print Settings
router.post('/create-order', protect, async (req, res) => {
  try {
    const { items, paymentMethod, shopId, branchId } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No document items in order' });
    }

    let shop = shopId ? await Shop.findById(shopId) : await Shop.findOne();
    let branch = branchId ? await Branch.findById(branchId) : await Branch.findOne();

    if (!shop || !branch) {
      return res.status(400).json({ success: false, message: 'Shop or branch not configured' });
    }

    const publicOrderId = generatePublicOrderId();
    const pickupPin = generatePickupPin();
    const rawQrToken = `QR_${publicOrderId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const qrTokenHash = hashToken(rawQrToken);
    const pickupPinHash = hashToken(pickupPin);

    // Calculate total price accurately based on selected page counts
    const pricing = shop.settings.pricing || { A4_BW: 2, A4_COLOUR: 10, A3_BW: 5, A3_COLOUR: 20 };
    let totalAmount = 0;

    items.forEach(item => {
      const totalPages = item.totalPages || item.pageCount || 1;
      const isCustomRange = item.pageRange && item.pageRange.trim().toUpperCase() !== 'ALL';
      const selectedPages = isCustomRange ? parsePageRange(item.pageRange, totalPages) : Array.from({ length: totalPages }, (_, i) => i + 1);
      const pages = selectedPages.length;
      const copies = item.copies || 1;
      const isColour = item.colorMode === 'COLOUR';
      const isA3 = item.paperSize === 'A3';
      let rate = isA3 ? (isColour ? pricing.A3_COLOUR : pricing.A3_BW) : (isColour ? pricing.A4_COLOUR : pricing.A4_BW);
      let itemTotal = pages * rate * copies;
      if (item.sides === 'DOUBLE' && pages > 1) {
        itemTotal = itemTotal * (pricing.doubleSidedMultiplier || 0.9);
      }
      totalAmount += Math.ceil(itemTotal);
    });

    // Create Order Document
    const order = await Order.create({
      publicOrderId,
      userId: req.user._id,
      shopId: shop._id,
      branchId: branch._id,
      status: 'PAID', // Direct simulator for shop flow
      totalAmount,
      paymentStatus: 'PAID',
      qrTokenHash,
      pickupPinHash,
      rawPickupPin: pickupPin // Stored for display to customer in demo UI
    });

    // Save Payment Record
    await Payment.create({
      orderId: order._id,
      amount: totalAmount,
      method: paymentMethod || 'UPI',
      status: 'PAID',
      transactionReference: `TXN-${Date.now()}`
    });

    // Process Documents & Settings
    const orderDir = path.join(__dirname, `../uploads/private/orders/${order.publicOrderId}`);
    if (!fs.existsSync(orderDir)) {
      fs.mkdirSync(orderDir, { recursive: true });
    }

    const createdDocs = [];

    for (const item of items) {
      const totalPages = item.totalPages || item.pageCount || 1;
      const isCustomRange = item.pageRange && item.pageRange.trim().toUpperCase() !== 'ALL';
      const selectedPages = isCustomRange ? parsePageRange(item.pageRange, totalPages) : Array.from({ length: totalPages }, (_, i) => i + 1);
      const actualPrintPages = selectedPages.length;

      let finalStorageKey = item.tempPath;
      if (item.tempPath && fs.existsSync(item.tempPath)) {
        const targetPath = path.join(orderDir, path.basename(item.tempPath));

        // If it is a PDF and user chose specific pages, slice the PDF so only selected pages are physically saved and printed
        if (item.fileType === 'pdf' && isCustomRange && selectedPages.length < totalPages) {
          try {
            const srcBytes = fs.readFileSync(item.tempPath);
            const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
            const slicedDoc = await PDFDocument.create();
            const indices = selectedPages.map(p => p - 1).filter(idx => idx >= 0 && idx < srcDoc.getPageCount());
            const copiedPages = await slicedDoc.copyPages(srcDoc, indices);
            copiedPages.forEach(p => slicedDoc.addPage(p));
            const slicedBytes = await slicedDoc.save();
            fs.writeFileSync(targetPath, slicedBytes);
            try { fs.unlinkSync(item.tempPath); } catch (_) {}
          } catch (sliceErr) {
            console.warn('[PDF Slicing Error, using full document]:', sliceErr.message);
            fs.renameSync(item.tempPath, targetPath);
          }
        } else {
          fs.renameSync(item.tempPath, targetPath);
        }

        finalStorageKey = `uploads/private/orders/${order.publicOrderId}/${path.basename(item.tempPath)}`;
      }

      const doc = await Document.create({
        orderId: order._id,
        userId: req.user._id,
        originalFileName: item.originalFileName || 'document.pdf',
        fileType: item.fileType || 'pdf',
        sourceType: item.sourceType || 'UPLOAD',
        fileSize: item.fileSize || 1024,
        pageCount: actualPrintPages,
        storageKey: finalStorageKey
      });

      await PrintSetting.create({
        orderId: order._id,
        documentId: doc._id,
        paperSize: item.paperSize || 'A4',
        colorMode: item.colorMode || 'BW',
        sides: item.sides || 'SINGLE',
        copies: item.copies || 1,
        orientation: item.orientation || 'PORTRAIT',
        pageRange: item.pageRange || 'ALL'
      });

      createdDocs.push(doc);
    }

    // Log Terminal Event
    console.log(`\x1b[32m[ORDER CREATED] Public Job ID: ${publicOrderId} | Customer: ${req.user ? req.user.name : 'Guest'} | Total: ₹${totalAmount} | Documents: ${createdDocs.length}\x1b[0m`);

    // Log Audit
    await AuditLog.create({
      orderId: order._id,
      userId: req.user._id,
      action: 'ORDER_CREATED',
      metadata: { publicOrderId, totalAmount, documentsCount: createdDocs.length }
    });

    // Notify Connected Dashboard via Socket.io if available
    const io = req.app.get('io');
    if (io) {
      io.emit('new_order_created', {
        orderId: order._id,
        publicOrderId: order.publicOrderId,
        totalAmount: order.totalAmount,
        documentsCount: createdDocs.length,
        status: order.status
      });
    }

    // Auto-Print: If enabled, automatically dispatch document directly to connected printer
    const isAutoPrint = shop.settings?.autoPrint !== false;
    if (isAutoPrint) {
      try {
        await dispatchPrintJob({
          orderId: order._id,
          io,
          customPrinterName: shop.settings?.preferredPrinter || 'AUTO'
        });
        console.log(`\x1b[32m[AUTO-PRINT ACTIVE] Order ${order.publicOrderId} immediately dispatched to connected printer!\x1b[0m`);
      } catch (autoErr) {
        console.warn(`[Auto-Print Notice]: Could not auto-dispatch order ${order.publicOrderId}: ${autoErr.message}`);
      }
    }

    res.status(201).json({
      success: true,
      order: {
        id: order._id,
        publicOrderId: order.publicOrderId,
        status: order.status,
        totalAmount: order.totalAmount,
        qrToken: rawQrToken,
        pickupPin: pickupPin,
        documentsCount: createdDocs.length,
        createdAt: order.createdAt
      }
    });
  } catch (err) {
    console.error('[Order Creation Error]:', err.message);
    res.status(500).json({ success: false, message: 'Failed to create order: ' + err.message });
  }
});

// Fetch Customer's Orders
router.get('/orders', protect, async (req, res) => {
  try {
    const isGuest = !req.user || req.user._id.toString() === '650000000000000000000000';
    let query = {};
    if (!isGuest) {
      query = { $or: [{ userId: req.user._id }, { userId: '650000000000000000000000' }] };
    } else {
      query = { userId: '650000000000000000000000' };
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const populatedOrders = await Promise.all(orders.map(async (order) => {
      const documents = await Document.find({ orderId: order._id }).lean();
      const settings = await PrintSetting.find({ orderId: order._id }).lean();
      return {
        ...order,
        pickupPin: order.rawPickupPin || '****',
        documents,
        settings
      };
    }));

    res.json({ success: true, orders: populatedOrders });
  } catch (err) {
    console.error('[Customer Orders Error]:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Confirm Order Receipt by Customer
router.post('/confirm-receipt/:id', protect, async (req, res) => {
  try {
    let order = null;
    if (mongoose.Types.ObjectId.isValid(req.params.id)) {
      order = await Order.findById(req.params.id);
    }
    if (!order) {
      order = await Order.findOne({ publicOrderId: req.params.id });
    }
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    order.status = 'COLLECTED';
    order.collectedAt = new Date();
    const retentionMinutes = parseInt(process.env.RETENTION_MINUTES || '60', 10);
    order.expiresAt = new Date(Date.now() + retentionMinutes * 60 * 1000);
    await order.save();

    await AuditLog.create({
      orderId: order._id,
      userId: req.user?._id || order.userId,
      action: 'ORDER_COLLECTED_BY_CUSTOMER',
      metadata: { publicOrderId: order.publicOrderId }
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('order_status_updated', {
        orderId: order._id,
        publicOrderId: order.publicOrderId,
        status: 'COLLECTED'
      });
    }

    res.json({ success: true, message: 'Order confirmed collected by customer', order });
  } catch (err) {
    console.error('[Confirm Receipt Error]:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
