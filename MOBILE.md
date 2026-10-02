# The JobFlow mobile apps

Everything needed to get the iOS and Android apps through review and onto a
phone. [DEPLOYMENT.md](DEPLOYMENT.md) covers the website; this covers the apps.

---

## What the apps are

The apps load the deployed web app in a native webview and add the things a
browser cannot do. That architecture is a deliberate choice, and so is
everything built around it:

| Piece | Where | Why it exists |
| --- | --- | --- |
| Push notifications | `src/lib/push/` | The product thesis is that whoever replies first wins the job. A browser tab cannot wake a phone on a truck dashboard. |
| Native camera | `src/lib/native/camera.ts` | Resizes and fixes rotation before upload. A crew member on a rural cell connection should not send an 8 MB photo. |
| Offline schedule | `native/www/offline.html` | Shows today's stops from native storage when there is no signal, which is the normal condition where this work happens. |
| Location | `navigator.geolocation` | Already in the web app; the native permissions make it work in the apps. |
| No purchasing | `src/lib/native/platform.ts` | See **Billing** below. This one is not optional. |

### Why not a bundled app

The product is server-rendered and multi-tenant. A bundled build would go stale
the moment the server changed, and shipping a fix would mean a store review
instead of a deploy.

### The risk this creates, and the answer to it

**App Store Review Guideline 4.2 (Minimum Functionality)** rejects apps that are
a website in a wrapper. Reviewers do probe for it. The answer is the table
above: the app does four things a browser cannot, and the review notes below say
so plainly and tell the reviewer how to see each one.

This is the single most likely reason for a rejection. If it happens, the reply
is not an argument — it is a screen recording of a push notification arriving
while the app is closed.

---

## Billing: the app sells nothing

**App Store Review Guideline 3.1.1.** An app that does not use Apple's in-app
purchase may not:

- show prices,
- present a plan as something to buy,
- or link out to a page where it can be bought.

That last one catches people. A "Manage billing" link pointing at the website is
a rejection.

JobFlow's plans run $49–$199 a month. Through in-app purchase, Apple would take
15–30% of that — $15 to $30 a month on a Pro subscription. So the apps sell
nothing, and the billing surface is removed **on the server**, from the user
agent Capacitor appends, not hidden with CSS. A reviewer reads the page.

What comes out, and where:

| Surface | File |
| --- | --- |
| The Billing nav entry | `src/components/layout/navigation.ts`, `Sidebar.tsx` |
| The whole billing screen | `src/app/(app)/billing/page.tsx` → `BillingUnavailable` |
| "Upgrade to carry on" on a plan limit | `src/lib/billing/usage.ts` |
| "Upgrade to add someone" on a full team | `src/components/team/TeamManager.tsx` |
| `/billing` as a Universal Link | `src/app/.well-known/apple-app-site-association/route.ts` |

Android is treated identically. Google's policy is not the same and a B2B
service has more room, but the difference buys one screen in one app and costs a
second code path plus the chance of shipping the wrong one.

**If you ever want to sell in the app**, that is a real project: StoreKit, Play
Billing, and reconciling two more subscription sources against Stripe's view of
who has paid. Do not bolt it on.

---

## Before you start: accounts

| What | Cost | Notes |
| --- | --- | --- |
| Apple Developer Program | $99/year | Enrolment as an organisation needs a D-U-N-S number and takes days to weeks. Start here. |
| Google Play Developer | $25 once | New personal accounts need 12 testers running the app for 14 days before production. An organisation account does not. |
| Firebase project | Free | Sends push to both platforms. |
| An APNs key | — | In the Apple developer portal, uploaded to Firebase. Firebase talks to Apple on your behalf. |

**Both stores verify your business.** Apple checks the D-U-N-S; Google asks for
a verified address and phone. Neither is quick. Do them first — everything else
on this page is a day's work, and these are the weeks.

---

## Secrets the pipeline needs

`.github/workflows/mobile.yml` reads these. Everything binary is base64 so no
newline handling can corrupt it:
`base64 -i file -o -` on macOS, `base64 -w0 file` on Linux.

### Android

| Secret | What it is |
| --- | --- |
| `ANDROID_GOOGLE_SERVICES_JSON` | `google-services.json` from Firebase, base64. |
| `ANDROID_KEYSTORE_BASE64` | Your upload keystore, base64. **Back this up somewhere else too** — losing it and Play App Signing at once means you can never update the app. |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Keystore credentials. |
| `PLAY_SERVICE_ACCOUNT_JSON` | A Play Console service account with release permission. Plain JSON. |

Create the keystore:

```bash
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA \
  -keysize 2048 -validity 10000 -alias upload
```

### iOS

| Secret | What it is |
| --- | --- |
| `IOS_GOOGLE_SERVICE_INFO_PLIST` | `GoogleService-Info.plist` from Firebase, base64. |
| `IOS_CERTIFICATE_P12` / `IOS_CERTIFICATE_PASSWORD` | An Apple Distribution certificate exported from Keychain Access. |
| `IOS_PROVISIONING_PROFILE` | An App Store provisioning profile for `dev.jobflowai.app`, base64. |
| `IOS_PROFILE_NAME` | That profile's name, exactly as the portal shows it. |
| `APPLE_TEAM_ID` | Ten characters, top right of the developer portal. |
| `APPSTORE_API_KEY_ID`, `APPSTORE_API_ISSUER_ID`, `APPSTORE_API_PRIVATE_KEY` | An App Store Connect API key (`.p8`, base64). Use this rather than an Apple ID: no expiry, no two-factor prompt in a headless runner. |

### On the server

Add to the deployment's environment, or push notifications and app links do
nothing:

```
PUSH_DRIVER=fcm
FCM_PROJECT_ID=<firebase project id>
FCM_CLIENT_EMAIL=<service account email>
FCM_PRIVATE_KEY=<the private_key from the service account JSON>

APPLE_TEAM_ID=<ten characters>
ANDROID_CERT_FINGERPRINTS=<SHA-256 from Play Console → App signing>
```

`ANDROID_CERT_FINGERPRINTS` must be the fingerprint Android actually sees. With
Play App Signing on — and it is on by default — that is **Google's** key, from
Play Console → Setup → App signing, not the upload keystore on your laptop. Both
can be listed, comma-separated, so a local build verifies too.

---

## Store listing

### Name and subtitle

- **App name:** JobFlow
- **Subtitle (iOS, 30 characters):** `Leads to jobs, automatically`
- **Short description (Play, 80):** `Catch every lead, quote it fast, and never lose a job to a missed call.`

### Description

> **Stop losing jobs because you were on a roof.**
>
> JobFlow is for the people who run small service businesses — lawn care,
> landscaping, pressure washing, cleaning, junk removal, handyman, painting,
> HVAC, plumbing, electrical, roofing. The ones who do the work and the
> paperwork.
>
> When someone rings and you cannot answer, JobFlow texts them back before they
> ring the next company on the list. When a lead comes in, your phone tells you
> straight away — with their name and what they want, so you know whether to
> stop what you are doing.
>
> **What it does**
>
> • Texts back a missed call automatically, in seconds
> • Tells you about a new lead the moment it arrives
> • Scores each enquiry so you know who to ring first
> • Turns a measurement into a professional quote a customer can accept on their
>   phone, without creating an account
> • Chases quotes that go quiet, so you do not have to
> • Keeps your jobs, your calendar and your crew's day in one place
> • Puts the day's stops in driving order
> • Before-and-after photos, attached to the job
> • Asks happy customers for a review, at the right moment
> • Shows you what you actually made, per job
>
> **Built for the truck**
>
> Your schedule is there when the signal is not. Photos are taken with the
> camera, not fished out of a file picker. Notifications arrive while the app is
> closed.
>
> **Needs a JobFlow account.** Start free at jobflowai.dev.

### Keywords (iOS, 100 characters, comma-separated, no spaces)

```
lawn,landscaping,contractor,quote,estimate,invoice,crm,leads,scheduling,service,trades,plumber,hvac
```

### Category

- iOS: Business, secondary Productivity
- Play: Business

### Content rating

Everyone / 4+. There is no user-generated content shown to strangers, no ads, no
gambling. Play's questionnaire will ask whether users can communicate with each
other — **yes**: the app sends texts and emails to a business's own customers.

### Screenshots

Required: 6.7" iPhone (1290×2796) and 6.5" (1242×2688) for iOS; phone and
7"/10" tablet for Play. Take them in the demo workspace — never with a real
customer's name on screen.

In order, because the first two are all most people see:

1. **The pipeline board.** The product in one picture.
2. **A lead notification on a lock screen.** The reason to install it.
3. **A quote on a customer's phone**, with the Accept button.
4. **The day's route**, in driving order.
5. **Before and after photos** on a finished job.
6. **The dashboard**, showing what the month made.

---

## App Privacy answers (App Store Connect)

These must match `ios/App/App/PrivacyInfo.xcprivacy` and the privacy page on the
site. Three places, one set of facts — a disagreement is a rejection later and a
more confusing one.

**Used to track you:** nothing. **Linked to the user:** everything below.
**Purpose:** App Functionality, every time.

| Category | Collected | What it is |
| --- | --- | --- |
| Contact Info → Name, Email, Phone | Yes | The signed-in person's own. |
| Contact Info → Other User Contact Info | Yes | The business's customers: names, addresses, phone numbers. |
| Location → Precise Location | Yes | The crew member's position while clocked in, for routing. |
| User Content → Photos or Videos | Yes | Before-and-after job photos. |
| User Content → Customer Support | Yes | Texts and emails with the business's customers. |
| Identifiers → User ID | Yes | The account the session belongs to. |
| Identifiers → Device ID | **No** | The push token identifies a device to Firebase, not a person to us. Declare it if you ever use it for anything else. |
| Usage Data, Diagnostics | **No** | No analytics SDK, no crash reporter in the app. If you add one, change this. |

---

## Data Safety answers (Play Console)

Same facts, Google's wording.

- **Is data encrypted in transit?** Yes — HTTPS, enforced; `cleartext` is off.
- **Can users request deletion?** Yes — in Settings, both the account and the
  whole workspace. Give the URL `https://jobflowai.dev/settings`.
- **Is any data shared with third parties?** Yes, and name them honestly:
  - Twilio — phone numbers and message text, to send SMS
  - Resend — email addresses and message text, to send email
  - Stripe — billing contact and payment details (web only)
  - OpenAI — lead text, for qualification (when enabled)
  - Google Firebase — push tokens, to deliver notifications
  - Google Maps — addresses, for geocoding and routing

| Data type | Collected | Shared | Required | Purpose |
| --- | --- | --- | --- | --- |
| Name, email, phone | Yes | Yes | Yes | App functionality, account management |
| Address (customers') | Yes | Yes | Yes | App functionality |
| Approximate + precise location | Yes | No | **No** | App functionality — the app works without it |
| Photos | Yes | No | No | App functionality |
| Messages (SMS/email) | Yes | Yes | Yes | App functionality |
| User IDs | Yes | No | Yes | Account management |

Mark location and photos **optional**. They are: the app works with both
refused, which is also what the permission prompts imply.

---

## Review notes

Paste into App Store Connect's review notes, and the equivalent in Play.

> **Demo account**
> Email: `reviewer@jobflowai.dev`
> Password: *(create one, set it here, and leave it working)*
>
> This account is in a demo workspace seeded with sample customers and jobs. It
> cannot send real texts or emails to anyone.
>
> **What this app does that a browser cannot**
>
> 1. **Push notifications.** Sign in, allow notifications, then close the app.
>    Open the pipeline on another device and add a lead — a notification arrives
>    within a few seconds. This is the app's main purpose: these users are on a
>    roof or under a sink when an enquiry comes in, and answering first is what
>    wins the job.
> 2. **Camera.** Open any job → Photos → Add photo. The native camera opens; the
>    image is resized and rotation-corrected on the device before upload.
> 3. **Offline.** Open the app once with a connection, then turn on Airplane
>    Mode and relaunch. The day's schedule is still there, read from device
>    storage.
> 4. **Location.** Open Route. The day's stops are ordered from where the device
>    actually is.
>
> **Billing**
>
> This app sells nothing and shows no prices. JobFlow is a business service sold
> on the web; the app is a way to use an account you already have. There is no
> purchase flow, no price, and no link to one anywhere in the app.
>
> **Account deletion**
>
> Settings → Your account → Delete my account. Available to every user, not only
> an account owner.

---

## Before you submit

- [ ] Business verification done on both stores — the long pole
- [ ] `PUSH_DRIVER=fcm` and the three `FCM_*` variables set in production
- [ ] `APPLE_TEAM_ID` and `ANDROID_CERT_FINGERPRINTS` set, and both association
      files return 200 with `Content-Type: application/json`:
      ```bash
      curl -i https://jobflowai.dev/.well-known/apple-app-site-association
      curl -i https://jobflowai.dev/.well-known/assetlinks.json
      ```
- [ ] A real push received on a real iPhone and a real Android phone
- [ ] Demo account created, working, and in a demo workspace
- [ ] Screenshots taken from the demo workspace, no real customer names
- [ ] Privacy policy URL reachable without signing in: `https://jobflowai.dev/legal/privacy`
- [ ] Support URL reachable: a page or a monitored mailbox
- [ ] **Open the app and look for a price.** Nav, billing screen, team screen
      with seats full, and a plan limit reached. If you find one, it is a
      rejection
- [ ] Delete your own account from inside the app, and watch it work

## After the first submission

Expect a rejection or two; it is normal and not a judgement. The two that are
most likely here, and what to do:

**Guideline 4.2, minimum functionality.** Reply with a screen recording of a
push arriving while the app is closed, and point at the review notes. Do not
argue the general case — show the one thing.

**Guideline 3.1.1, in-app purchase.** Something is showing a price or linking to
billing. Find it rather than disputing it: check anything added since this was
written, and check that the server is really seeing the app's user agent.
