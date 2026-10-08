const mongoose = require('mongoose');

const evidenceSchema = new mongoose.Schema({
  alertId: {
    type: String,
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  mediaType: {
    type: String,
    enum: ['photo', 'video', 'audio'],
    default: 'photo',
  },
  filename: {
    type: String,
    required: true,
  },
  originalName: {
    type: String,
    default: '',
  },
  filePath: {
    type: String,
    required: true,
  },
  fileUrl: {
    type: String,
    required: true,
  },
  mimeType: {
    type: String,
    default: '',
  },
  size: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Evidence', evidenceSchema);
