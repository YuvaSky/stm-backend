const Order = require('../models/Order');
const Document = require('../models/Document');
const PrintSetting = require('../models/PrintSetting');
const PrintJob = require('../models/PrintJob');
const Printer = require('../models/Printer');
const AuditLog = require('../models/AuditLog');

async function dispatchPrintJob({ orderId, io, staffId = null, isReprintConfirmed = false, customPrinterName = null }) {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new Error('Order not found');
  }

  // Check duplicate print protection
  if (order.printCount > 0 && !isReprintConfirmed) {
    const error = new Error('⚠️ DUPLICATE PRINT WARNING: This order has already been printed. Confirm reprint?');
    error.status = 409;
    error.requiresReprintConfirmation = true;
    error.printCount = order.printCount;
    throw error;
  }

  const documents = await Document.find({ orderId: order._id, deletedAt: null });
  const settings = await PrintSetting.find({ orderId: order._id });

  if (documents.length === 0) {
    throw new Error('No valid documents found for printing');
  }

  const reqColor = settings.some(s => s.colorMode === 'COLOUR');
  const reqA3 = settings.some(s => s.paperSize === 'A3');

  let targetPrinter = null;
  if (customPrinterName && customPrinterName !== 'AUTO') {
    targetPrinter = await Printer.findOne({ name: customPrinterName, branchId: order.branchId });
    if (!targetPrinter) {
      targetPrinter = await Printer.findOne({ name: customPrinterName });
    }
  }

  if (!targetPrinter) {
    targetPrinter = await Printer.findOne({
      branchId: order.branchId,
      status: 'ONLINE',
      ...(reqColor ? { 'capabilities.color': true } : {}),
      ...(reqA3 ? { 'capabilities.paperSizes': 'A3' } : {})
    });
  }

  if (!targetPrinter) {
    targetPrinter = await Printer.findOne({ branchId: order.branchId, status: 'ONLINE' });
  }

  if (!targetPrinter) {
    targetPrinter = await Printer.create({
      branchId: order.branchId,
      name: (customPrinterName && customPrinterName !== 'AUTO') ? customPrinterName : 'Default Physical Printer',
      type: 'LASER',
      capabilities: { paperSizes: ['A4', 'A3'], color: reqColor, duplex: true },
      status: 'ONLINE'
    });
  }

  const finalPrinterName = (customPrinterName && customPrinterName !== 'AUTO') ? customPrinterName : targetPrinter.name;

  order.status = 'PRINTING';
  order.printCount += 1;
  order.printedToPrinter = finalPrinterName;
  order.printedAt = new Date();
  await order.save();

  const printJob = await PrintJob.create({
    orderId: order._id,
    printerId: targetPrinter._id,
    status: 'PRINTING',
    attemptNumber: order.printCount,
    startedAt: new Date()
  });

  await AuditLog.create({
    orderId: order._id,
    staffId: staffId || order.userId,
    action: order.printCount > 1 ? 'REPRINT_DISPATCHED' : 'PRINT_DISPATCHED',
    metadata: {
      publicOrderId: order.publicOrderId,
      printer: finalPrinterName,
      attempt: order.printCount,
      autoDispatched: !staffId
    }
  });

  console.log(`\x1b[35m[PRINT DISPATCHED] Order ${order.publicOrderId} sent to Printer '${finalPrinterName}' (Attempt #${order.printCount})${!staffId ? ' [AUTO-PRINT TRIGGERED]' : ''}\x1b[0m`);

  if (io) {
    io.emit('agent_print_job', {
      printJobId: printJob._id,
      publicOrderId: order.publicOrderId,
      printerId: targetPrinter._id,
      printerName: finalPrinterName,
      documents: documents.map(d => ({
        id: d._id,
        name: d.originalFileName,
        pages: d.pageCount
      }))
    });

    io.emit('order_status_updated', {
      orderId: order._id,
      publicOrderId: order.publicOrderId,
      status: 'PRINTING',
      printedToPrinter: finalPrinterName,
      printCount: order.printCount
    });
  }

  return { order, printJob, targetPrinter, finalPrinterName };
}

module.exports = { dispatchPrintJob };
