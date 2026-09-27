const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
dotenv.config();

const User = require('./models/User');
const Shop = require('./models/Shop');
const Branch = require('./models/Branch');
const Staff = require('./models/Staff');
const Printer = require('./models/Printer');

const seedDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/secure_print_shop';
    await mongoose.connect(mongoUri);
    console.log('[Seeder]: Connected to MongoDB ->', mongoUri);

    // Clear existing collections if desired
    await User.deleteMany({});
    await Shop.deleteMany({});
    await Branch.deleteMany({});
    await Staff.deleteMany({});
    await Printer.deleteMany({});

    console.log('[Seeder]: Cleared old development records.');

    // Create Default Shop
    const shop = await Shop.create({
      name: 'SuperFast Secure Print & Copy Shop',
      logo: 'https://images.unsplash.com/photo-1562654501-a0ccc0fc3fb1?w=150',
      address: 'Shop No. 12, Main Market, Station Road, Delhi NCR',
      phone: '+91 98765 43210',
      settings: {
        retentionMinutes: 60,
        pricing: {
          A4_BW: 2,
          A4_COLOUR: 10,
          A3_BW: 5,
          A3_COLOUR: 20,
          doubleSidedMultiplier: 1.8
        }
      }
    });

    // Create Default Branch
    const branch = await Branch.create({
      shopId: shop._id,
      name: 'Main Market Branch #1',
      address: 'Shop No. 12, Main Market',
      status: 'ACTIVE'
    });

    const salt = await bcrypt.genSalt(10);
    const defaultPasswordHash = await bcrypt.hash('admin123', salt);
    const customerPasswordHash = await bcrypt.hash('user123', salt);

    // Create Admin User
    const adminUser = await User.create({
      name: 'Rajesh Sharma (Admin)',
      mobile: '9999999999',
      email: 'admin@printshop.com',
      passwordHash: defaultPasswordHash,
      role: 'ADMIN'
    });

    // Create Staff User
    const staffUser = await User.create({
      name: 'Vikram Singh (Shopkeeper Staff)',
      mobile: '8888888888',
      email: 'staff@printshop.com',
      passwordHash: defaultPasswordHash,
      role: 'STAFF'
    });

    // Create Customer User
    const customerUser = await User.create({
      name: 'Amit Patel (Customer)',
      mobile: '9876543210',
      email: 'customer@gmail.com',
      passwordHash: customerPasswordHash,
      role: 'CUSTOMER'
    });

    // Assign Staff to Branch
    await Staff.create({
      userId: staffUser._id,
      shopId: shop._id,
      branchId: branch._id,
      role: 'STAFF',
      status: 'ACTIVE'
    });

    // Create Default Printers
    await Printer.create([
      {
        branchId: branch._id,
        name: 'HP LaserJet Pro M404n (A4 B&W Heavy Duty)',
        type: 'LASER',
        capabilities: { paperSizes: ['A4'], color: false, duplex: true },
        status: 'ONLINE'
      },
      {
        branchId: branch._id,
        name: 'Canon imageRUNNER ADVANCE (A4/A3 Colour Studio)',
        type: 'HEAVY_MULTIFUNCTION',
        capabilities: { paperSizes: ['A4', 'A3'], color: true, duplex: true },
        status: 'ONLINE'
      }
    ]);

    console.log('---------------------------------------------------------');
    console.log('✅ DATABASE SEEDED SUCCESSFULLY!');
    console.log('---------------------------------------------------------');
    console.log('Shop Name:', shop.name);
    console.log('Branch Name:', branch.name);
    console.log('\nDefault Test Accounts:');
    console.log('1) Admin User: Mobile: 9999999999 | Password: admin123');
    console.log('2) Staff User: Mobile: 8888888888 | Password: admin123');
    console.log('3) Customer:   Mobile: 9876543210 | Password: user123');
    console.log('---------------------------------------------------------');

    process.exit(0);
  } catch (err) {
    console.error('[Seeder Error]:', err.message);
    process.exit(1);
  }
};

seedDB();
