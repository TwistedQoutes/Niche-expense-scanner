import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for the JobFlow mobile apps.
 *
 * The app loads the deployed web app rather than a bundled copy, because the
 * product is server-rendered and multi-tenant: a bundled build would go stale
 * the moment the server changed, and shipping a fix would mean a store review
 * instead of a deploy.
 *
 * That choice puts App Store Review Guideline 4.2 (Minimum Functionality)
 * squarely in play — a wrapper around a website gets rejected. What earns the
 * app its place on a phone is the native work around that webview, and it is
 * deliberate rather than decorative:
 *
 *   - **Push notifications.** The entire product thesis is that whoever replies
 *     first wins the job. A browser tab cannot wake a phone on a truck dash.
 *   - **Camera.** Before-and-after job photos are taken on site, one-handed,
 *     in sunlight. The native camera is a different thing from a file picker.
 *   - **Offline.** `errorPath` below points at a local page that renders the
 *     crew's own schedule from native storage when there is no signal, which is
 *     the normal condition in the places this work happens.
 *   - **Location.** The route screen plans a day's drive from where the truck
 *     actually is.
 *
 * Billing is deliberately absent from the app. See `src/lib/native/platform.ts`
 * for how purchasing is hidden, and why.
 */

/**
 * Where the app points.
 *
 * Set `MOBILE_SERVER_URL` when building against staging or a tunnel; production
 * builds take the default. It is read at `npx cap sync` time and baked into the
 * native projects, so changing it means syncing again.
 */
const serverUrl = process.env.MOBILE_SERVER_URL ?? 'https://jobflowai.dev';

const config: CapacitorConfig = {
  appId: 'dev.jobflowai.app',
  appName: 'JobFlow',

  // The local assets shipped inside the binary. Only `offline.html` is ever
  // shown — everything else comes from the server — but the directory has to
  // exist and be non-empty or the native build fails with a confusing error.
  webDir: 'native/www',

  server: {
    url: serverUrl,

    // Shown when the webview cannot reach the server at all. This is the
    // offline experience, not an error screen: it reads the cached schedule out
    // of native storage and renders the day.
    errorPath: 'offline.html',

    // No plaintext HTTP, ever. Session cookies and customer records travel over
    // this connection.
    cleartext: false,
    androidScheme: 'https',
    iosScheme: 'https',

    // Only our own origin may be loaded in the app's webview. Anything else —
    // a link in a customer's message, a Stripe page — opens in the system
    // browser, where the user can see the address bar and the padlock.
    allowNavigation: [new URL(serverUrl).host],
  },

  ios: {
    // The webview's own background, visible for the instant before first paint
    // and behind the bounce at the top of a scroll. Matching the app's page
    // background stops a white flash on a dark phone.
    backgroundColor: '#f8fafc',
    contentInset: 'always',
    // A real Safari user agent fragment is appended so the server can tell a
    // native session from a browser one. `src/lib/native/platform.ts` reads it.
    appendUserAgent: 'JobFlowApp/1.0 (ios)',
    limitsNavigationsToAppBoundDomains: true,
  },

  android: {
    backgroundColor: '#f8fafc',
    appendUserAgent: 'JobFlowApp/1.0 (android)',
    // Debuggable webviews let anything with adb read the session cookie off a
    // lost phone.
    webContentsDebuggingEnabled: false,
  },

  plugins: {
    SplashScreen: {
      // Long enough to cover the first server round trip on a slow connection,
      // short enough that it never feels stuck. Dismissed early by the app once
      // the shell has painted.
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#f8fafc',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },

    PushNotifications: {
      // The badge is cleared by the app when the inbox is opened; a badge that
      // only ever counts up teaches people to ignore it.
      presentationOptions: ['badge', 'sound', 'alert'],
    },

    StatusBar: {
      style: 'DARK',
      backgroundColor: '#f8fafc',
    },
  },
};

export default config;
