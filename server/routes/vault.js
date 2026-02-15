const express = require('express');

const authMiddleware = require('../middleware/auth');
const nomineeAuth = require('../middleware/nomineeAuth');
const vaultService = require('../services/vaultService');
const { isS3Enabled, getBucketNameForUser } = require('../utils/s3');

const router = express.Router();

function normalizeNominees(nominees) {
  return nominees.map((nominee) => String(nominee).trim().toLowerCase()).filter(Boolean);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function handleVaultUpsert(req, res) {
  try {
    const {
      nominees,
      triggerTime = null,
      threshold = 3,
      vaultName = 'Untitled Vault',
      checkInIntervalDays = 14,
      gracePeriodDays = 30,
      maxMissedCheckIns = 2,
    } = req.body;

    if (!Array.isArray(nominees) || nominees.length !== 3) {
      return res.status(400).json({ error: 'Exactly 3 nominees are required' });
    }

    const cleanedNominees = normalizeNominees(nominees);
    if (cleanedNominees.length !== nominees.length) {
      return res.status(400).json({ error: 'Nominee values cannot be empty' });
    }

    if (new Set(cleanedNominees).size !== cleanedNominees.length) {
      return res.status(400).json({ error: 'Nominees must be unique' });
    }

    const thresholdValue = Number(threshold);
    if (thresholdValue !== 3) {
      return res.status(400).json({ error: 'DEAD SERIOUS requires 3-of-3 threshold' });
    }

    const interval = parsePositiveInt(checkInIntervalDays, 14);
    const grace = parsePositiveInt(gracePeriodDays, 30);
    const missedLimit = parsePositiveInt(maxMissedCheckIns, 2);

    if (!interval || !grace || !missedLimit) {
      return res
        .status(400)
        .json({ error: 'checkInIntervalDays, gracePeriodDays, maxMissedCheckIns must be positive integers' });
    }

    const ownerId = req.user?.userId || String(req.body.ownerId || '').trim();
    if (!ownerId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const vault = await vaultService.upsertVaultForOwner({
      ownerId,
      vaultName: String(vaultName).trim() || 'Untitled Vault',
      nominees: cleanedNominees,
      threshold: thresholdValue,
      triggerTime,
      checkInIntervalDays: interval,
      gracePeriodDays: grace,
      maxMissedCheckIns: missedLimit,
    });

    return res.json({ success: true, vault });
  } catch (err) {
    if (err.message.includes('S3')) {
      return res.status(400).json({ error: err.message });
    }

    console.error(err);
    return res.status(500).json({ error: err.message || 'Vault creation failed' });
  }
}

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const vault = await vaultService.getVaultByOwner(req.user.userId);
    return res.json({ success: true, vault });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load vault' });
  }
});

router.get('/me/storage-target', authMiddleware, async (req, res) => {
  try {
    const ownerId = req.user?.userId;
    const s3Enabled = isS3Enabled();
    const bucketName = getBucketNameForUser(ownerId);

    return res.json({
      success: true,
      storage: {
        ownerId,
        provider: s3Enabled ? 's3' : 'local',
        s3Enabled,
        bucketName,
        endpoint: process.env.S3_ENDPOINT_URL || null,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
        region: process.env.AWS_REGION || null,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to compute storage target' });
  }
});

router.post('/me', authMiddleware, async (req, res) => {
  return handleVaultUpsert(req, res);
});

// Legacy-compatible create endpoint used by older frontends.
router.post('/create', authMiddleware, async (req, res) => {
  return handleVaultUpsert(req, res);
});

router.post('/me/check-in', authMiddleware, async (req, res) => {
  try {
    const vault = await vaultService.checkInByOwner(req.user.userId);
    return res.json({ success: true, vault });
  } catch (err) {
    if (err.message === 'Vault not found') {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Check-in is disabled')) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Check-in failed' });
  }
});

router.post('/me/request-unlock', authMiddleware, async (req, res) => {
  try {
    const { reason = '' } = req.body;
    const vault = await vaultService.requestUnlockByOwner(req.user.userId, String(reason));
    return res.json({ success: true, vault });
  } catch (err) {
    if (err.message === 'Vault not found') {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('MASTER_SHARE') || err.message.includes('Nominee') || err.message.includes('share')) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: err.message || 'Unlock request failed' });
  }
});

router.post('/me/shares', authMiddleware, async (req, res) => {
  try {
    const { shares, threshold = 3, totalShares = 3 } = req.body;
    const result = await vaultService.storeEncryptedSharesForOwner(req.user.userId, {
      shares,
      threshold,
      totalShares,
    });
    return res.json({ success: true, result });
  } catch (err) {
    if (err.message === 'Vault not found') {
      return res.status(404).json({ error: err.message });
    }

    if (
      err.message.includes('shares') ||
      err.message.includes('DEADLOCK') ||
      err.message.includes('DEAD SERIOUS') ||
      err.message.includes('MASTER_SHARE')
    ) {
      return res.status(400).json({ error: err.message });
    }

    console.error(err);
    return res.status(500).json({ error: 'Failed to store shares' });
  }
});

router.post('/me/files', authMiddleware, async (req, res) => {
  try {
    const { fileName, contentType, cipherTextBase64 } = req.body;
    const file = await vaultService.saveEncryptedFileForOwner(req.user.userId, {
      fileName,
      contentType,
      cipherTextBase64,
    });

    return res.json({ success: true, file });
  } catch (err) {
    if (err.message === 'Vault not found') {
      return res.status(404).json({ error: err.message });
    }

    if (err.message.includes('cipherTextBase64') || err.message.includes('S3')) {
      return res.status(400).json({ error: err.message });
    }

    console.error(err);
    return res.status(500).json({ error: err.message || 'Failed to store encrypted file' });
  }
});

router.get('/me/files', authMiddleware, async (req, res) => {
  try {
    const result = await vaultService.listFilesForOwner(req.user.userId);
    return res.json({ success: true, ...result });
  } catch (err) {
    if (err.message === 'Vault not found') {
      return res.status(404).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to list files' });
  }
});

router.get('/me/files/:fileId/download', authMiddleware, async (req, res) => {
  try {
    const result = await vaultService.downloadFileForOwner(req.user.userId, req.params.fileId);
    res.setHeader('Content-Type', result.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return res.send(result.body);
  } catch (err) {
    if (err.message === 'Vault not found' || err.message === 'File not found') {
      return res.status(404).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to download file' });
  }
});

router.put('/me/files/:fileId', authMiddleware, async (req, res) => {
  try {
    const { fileName, contentType, cipherTextBase64 } = req.body;
    const file = await vaultService.updateEncryptedFileForOwner(req.user.userId, req.params.fileId, {
      fileName,
      contentType,
      cipherTextBase64,
    });
    return res.json({ success: true, file });
  } catch (err) {
    if (err.message === 'Vault not found' || err.message === 'File not found') {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('cipherTextBase64')) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to update file' });
  }
});

router.delete('/me/files/:fileId', authMiddleware, async (req, res) => {
  try {
    const result = await vaultService.deleteFileForOwner(req.user.userId, req.params.fileId);
    return res.json({ success: true, result });
  } catch (err) {
    if (err.message === 'Vault not found' || err.message === 'File not found') {
      return res.status(404).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete file' });
  }
});

router.get('/nominee/status', nomineeAuth, async (req, res) => {
  try {
    const status = await vaultService.getNomineeStatus(req.nominee.vaultId);
    return res.json({ success: true, status });
  } catch (err) {
    if (err.message === 'Vault not found') {
      return res.status(404).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to load nominee status' });
  }
});

router.post('/nominee/submit-share', nomineeAuth, async (req, res) => {
  try {
    const share = String(req.body.share || '').trim();
    if (!share) {
      return res.status(400).json({ error: 'share is required' });
    }

    const result = await vaultService.submitNomineeShare(
      req.nominee.vaultId,
      req.nominee.nomineeEmail,
      share
    );
    return res.json({ success: true, result });
  } catch (err) {
    if (err.message === 'Vault not found') {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Nominee') || err.message.includes('share') || err.message.includes('Invalid')) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to submit nominee share' });
  }
});

router.get('/nominee/files', nomineeAuth, async (req, res) => {
  try {
    const share = String(req.query.share || '').trim();
    if (!share) {
      return res.status(400).json({ error: 'share is required' });
    }

    const result = await vaultService.listFilesForNominee(
      req.nominee.vaultId,
      req.nominee.nomineeEmail,
      share
    );
    return res.json({ success: true, ...result });
  } catch (err) {
    if (err.message === 'Vault not found') {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Nominee') || err.message.includes('share') || err.message.includes('Invalid')) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to list nominee files' });
  }
});

router.get('/nominee/files/:fileId/download', nomineeAuth, async (req, res) => {
  try {
    const share = String(req.query.share || '').trim();
    if (!share) {
      return res.status(400).json({ error: 'share is required' });
    }

    const result = await vaultService.downloadFileForNominee(
      req.nominee.vaultId,
      req.params.fileId,
      req.nominee.nomineeEmail,
      share
    );
    res.setHeader('Content-Type', result.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename=\"${result.fileName}\"`);
    return res.send(result.body);
  } catch (err) {
    if (err.message === 'Vault not found' || err.message === 'File not found') {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Nominee') || err.message.includes('share') || err.message.includes('Invalid')) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to download nominee file' });
  }
});

router.get('/:vaultId/dashboard', async (req, res) => {
  try {
    const result = await vaultService.getVaultDashboard(req.params.vaultId);
    return res.json({ success: true, vault: result });
  } catch (err) {
    if (err.message === 'Vault not found') {
      return res.status(404).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

router.get('/:vaultId/approvals', async (req, res) => {
  try {
    const approvals = await vaultService.getApprovals(req.params.vaultId);
    return res.json({ success: true, approvals });
  } catch (err) {
    if (err.message === 'Vault not found') {
      return res.status(404).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to load approvals' });
  }
});

router.get('/:vaultId/checkpoint', async (req, res) => {
  try {
    const checkpoint = await vaultService.getNomineeCheckpoint(req.params.vaultId);
    return res.json({ success: true, checkpoint });
  } catch (err) {
    if (err.message === 'Vault not found') {
      return res.status(404).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to load checkpoint' });
  }
});

router.get('/:vaultId/files', async (req, res) => {
  try {
    const nominee = String(req.query.nominee || '').trim().toLowerCase();
    const share = String(req.query.share || '').trim();
    if (!nominee || !share) {
      return res.status(400).json({ error: 'nominee and share are required' });
    }

    const result = await vaultService.listFilesForNominee(req.params.vaultId, nominee, share);
    return res.json({ success: true, ...result });
  } catch (err) {
    if (err.message === 'Vault not found') {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Nominee') || err.message.includes('share') || err.message.includes('Invalid')) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to list nominee files' });
  }
});

router.get('/:vaultId/files/:fileId/download', async (req, res) => {
  try {
    const nominee = String(req.query.nominee || '').trim().toLowerCase();
    const share = String(req.query.share || '').trim();
    if (!nominee || !share) {
      return res.status(400).json({ error: 'nominee and share are required' });
    }

    const result = await vaultService.downloadFileForNominee(req.params.vaultId, req.params.fileId, nominee, share);
    res.setHeader('Content-Type', result.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return res.send(result.body);
  } catch (err) {
    if (err.message === 'Vault not found' || err.message === 'File not found') {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Nominee') || err.message.includes('share') || err.message.includes('Invalid')) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to download nominee file' });
  }
});

router.post('/:vaultId/submit-share', async (req, res) => {
  try {
    const nominee = String(req.body.nominee || '').trim().toLowerCase();
    const share = String(req.body.share || '').trim();

    if (!nominee || !share) {
      return res.status(400).json({ error: 'nominee and share are required' });
    }

    const result = await vaultService.submitNomineeShare(req.params.vaultId, nominee, share);
    return res.json({ success: true, result });
  } catch (err) {
    if (err.message === 'Vault not found') {
      return res.status(404).json({ error: err.message });
    }

    if (err.message.includes('Nominee') || err.message.includes('share') || err.message.includes('Invalid')) {
      return res.status(400).json({ error: err.message });
    }

    console.error(err);
    return res.status(500).json({ error: 'Failed to submit share' });
  }
});

router.post('/evaluate-deadman', authMiddleware, async (req, res) => {
  try {
    const result = await vaultService.evaluateDeadManSwitches();
    return res.json({ success: true, result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to evaluate dead man switches' });
  }
});

module.exports = router;
