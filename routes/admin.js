const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const Printer = require('../models/Printer');
const Shop = require('../models/Shop');
const Branch = require('../models/Branch');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const Staff = require('../models/Staff');

router.use(protect, authorize('ADMIN', 'MANAGER'));

// Get all Staff/Shopkeepers
router.get('/staff', async (req, res) => {
  try {
    const staffMembers = await Staff.find()
      .populate('userId', 'name mobile email role createdAt')
      .populate('branchId', 'name code')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, staff: staffMembers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Create New Shopkeeper (Staff Member)
router.post('/staff', async (req, res) => {
  try {
    const { name, mobile, password, role } = req.body;

    if (!name || !mobile || !password) {
      return res.status(400).json({ success: false, message: 'Name, mobile and password are required' });
    }

    const existingUser = await User.findOne({ mobile });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'A user or shopkeeper with this mobile number already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const staffRole = role === 'MANAGER' ? 'MANAGER' : 'STAFF';

    const newUser = await User.create({
      name,
      mobile,
      passwordHash,
      role: staffRole
    });

    let shop = await Shop.findOne();
    let branch = await Branch.findOne();

    if (!shop) {
      shop = await Shop.create({ name: 'Main Shop', address: 'Main Street', phone: mobile });
    }
    if (!branch) {
      branch = await Branch.create({ shopId: shop._id, name: 'Main Branch', code: 'BR-01' });
    }

    const newStaff = await Staff.create({
      userId: newUser._id,
      shopId: shop._id,
      branchId: branch._id,
      role: staffRole,
      status: 'ACTIVE'
    });

    await AuditLog.create({
      staffId: req.user._id,
      action: 'NEW_SHOPKEEPER_CREATED',
      metadata: { newStaffName: name, mobile, role: staffRole }
    });

    res.status(201).json({
      success: true,
      message: `Shopkeeper '${name}' created successfully`,
      staff: {
        _id: newStaff._id,
        role: staffRole,
        status: newStaff.status,
        userId: {
          _id: newUser._id,
          name: newUser.name,
          mobile: newUser.mobile,
          role: newUser.role,
          createdAt: newUser.createdAt
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Toggle Staff Status (ACTIVE/INACTIVE)
router.patch('/staff/:id/status', async (req, res) => {
  try {
    const staff = await Staff.findById(req.params.id);
    if (!staff) {
      return res.status(404).json({ success: false, message: 'Staff member not found' });
    }

    staff.status = staff.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    await staff.save();

    res.json({ success: true, message: `Staff status updated to ${staff.status}`, status: staff.status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get all Printers
router.get('/printers', async (req, res) => {
  try {
    const printers = await Printer.find().populate('branchId', 'name').lean();
    res.json({ success: true, printers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Create Printer
router.post('/printers', async (req, res) => {
  try {
    const { name, type, capabilities, branchId } = req.body;
    let targetBranchId = branchId;
    if (!targetBranchId) {
      const branch = await Branch.findOne();
      targetBranchId = branch ? branch._id : null;
    }

    const printer = await Printer.create({
      branchId: targetBranchId,
      name,
      type: type || 'LASER',
      capabilities: capabilities || { paperSizes: ['A4'], color: false, duplex: true },
      status: 'ONLINE'
    });

    res.status(201).json({ success: true, printer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get Pricing & Retention Settings
router.get('/settings', async (req, res) => {
  try {
    const shop = await Shop.findOne();
    res.json({ success: true, shop });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Pricing & Retention Settings
router.put('/settings', async (req, res) => {
  try {
    const { pricing, retentionMinutes } = req.body;
    let shop = await Shop.findOne();

    if (!shop) {
      shop = new Shop({
        name: 'Main Stationery & Print Shop',
        address: '123 Station Road',
        phone: '9876543210'
      });
    }

    if (pricing) shop.settings.pricing = pricing;
    if (retentionMinutes) shop.settings.retentionMinutes = retentionMinutes;

    await shop.save();

    res.json({ success: true, shop });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Audit Logs View
router.get('/audit-logs', async (req, res) => {
  try {
    const logs = await AuditLog.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('userId', 'name mobile')
      .populate('staffId', 'name mobile')
      .populate('orderId', 'publicOrderId')
      .lean();

    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
