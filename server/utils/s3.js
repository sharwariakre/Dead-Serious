function isS3Enabled() {
  return process.env.S3_ENABLED === "true";
}

function sanitizeUserId(userId) {
  return String(userId).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function getBucketNameForUser(userId) {
  const prefix = (process.env.S3_BUCKET_PREFIX || "deadlock-user").toLowerCase();
  const cleanedUser = sanitizeUserId(userId);
  let name = `${prefix}-${cleanedUser}`.replace(/-+/g, "-");
  if (name.length > 63) {
    name = name.slice(0, 63).replace(/-+$/g, "");
  }

  if (name.length < 3) {
    throw new Error("Unable to derive valid bucket name from user id");
  }

  return name;
}

function loadS3Client() {
  let s3Module;

  try {
    s3Module = require("@aws-sdk/client-s3");
  } catch (error) {
    throw new Error(
      "Missing @aws-sdk/client-s3 dependency. Install it in project root before enabling S3."
    );
  }

  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error("AWS_REGION is required when S3 is enabled");
  }

  const { S3Client } = s3Module;
  return {
    client: new S3Client({ region }),
    commands: s3Module,
    region,
  };
}

async function ensureBucketExists(bucketName) {
  const { client, commands, region } = loadS3Client();
  const { HeadBucketCommand, CreateBucketCommand } = commands;

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
    return;
  } catch (error) {
    const statusCode = error?.$metadata?.httpStatusCode;
    if (statusCode !== 404 && error.name !== "NotFound") {
      throw error;
    }
  }

  const createParams = { Bucket: bucketName };
  if (region !== "us-east-1") {
    createParams.CreateBucketConfiguration = { LocationConstraint: region };
  }

  await client.send(new CreateBucketCommand(createParams));
}

async function uploadObject({ bucketName, key, body, contentType }) {
  const { client, commands } = loadS3Client();
  const { PutObjectCommand } = commands;

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
    })
  );

  return { bucketName, key };
}

async function downloadObject({ bucketName, key }) {
  const { client, commands } = loadS3Client();
  const { GetObjectCommand } = commands;

  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    })
  );

  const bytes = await response.Body.transformToByteArray();
  return {
    body: Buffer.from(bytes),
    contentType: response.ContentType || "application/octet-stream",
  };
}

async function deleteObject({ bucketName, key }) {
  const { client, commands } = loadS3Client();
  const { DeleteObjectCommand } = commands;

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    })
  );
}

module.exports = {
  isS3Enabled,
  getBucketNameForUser,
  ensureBucketExists,
  uploadObject,
  downloadObject,
  deleteObject,
};
