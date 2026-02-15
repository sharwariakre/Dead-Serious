const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');

const { query } = require('../db/postgres');
const { getJwtSecret } = require('./authService');
const { encryptText, decryptText, getServerEncryptionKey } = require('../utils/crypto');
const { notifyNominee, sendNomineeVerificationCode } = require('../utils/notifications');
const {
  isS3Enabled,
  getBucketNameForUser,
  ensureBucketExists,
  uploadObject,
  downloadObject,
  deleteObject,
} = require('../utils/s3');

const STATUS = {
  ACTIVE: 'active',
  MISSED_CHECKIN: 'missed_checkin',
  GRACE_PERIOD: 'grace_period',
  NOMINEES_NOTIFIED: 'nominees_notified',
  UNLOCKED: 'unlocked',
};

function addDays(isoDate, days) {
  const base = new Date(isoDate);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString();
}

function normalizeNominees(nominees) {
  return nominees.map((email, index) => ({
    id: String(index + 1),
    email,
    status: 'pending',
    approvedAt: null,
    notifiedAt: null,
    shareReleasedAt: null,
    shareSubmittedAt: null,
  }));
}

function buildDeadMan(nowIso, checkInIntervalDays) {
  return {
    checkInIntervalDays,
    missedCount: 0,
    lastCheckInAt: nowIso,
    nextCheckInDueAt: addDays(nowIso, checkInIntervalDays),
    graceStartedAt: null,
    graceEndsAt: null,
    nomineesNotifiedAt: null,
  };
}

function formatVaultSummary(vault) {
  const approvedNominees = (vault.nominees || []).filter((nominee) => nominee.status === 'approved');
  const pendingNominees = (vault.nominees || []).filter((nominee) => nominee.status === 'pending');

  return {
    vaultId: vault.vaultId,
    ownerId: vault.ownerId,
    vaultName: vault.vaultName,
    status: vault.status,
    threshold: vault.threshold,
    triggerTime: vault.triggerTime,
    createdAt: vault.createdAt,
    updatedAt: vault.updatedAt,
    lastCheckIn: vault.lastCheckIn,
    checkInCount: (vault.checkIns || []).length,
    checkInPolicy: vault.checkInPolicy,
    deadMan: vault.deadMan,
    unlockRequest: vault.unlockRequest,
    storage: vault.storage,
    sharesStored: vault.shares?.fragments?.length || 0,
    approvals: {
      approved: approvedNominees.length,
      required: vault.threshold,
      pending: pendingNominees.map((nominee) => nominee.email),
      nominees: vault.nominees || [],
    },
    files: vault.files || [],
  };
}

function hydrateVaultFromRow(row) {
  const metadata = { ...(row?.metadata || {}) };
  if (!row) {
    return metadata;
  }

  metadata.lastCheckIn = row.last_check_in || metadata.lastCheckIn || null;

  if (!metadata.deadMan) {
    metadata.deadMan = {};
  }
  metadata.deadMan.nextCheckInDueAt =
    row.next_check_in_due_at || metadata.deadMan.nextCheckInDueAt || null;

  const sqlCheckInCount = Number(row.check_in_count || 0);
  if (!Array.isArray(metadata.checkIns)) {
    metadata.checkIns = [];
  }
  if (sqlCheckInCount > metadata.checkIns.length) {
    metadata.checkIns = Array.from({ length: sqlCheckInCount }, (_, index) => metadata.checkIns[index] || null);
  }

  return metadata;
}

async function getVaultRowByOwner(ownerId) {
  const result = await query(
    `
      SELECT
        vault_id,
        owner_id,
        metadata,
        last_check_in,
        next_check_in_due_at,
        check_in_count
      FROM vaults
      WHERE owner_id = $1
      LIMIT 1
    `,
    [ownerId]
  );
  return result.rows[0] || null;
}

async function getVaultRowById(vaultId) {
  const result = await query(
    `
      SELECT
        vault_id,
        owner_id,
        metadata,
        last_check_in,
        next_check_in_due_at,
        check_in_count
      FROM vaults
      WHERE vault_id = $1
      LIMIT 1
    `,
    [vaultId]
  );
  return result.rows[0] || null;
}

async function requireVaultByOwner(ownerId) {
  const row = await getVaultRowByOwner(ownerId);
  if (!row) {
    throw new Error('Vault not found');
  }
  return hydrateVaultFromRow(row);
}

async function requireVaultById(vaultId) {
  const row = await getVaultRowById(vaultId);
  if (!row) {
    throw new Error('Vault not found');
  }
  return hydrateVaultFromRow(row);
}

async function persistVault(vault) {
  await query(
    `
      UPDATE vaults
      SET
        metadata = $2,
        last_check_in = $3,
        next_check_in_due_at = $4,
        check_in_count = $5,
        updated_at = NOW()
      WHERE vault_id = $1
    `,
    [
      vault.vaultId,
      vault,
      vault.lastCheckIn || null,
      vault.deadMan?.nextCheckInDueAt || null,
      Array.isArray(vault.checkIns) ? vault.checkIns.length : 0,
    ]
  );
}

async function notifyNomineesForVault(vault, nowIso) {
  let key = null;
  try {
    key = getServerEncryptionKey();
  } catch {
    key = null;
  }

  const updatedNominees = [];
  for (const nominee of vault.nominees || []) {
    const shareRecord = (vault.shares?.fragments || []).find((item) => item.shareId === nominee.id);
    let nomineeShare = '';
    if (shareRecord && key) {
      try {
        nomineeShare = decryptText(shareRecord.encryptedShare, key);
      } catch {
        nomineeShare = '';
      }
    }

    if (!nominee.notifiedAt) {
      await notifyNominee({
        vaultId: vault.vaultId,
        vaultName: vault.vaultName,
        nomineeEmail: nominee.email,
        ownerId: vault.ownerId,
        nomineeShare,
      });
    }

    updatedNominees.push({
      ...nominee,
      notifiedAt: nominee.notifiedAt || nowIso,
      status: nominee.status === 'approved' ? nominee.status : 'pending',
    });
  }

  vault.nominees = updatedNominees;
}

async function deleteFileForOwner(ownerId, fileId) {
  const vault = await requireVaultByOwner(ownerId);
  const fileRecord = requireFileRecord(vault, fileId);

  await deleteObject({
    bucketName: vault.storage.bucketName,
    key: fileRecord.storageKey,
  });

  vault.files = (vault.files || []).filter((file) => file.id !== fileId);
  vault.updatedAt = new Date().toISOString();
  await persistVault(vault);

  return { deleted: true, fileId };
}

function buildVaultMetadata({
  vaultId,
  ownerId,
  vaultName,
  nominees,
  threshold,
  triggerTime,
  checkInIntervalDays,
  gracePeriodDays,
  maxMissedCheckIns,
  storageProvider,
  bucketName,
  now,
}) {
  return {
    vaultId,
    ownerId,
    vaultName,
    nominees: normalizeNominees(nominees),
    threshold,
    triggerTime,
    status: STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
    checkInPolicy: {
      intervalDays: checkInIntervalDays,
      gracePeriodDays,
      maxMissedCheckIns,
    },
    deadMan: buildDeadMan(now, checkInIntervalDays),
    checkIns: [],
    lastCheckIn: now,
    unlockRequest: null,
    shareCheckpoint: {
      submittedByNominee: {},
      submittedCount: 0,
      completedAt: null,
    },
    files: [],
    shares: {
      threshold,
      totalShares: nominees.length,
      fragments: [],
      updatedAt: null,
    },
    storage: {
      provider: storageProvider,
      bucketName,
      rootPrefix: `vaults/${vaultId}`,
    },
  };
}

async function upsertVaultForOwner({
  ownerId,
  vaultName,
  nominees,
  threshold,
  triggerTime,
  checkInIntervalDays,
  gracePeriodDays,
  maxMissedCheckIns,
}) {
  const row = await getVaultRowByOwner(ownerId);
  const now = new Date().toISOString();
  const s3Enabled = isS3Enabled();
  const storageProvider = s3Enabled ? 's3' : 'local';
  const bucketName = s3Enabled ? getBucketNameForUser(ownerId) : null;

  if (s3Enabled) {
    await ensureBucketExists(bucketName);
  }

  if (!row) {
    const vaultId = randomUUID();
    const metadata = buildVaultMetadata({
      vaultId,
      ownerId,
      vaultName,
      nominees,
      threshold,
      triggerTime,
      checkInIntervalDays,
      gracePeriodDays,
      maxMissedCheckIns,
      storageProvider,
      bucketName,
      now,
    });

    await query(
      `
        INSERT INTO vaults (
          vault_id,
          owner_id,
          metadata,
          created_at,
          updated_at,
          last_check_in,
          next_check_in_due_at,
          check_in_count
        )
        VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
      `,
      [
        vaultId,
        ownerId,
        metadata,
        now,
        metadata.lastCheckIn || null,
        metadata.deadMan?.nextCheckInDueAt || null,
        Array.isArray(metadata.checkIns) ? metadata.checkIns.length : 0,
      ]
    );

    return formatVaultSummary(metadata);
  }

  const existing = row.metadata;
  const updated = {
    ...existing,
    vaultName,
    triggerTime,
    threshold,
    nominees: normalizeNominees(nominees),
    checkInPolicy: {
      intervalDays: checkInIntervalDays,
      gracePeriodDays,
      maxMissedCheckIns,
    },
    storage: {
      ...existing.storage,
      provider: storageProvider,
      bucketName,
      rootPrefix: existing.storage?.rootPrefix || `vaults/${existing.vaultId}`,
    },
    status: STATUS.ACTIVE,
    unlockRequest: null,
    shareCheckpoint: {
      submittedByNominee: {},
      submittedCount: 0,
      completedAt: null,
    },
    deadMan: buildDeadMan(now, checkInIntervalDays),
    lastCheckIn: now,
    updatedAt: now,
  };

  await persistVault(updated);
  return formatVaultSummary(updated);
}

async function getVaultByOwner(ownerId) {
  const row = await getVaultRowByOwner(ownerId);
  if (!row) {
    return null;
  }
  return formatVaultSummary(hydrateVaultFromRow(row));
}

async function getVaultDashboard(vaultId) {
  const vault = await requireVaultById(vaultId);
  return formatVaultSummary(vault);
}

async function checkInByOwner(ownerId) {
  const vault = await requireVaultByOwner(ownerId);
  const now = new Date().toISOString();
  if (vault.status === STATUS.NOMINEES_NOTIFIED || vault.status === STATUS.UNLOCKED) {
    throw new Error('Check-in is disabled after nominee notification has started');
  }

  vault.lastCheckIn = now;
  vault.checkIns = [...(vault.checkIns || []), now];
  vault.status = STATUS.ACTIVE;
  vault.unlockRequest = null;
  vault.shareCheckpoint = {
    submittedByNominee: {},
    submittedCount: 0,
    completedAt: null,
  };
  vault.deadMan = buildDeadMan(now, vault.checkInPolicy.intervalDays);
  vault.nominees = (vault.nominees || []).map((nominee) => ({
    ...nominee,
    status: 'pending',
    approvedAt: null,
    shareSubmittedAt: null,
  }));
  vault.updatedAt = now;

  await persistVault(vault);
  return formatVaultSummary(vault);
}

async function requestUnlockByOwner(ownerId, reason = '') {
  const vault = await requireVaultByOwner(ownerId);
  const now = new Date().toISOString();

  vault.status = STATUS.NOMINEES_NOTIFIED;
  vault.unlockRequest = {
    requestedAt: now,
    reason,
    approvalsRequired: vault.threshold,
    approvedCount: 0,
    completedAt: null,
  };
  vault.nominees = (vault.nominees || []).map((nominee) => ({
    ...nominee,
    status: 'pending',
    approvedAt: null,
    notifiedAt: nominee.notifiedAt || null,
  }));
  vault.deadMan.nomineesNotifiedAt = vault.deadMan.nomineesNotifiedAt || now;
  vault.updatedAt = now;

  await notifyNomineesForVault(vault, now);
  await persistVault(vault);
  return formatVaultSummary(vault);
}

async function getApprovals(vaultId) {
  const vault = await requireVaultById(vaultId);

  return {
    vaultId: vault.vaultId,
    vaultName: vault.vaultName,
    status: vault.status,
    threshold: vault.threshold,
    unlockRequest: vault.unlockRequest,
    nominees: vault.nominees || [],
    checkpoint: vault.shareCheckpoint || {
      submittedByNominee: {},
      submittedCount: 0,
      completedAt: null,
    },
  };
}

async function storeEncryptedSharesForOwner(ownerId, { shares, threshold, totalShares }) {
  const vault = await requireVaultByOwner(ownerId);

  if (!Array.isArray(shares) || shares.length !== 3) {
    throw new Error('Exactly 3 encrypted shares are required');
  }

  if (Number(threshold) !== 3 || Number(totalShares) !== 3) {
    throw new Error('DEAD SERIOUS requires 3-of-3 secret sharing');
  }

  const key = getServerEncryptionKey();
  const now = new Date().toISOString();

  const fragments = shares.map((share, index) => {
    if (!share || typeof share !== 'string') {
      throw new Error('Each share must be a base64 string');
    }

    return {
      shareId: String(index + 1),
      encryptedShare: encryptText(share, key),
      storedAt: now,
    };
  });

  vault.shares = {
    threshold: 3,
    totalShares: 3,
    fragments,
    updatedAt: now,
  };
  vault.updatedAt = now;

  await persistVault(vault);

  return { vaultId: vault.vaultId, sharesStored: fragments.length, updatedAt: now };
}

async function saveEncryptedFileForOwner(ownerId, { fileName, contentType, cipherTextBase64 }) {
  if (!isS3Enabled()) {
    throw new Error('S3 must be enabled for file uploads');
  }

  const vault = await requireVaultByOwner(ownerId);
  const now = new Date().toISOString();
  const fileId = randomUUID();

  if (!cipherTextBase64) {
    throw new Error('cipherTextBase64 is required');
  }

  const keyName = `${vault.storage.rootPrefix}/files/${fileId}-${String(fileName || 'payload.bin').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const buffer = Buffer.from(cipherTextBase64, 'base64');

  await ensureBucketExists(vault.storage.bucketName);
  await uploadObject({
    bucketName: vault.storage.bucketName,
    key: keyName,
    body: buffer,
    contentType,
  });

  const fileRecord = {
    id: fileId,
    fileName: fileName || 'payload.bin',
    contentType: contentType || 'application/octet-stream',
    storageKey: keyName,
    storedAt: now,
  };

  vault.files = [...(vault.files || []), fileRecord];
  vault.updatedAt = now;

  await persistVault(vault);

  return fileRecord;
}

function requireNomineeAccess(vault, nomineeEmail, share, options = {}) {
  const { requireUnlocked = false } = options;

  if (vault.status !== STATUS.NOMINEES_NOTIFIED && vault.status !== STATUS.UNLOCKED) {
    throw new Error('Nominee access unavailable before notification');
  }

  const normalizedNominee = String(nomineeEmail || '').trim().toLowerCase();
  const nominee = (vault.nominees || []).find((item) => item.email === normalizedNominee);
  if (!nominee) {
    throw new Error('Nominee not found');
  }

  const shareRecord = (vault.shares?.fragments || []).find((item) => item.shareId === nominee.id);
  if (!shareRecord) {
    throw new Error('Share not found for nominee');
  }

  const expectedShare = decryptText(shareRecord.encryptedShare, getServerEncryptionKey());
  if (expectedShare !== String(share || '').trim()) {
    throw new Error('Invalid share for nominee');
  }

  if (requireUnlocked) {
    const submittedCount = Object.keys(vault.shareCheckpoint?.submittedByNominee || {}).length;
    if (submittedCount < 3 || vault.status !== STATUS.UNLOCKED) {
      throw new Error('Vault is locked until all 3 nominee shares are submitted');
    }
  }

  return nominee;
}

function requireFileRecord(vault, fileId) {
  const fileRecord = (vault.files || []).find((file) => file.id === fileId);
  if (!fileRecord) {
    throw new Error('File not found');
  }
  return fileRecord;
}

async function listFilesForOwner(ownerId) {
  const vault = await requireVaultByOwner(ownerId);
  return {
    vaultId: vault.vaultId,
    bucketName: vault.storage?.bucketName,
    files: vault.files || [],
  };
}

async function downloadFileForOwner(ownerId, fileId) {
  const vault = await requireVaultByOwner(ownerId);
  const fileRecord = requireFileRecord(vault, fileId);
  const object = await downloadObject({
    bucketName: vault.storage.bucketName,
    key: fileRecord.storageKey,
  });

  return {
    fileName: fileRecord.fileName,
    contentType: fileRecord.contentType || object.contentType,
    body: object.body,
  };
}

async function updateEncryptedFileForOwner(ownerId, fileId, { fileName, contentType, cipherTextBase64 }) {
  if (!cipherTextBase64) {
    throw new Error('cipherTextBase64 is required');
  }

  const vault = await requireVaultByOwner(ownerId);
  const fileRecord = requireFileRecord(vault, fileId);
  const now = new Date().toISOString();

  await uploadObject({
    bucketName: vault.storage.bucketName,
    key: fileRecord.storageKey,
    body: Buffer.from(cipherTextBase64, 'base64'),
    contentType: contentType || fileRecord.contentType,
  });

  const updatedFile = {
    ...fileRecord,
    fileName: fileName || fileRecord.fileName,
    contentType: contentType || fileRecord.contentType,
    updatedAt: now,
  };

  vault.files = (vault.files || []).map((file) => (file.id === fileId ? updatedFile : file));
  vault.updatedAt = now;
  await persistVault(vault);

  return updatedFile;
}

async function deleteFileForOwner(ownerId, fileId) {
  const vault = await requireVaultByOwner(ownerId);
  const fileRecord = requireFileRecord(vault, fileId);

  await deleteObject({
    bucketName: vault.storage.bucketName,
    key: fileRecord.storageKey,
  });

  vault.files = (vault.files || []).filter((file) => file.id !== fileId);
  vault.updatedAt = new Date().toISOString();
  await persistVault(vault);

  return { deleted: true, fileId };
}

async function submitNomineeShare(vaultId, nomineeEmail, share) {
  const vault = await requireVaultById(vaultId);

  if ((vault.shares?.fragments || []).length !== 3) {
    throw new Error('Encrypted shares are not fully stored');
  }

  const nominee = requireNomineeAccess(vault, nomineeEmail, share);
  const normalizedNominee = String(nomineeEmail || '').trim().toLowerCase();

  const now = new Date().toISOString();
  const submittedByNominee = {
    ...(vault.shareCheckpoint?.submittedByNominee || {}),
    [normalizedNominee]: {
      submittedAt: now,
      shareId: nominee.id,
    },
  };

  const submittedCount = Object.keys(submittedByNominee).length;
  const completedAt = submittedCount === 3 ? now : null;

  vault.shareCheckpoint = {
    submittedByNominee,
    submittedCount,
    completedAt,
  };

  nominee.shareSubmittedAt = now;
  nominee.status = 'approved';
  nominee.approvedAt = nominee.approvedAt || now;

  if (submittedCount === 3) {
    vault.status = STATUS.UNLOCKED;
    if (!vault.unlockRequest) {
      vault.unlockRequest = {
        requestedAt: now,
        reason: 'Nominee share checkpoint completed',
        approvalsRequired: 3,
        approvedCount: 3,
        completedAt: now,
      };
    } else {
      vault.unlockRequest.approvedCount = 3;
      vault.unlockRequest.completedAt = now;
    }
  }

  vault.updatedAt = now;

  await persistVault(vault);

  return {
    vaultId: vault.vaultId,
    submittedCount,
    required: 3,
    canAccess: submittedCount === 3,
    status: vault.status,
  };
}

async function getNomineeCheckpoint(vaultId) {
  const vault = await requireVaultById(vaultId);
  const submittedCount = Object.keys(vault.shareCheckpoint?.submittedByNominee || {}).length;

  return {
    vaultId: vault.vaultId,
    vaultName: vault.vaultName,
    status: vault.status,
    submittedCount,
    required: 3,
    canAccess: submittedCount === 3 && vault.status === STATUS.UNLOCKED,
  };
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function buildNomineeStatus(vault) {
  const checkpoint = vault.shareCheckpoint || {
    submittedByNominee: {},
    submittedCount: 0,
    completedAt: null,
  };

  return {
    vaultId: vault.vaultId,
    vaultName: vault.vaultName,
    status: vault.status,
    submittedCount: Object.keys(checkpoint.submittedByNominee || {}).length,
    required: 3,
    canAccess:
      Object.keys(checkpoint.submittedByNominee || {}).length === 3 && vault.status === STATUS.UNLOCKED,
    nominees: (vault.nominees || []).map((nominee) => ({
      id: nominee.id,
      email: nominee.email,
      submitted: Boolean(nominee.shareSubmittedAt),
      submittedAt: nominee.shareSubmittedAt || null,
    })),
  };
}

async function getNomineeStatus(vaultId) {
  const vault = await requireVaultById(vaultId);
  return buildNomineeStatus(vault);
}

async function startNomineeLogin(vaultId, nomineeEmail) {
  const vault = await requireVaultById(vaultId);
  const normalizedNominee = String(nomineeEmail || '').trim().toLowerCase();

  if (vault.status !== STATUS.NOMINEES_NOTIFIED && vault.status !== STATUS.UNLOCKED) {
    throw new Error('Nominee login unavailable before notification');
  }

  const nominee = (vault.nominees || []).find((item) => item.email === normalizedNominee);
  if (!nominee) {
    throw new Error('Nominee not found');
  }

  const code = generateOtpCode();
  const challengeToken = jwt.sign(
    {
      type: 'nominee_challenge',
      vaultId: vault.vaultId,
      nomineeEmail: normalizedNominee,
      code,
    },
    getJwtSecret(),
    { expiresIn: '10m' }
  );

  let otpDelivery = 'sent';
  let otpDeliveryError = null;

  try {
    await sendNomineeVerificationCode({
      vaultId: vault.vaultId,
      nomineeEmail: normalizedNominee,
      code,
    });
  } catch (error) {
    otpDelivery = 'failed';
    otpDeliveryError = error?.message || 'Unknown mail transport error';
    throw new Error(`Failed to send nominee verification email: ${otpDeliveryError}`);
  }

  return {
    challengeToken,
    expiresIn: '10m',
    otpDelivery,
    ...(otpDeliveryError ? { otpDeliveryError } : {}),
  };
}

async function verifyNomineeLogin(challengeToken, code) {
  if (!challengeToken || !code) {
    throw new Error('challengeToken and code are required');
  }

  let payload;
  try {
    payload = jwt.verify(challengeToken, getJwtSecret());
  } catch {
    throw new Error('Invalid or expired challenge token');
  }

  if (payload.type !== 'nominee_challenge') {
    throw new Error('Invalid challenge token type');
  }

  if (String(payload.code) !== String(code).trim()) {
    throw new Error('Invalid verification code');
  }

  const vault = await requireVaultById(payload.vaultId);
  if (vault.status !== STATUS.NOMINEES_NOTIFIED && vault.status !== STATUS.UNLOCKED) {
    throw new Error('Nominee login unavailable before notification');
  }
  const nominee = (vault.nominees || []).find((item) => item.email === payload.nomineeEmail);
  if (!nominee) {
    throw new Error('Nominee not found');
  }

  const token = jwt.sign(
    {
      type: 'nominee_access',
      vaultId: payload.vaultId,
      nomineeEmail: payload.nomineeEmail,
    },
    getJwtSecret(),
    { expiresIn: '2h' }
  );

  return {
    token,
    nominee: payload.nomineeEmail,
    vaultId: payload.vaultId,
    vaultName: vault.vaultName,
    expiresIn: '2h',
  };
}

async function listFilesForNominee(vaultId, nomineeEmail, share) {
  const vault = await requireVaultById(vaultId);
  requireNomineeAccess(vault, nomineeEmail, share, { requireUnlocked: true });

  return {
    vaultId: vault.vaultId,
    vaultName: vault.vaultName,
    files: (vault.files || []).map((file) => ({
      id: file.id,
      fileName: file.fileName,
      contentType: file.contentType,
      storedAt: file.storedAt,
    })),
  };
}

async function downloadFileForNominee(vaultId, fileId, nomineeEmail, share) {
  const vault = await requireVaultById(vaultId);
  requireNomineeAccess(vault, nomineeEmail, share, { requireUnlocked: true });
  const fileRecord = requireFileRecord(vault, fileId);

  const object = await downloadObject({
    bucketName: vault.storage.bucketName,
    key: fileRecord.storageKey,
  });

  return {
    fileName: fileRecord.fileName,
    contentType: fileRecord.contentType || object.contentType,
    body: object.body,
  };
}

function evaluateSingleVault(vault, nowIso) {
  if (vault.status === STATUS.UNLOCKED) {
    return false;
  }

  const now = new Date(nowIso);
  const triggerAt = vault.triggerTime ? new Date(vault.triggerTime) : null;

  if (
    triggerAt &&
    !Number.isNaN(triggerAt.getTime()) &&
    now >= triggerAt &&
    vault.status !== STATUS.NOMINEES_NOTIFIED
  ) {
    vault.status = STATUS.NOMINEES_NOTIFIED;
    vault.deadMan.nomineesNotifiedAt = vault.deadMan.nomineesNotifiedAt || nowIso;
    vault.unlockRequest = {
      requestedAt: nowIso,
      reason: 'Trigger time reached',
      approvalsRequired: vault.threshold,
      approvedCount: (vault.nominees || []).filter((nominee) => nominee.status === 'approved').length,
      completedAt: null,
    };
    vault.updatedAt = nowIso;
    return true;
  }

  const nextDueAt = new Date(vault.deadMan.nextCheckInDueAt);

  if ((vault.status === STATUS.ACTIVE || vault.status === STATUS.MISSED_CHECKIN) && now > nextDueAt) {
    vault.deadMan.missedCount += 1;
    vault.status = STATUS.MISSED_CHECKIN;
    vault.deadMan.nextCheckInDueAt = addDays(vault.deadMan.nextCheckInDueAt, vault.checkInPolicy.intervalDays);

    if (vault.deadMan.missedCount >= vault.checkInPolicy.maxMissedCheckIns) {
      vault.status = STATUS.GRACE_PERIOD;
      vault.deadMan.graceStartedAt = nowIso;
      vault.deadMan.graceEndsAt = addDays(nowIso, vault.checkInPolicy.gracePeriodDays);
    }

    vault.updatedAt = nowIso;
    return true;
  }

  if (vault.status === STATUS.GRACE_PERIOD && vault.deadMan.graceEndsAt) {
    if (now >= new Date(vault.deadMan.graceEndsAt)) {
      vault.status = STATUS.NOMINEES_NOTIFIED;
      vault.deadMan.nomineesNotifiedAt = nowIso;
      vault.unlockRequest = {
        requestedAt: nowIso,
        reason: 'Dead man switch triggered',
        approvalsRequired: vault.threshold,
        approvedCount: (vault.nominees || []).filter((nominee) => nominee.status === 'approved').length,
        completedAt: null,
      };
      vault.updatedAt = nowIso;
      return true;
    }
  }

  return false;
}

async function evaluateDeadManSwitches() {
  const nowIso = new Date().toISOString();
  const result = await query('SELECT vault_id, metadata FROM vaults');
  let updated = 0;

  for (const row of result.rows) {
    const vault = row.metadata;
    if (evaluateSingleVault(vault, nowIso)) {
      if (vault.status === STATUS.NOMINEES_NOTIFIED) {
        await notifyNomineesForVault(vault, nowIso);
      }
      await persistVault(vault);
      updated += 1;
    }
  }

  return { scanned: result.rows.length, updated, evaluatedAt: nowIso };
}

module.exports = {
  STATUS,
  upsertVaultForOwner,
  getVaultByOwner,
  getVaultDashboard,
  checkInByOwner,
  requestUnlockByOwner,
  getApprovals,
  storeEncryptedSharesForOwner,
  saveEncryptedFileForOwner,
  updateEncryptedFileForOwner,
  deleteFileForOwner,
  listFilesForOwner,
  downloadFileForOwner,
  startNomineeLogin,
  verifyNomineeLogin,
  submitNomineeShare,
  getNomineeCheckpoint,
  getNomineeStatus,
  listFilesForNominee,
  downloadFileForNominee,
  evaluateDeadManSwitches,
};
