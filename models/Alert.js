const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  alertId: {
    type: String,
    required: true,
    unique: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  userEmail: {
    type: String,
    default: '',
  },
  userName: {
    type: String,
    default: '',
  },
  type: {
    type: String,
    enum: ['Manual SOS', 'Auto-Alert', 'Safe', 'Test'],
    default: 'Manual SOS',
  },
  reason: {
    type: String,
    default: '',
  },
  location: {
    type: String,
    default: '',
  },
  from: {
    type: String,
    default: '–',
  },
  to: {
    type: String,
    default: '–',
  },
  contactsAlerted: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['Active', 'Cancelled', 'Safe', 'Resolved'],
    default: 'Active',
  },
  time: {
    type: String,
    default: '',
  },
  evidence: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Evidence',
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Alert', alertSchema);
