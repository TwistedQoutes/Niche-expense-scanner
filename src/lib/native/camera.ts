/**
 * Taking a job photo with the phone's own camera.
 *
 * A file input does open a camera on both platforms, so this is not about
 * making the impossible possible. It is about the three things the file input
 * does badly, all of which matter when the photo is taken one-handed in
 * sunlight with a hedge trimmer in the other hand:
 *
 *  - **Size.** A modern phone's full-resolution JPEG is 4–8 MB. A crew member on
 *    a rural cell connection uploading two of those per job is a minute of
 *    waiting and a chunk of someone's data allowance. Capacitor resizes and
 *    re-encodes before the file ever exists.
 *  - **Rotation.** A file input hands over the sensor's raw orientation and the
 *    EXIF tag separately, and plenty of pipelines lose the tag — which is why
 *    photos taken in portrait so often show up sideways. `correctOrientation`
 *    bakes the rotation into the pixels.
 *  - **The choice.** The native sheet offers camera or library in the
 *    platform's own idiom, rather than a browser's approximation of it.
 *
 * Everything is imported dynamically, so none of it reaches the web bundle.
 */

/** True only inside the Capacitor apps. Safe to call during render. */
export async function isNativeApp(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export class CameraCancelled extends Error {
  constructor() {
    super('No photo was taken.');
    this.name = 'CameraCancelled';
  }
}

/**
 * Opens the native camera and returns what it produced as a `File`, so the
 * caller's existing upload path does not change.
 *
 * Throws `CameraCancelled` when the person backs out, which is an ordinary
 * outcome and not worth a toast.
 */
export async function captureJobPhoto(): Promise<File> {
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');

  let photo;
  try {
    photo = await Camera.getPhoto({
      // 80 is the point where a further drop starts to show on a photograph of
      // a lawn or a roof, which is what these are.
      quality: 80,
      // The bounding box. Capacitor scales proportionally to fit it, so a
      // portrait photo stays portrait. Enough to see whether the edging was
      // done; small enough to send over a bad connection.
      width: 1600,
      height: 1600,
      correctOrientation: true,
      resultType: CameraResultType.Uri,
      // The sheet, not the camera straight away: half of these photos were
      // taken before anyone opened the app.
      source: CameraSource.Prompt,
      promptLabelHeader: 'Job photo',
      promptLabelPhoto: 'Choose from photos',
      promptLabelPicture: 'Take a photo',
      promptLabelCancel: 'Cancel',
      // Deliberately not saved to the camera roll. The photo belongs to the
      // job, and filling a crew member's personal library with sixty pictures
      // of other people's lawns a week is not a favour. It also keeps the app
      // out of the write-to-library permission entirely.
      saveToGallery: false,
    });
  } catch (error) {
    // Capacitor reports a cancel as a thrown error with a message that varies
    // by platform, so it is matched loosely and treated as the ordinary outcome
    // it is.
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('cancel')) throw new CameraCancelled();
    throw error;
  }

  if (!photo.webPath) throw new CameraCancelled();

  // webPath is a local URI the webview can read. Fetching it yields the bytes
  // without a base64 round trip, which on a large photo is a visible pause and
  // a third of the memory again.
  const response = await fetch(photo.webPath);
  const blob = await response.blob();

  const extension = photo.format === 'png' ? 'png' : 'jpg';
  const type = photo.format === 'png' ? 'image/png' : 'image/jpeg';

  return new File([blob], `job-photo-${Date.now()}.${extension}`, {
    type: blob.type || type,
    lastModified: Date.now(),
  });
}
