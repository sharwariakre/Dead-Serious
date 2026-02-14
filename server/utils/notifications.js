function notifyNominee({ vaultId, vaultName, nomineeEmail, ownerId, nomineeShare }) {
  // Stub for email provider integration.
  console.log(
    `[notify] nominee=${nomineeEmail} vault=${vaultId} vaultName=${vaultName} ownerId=${ownerId} share=${nomineeShare}`
  );
}

module.exports = {
  notifyNominee,
};
