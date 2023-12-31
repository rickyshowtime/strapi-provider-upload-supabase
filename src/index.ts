import { createClient, SupabaseClient, SupabaseClientOptions } from "@supabase/supabase-js";
import fs from "fs/promises";
import {isUrlFromBucket} from "./utils";
import {Config, File} from "./types";

function getKey(directory: string, file: File): string {
  const path = file.path ? `${file.path}/` : "";
  const fname = file.name.replace(/\.[^/.]+$/, "");
  const filename = `${path}${fname}_${file.hash}${file.ext}`;

  if (!directory) return filename;

  return `${directory}/${filename}`.replace(/^\//g, "");
}

const upload = async (file, supabase, apiUrl, clientBucket, clientDirectory) => new Promise<void>(async (resolve, reject) => {
  file.hash = new Date().getTime();
  const fileKey = getKey(clientDirectory, file);
  if (!file.stream && !file.buffer) {
    reject(new Error('Missing file stream or buffer'));
    return;
  }

  try {
    let fileData;
    if (file.stream) {
      if(!file.stream.path){
        reject(new Error('File stream path is missing'));
        return;
      }
      // If there's a stream, read the file data into a Buffer.
      fileData = await fs.readFile(file.stream.path);
      // ToDo  convert the ReadStream to a duplex stream using a package like duplexify, check if supabase support duplex stream
    } else if (file.buffer) {
      // If there's already a Buffer, use that.
      fileData = Buffer.from(file.buffer, "binary");
    }
    const uploadResponse = await supabase.storage
      .from(clientBucket)
      .upload(fileKey, fileData, {
        cacheControl: "public, max-age=31536000, immutable",
        upsert: true,
        contentType: file.mime,
      });
    console.log(uploadResponse)

    const { data, error } = await supabase.storage
      .from(clientBucket)
      .getPublicUrl(fileKey);

    if (error) {
      console.error("Error getting public URL:", error);
      reject(error);
      return;
    }

    console.log(data.publicUrl)
    file.url = data.publicUrl;
    resolve();
  } catch (error) {
    reject(error);
  }
});

export = {
  init(providerOptions: Config) {
    const { apiUrl, apiKey, bucket, directory, privateBucket,options } = providerOptions;

    const clientBucket = bucket || "strapi-uploads";
    let clientDirectory = (directory || "").replace(/(^\/)|(\/$)/g, "");

    const year = new Date().getFullYear().toString();
    const month = (new Date().getMonth() + 1).toString();

    if (!clientDirectory && options?.dynamic_directory) {
      clientDirectory = `${year}/${month}`;
    }

    const supabaseOptions: SupabaseClientOptions<"public"> = options as SupabaseClientOptions<"public">;
    const supabase: SupabaseClient = createClient(apiUrl, apiKey, supabaseOptions);

    return {
      upload: (file: File) => upload(file, supabase, apiUrl, clientBucket, clientDirectory),
      uploadStream: (file: File) => upload(file, supabase, apiUrl, clientBucket, clientDirectory),
      delete: (file: File) => new Promise<void>(async (resolve, reject) => {
        const fileKey = getKey(clientDirectory, file);

        const { data, error } = await supabase.storage
          .from(clientBucket)
          .remove([fileKey]);

        if (error) {
          reject(error);
          return;
        }

        resolve();
      }),
      //checkFileSize not implemented
      getSignedUrl: (file: File) => new Promise<{ url: string }>(async (resolve, reject) => {
        // Do not sign the url if it does not come from the same bucket.
        const fileOrigin = isUrlFromBucket(file, bucket, apiUrl)
        if (!fileOrigin.bucket) {
          console.warn(fileOrigin.err)
          resolve({ url: file.url });
        }
        const fileKey = getKey(clientDirectory, file);
        const result = await supabase.storage
          .from(clientBucket)
          .createSignedUrl(fileKey, options?.expiryMinutes || 60, {
            download: options?.download,
            transform: options?.transform,
          });

        if (result.error) {
          console.error(result.error);
          resolve({ url: file.url })
          return;
        }

        resolve({ url: result.data?.signedUrl || '' });
      }),
      isPrivate: () => privateBucket,
    };
  },
};

/* WIP duplexify
let fileStream;

// Check if the file has a stream property
if (file.stream) {
  if (!file.stream.path) {
    // If the stream doesn't have a path, reject the promise
    reject(new Error('File stream path is missing'));
    return;
  }
  // If there's a stream, create a duplex stream from it
  fileStream = duplexify();
  const readStream = fs.createReadStream(file.stream.path);
  readStream.on('error', (err) => {
    fileStream.emit('error', err);
  });
  fileStream.setReadable(readStream);
} else if (file.buffer) {
  // If there's already a Buffer, use that
  fileStream = duplexify();
  fileStream.setReadable(Buffer.from(file.buffer, "binary"));
}

// Upload the file to Supabase
const uploadResponse = await supabase.storage
  .from(clientBucket)
  .upload(fileKey, fileStream, {
    cacheControl: "public, max-age=31536000, immutable",
    upsert: true,
    contentType: file.mime,
    //duplex: "???"
  });
 */
