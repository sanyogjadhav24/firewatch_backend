const cloudinary = require("cloudinary").v2;

function initCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error("Cloudinary env vars missing");
  }

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET
  });
}

async function uploadBufferToCloudinary({ buffer, folder, publicId }) {
  initCloudinary();

  return new Promise((resolve, reject) => {
    // Add 45 second timeout for Cloudinary upload
    const timeoutId = setTimeout(() => {
      reject(new Error("Cloudinary upload timeout after 45 seconds"));
    }, 45000);

    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: "image",
        timeout: 60000
      },
      (err, result) => {
        clearTimeout(timeoutId);
        if (err) return reject(err);
        resolve(result);
      }
    );

    stream.end(buffer);
  });
}

module.exports = { uploadBufferToCloudinary };
