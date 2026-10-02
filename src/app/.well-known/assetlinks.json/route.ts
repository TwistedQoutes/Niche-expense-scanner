import { getEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Android's App Links verification file.
 *
 * Android fetches this at install time. Without a match, the
 * `android:autoVerify` intent filter fails and links show a chooser — or just
 * open the browser — instead of the app.
 *
 * The fingerprint is of the certificate the app is *signed with*, which is the
 * part people get wrong: when Play App Signing is on, that is Google's upload
 * key, not the keystore on the developer's laptop. Both can be listed, which is
 * what ANDROID_CERT_FINGERPRINTS allows — comma-separated — so a local debug
 * build and the Play release both verify.
 */
export async function GET() {
  const env = getEnv();
  const raw = env.ANDROID_CERT_FINGERPRINTS;

  if (!raw) {
    return new Response('Not found', { status: 404 });
  }

  const fingerprints = raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0);

  const body = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: env.ANDROID_PACKAGE_NAME,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
