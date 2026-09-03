# Meta App Review: screencast shot list

App: **Markaestro** (Meta app `1645694433302285`, Instagram app `916172414583238`,
Threads app `1493496502304419`).

Last rejection (Sept 2026) for `instagram_business_basic`,
`instagram_business_content_publish`, `instagram_business_manage_insights` and
`threads_delete`: "Screencast Not Aligned with Use Case Details". Meta's reviewer
could not see, in one recording, (1) the complete login flow, (2) the user
granting each permission, (3) the feature that uses each permission.

This document is the recording plan that satisfies all three, permission by
permission. The in-app connect flow was redesigned for it: every Connect button
now opens an explainer listing the exact permissions and what each is used for,
and the return from the platform lands on a persistent "connected" panel that
names the granted permissions and links to the feature that uses each one.

## Recording setup (Meta's own guidance)

- App UI language: **English**. Sign in to Markaestro as a member whose
  language preference is English (Settings > Account).
- Screen width **1440 px or less**, recorded at 1080p or better. Browser full
  screen, no other windows.
- Cursor enlarged (macOS: System Settings > Accessibility > Display > Pointer
  size). Use the mouse, not keyboard shortcuts.
- No audio needed. Reviewers do not listen. Captions are what count.
- Add a caption bar for every step (QuickTime + iMovie, or Camtasia). Caption
  text for each shot is given below; reuse it verbatim.
- Start **logged out of everything**: Markaestro, instagram.com, threads.net,
  facebook.com. Use a private browser window so no cookies exist.
- Use a **test brand** and a **test Instagram Professional account** that is an
  Instagram Tester on the Instagram app (App Roles). Publishing creates real
  posts. Delete them afterwards or use a throwaway account.
- One continuous recording per submission is fine (about 6 to 8 minutes).
  Trim dead time (loading spinners longer than 3 seconds) but never cut between
  clicking Continue and the platform's login page appearing.

## Part 1: Markaestro login (required in every recording)

| # | Action | Caption |
|---|--------|---------|
| 1.1 | Open `https://app.markaestro.com/login` in the private window. | "Markaestro sign-in. Markaestro uses passwordless email codes, not Facebook Login." |
| 1.2 | Enter the email, press Continue. | "A 6-digit code is emailed to the user." |
| 1.3 | Show the email inbox with the code (Gmail tab), type the code, sign in. | "Entering the emailed code completes sign-in." |
| 1.4 | Land on the dashboard. | "Signed in. No Meta permissions have been granted yet." |

## Part 2: Instagram (Instagram Business Login)

Permissions demonstrated: `instagram_business_basic`,
`instagram_business_content_publish`, `instagram_business_manage_insights`.

| # | Action | Caption |
|---|--------|---------|
| 2.1 | Go to **Brands**, open the test brand, click the **Channels** tab. | "Each brand has its own social channels. Instagram is not yet connected." |
| 2.2 | Hover **Connect** on the Instagram row so the tooltip shows, then click it. | "Connect opens Instagram's own sign-in page." |
| 2.3 | The **Connect Instagram** dialog appears. Pause 4 seconds on it. Scroll slowly through the permission list. | "Before leaving Markaestro the user sees every permission that will be requested and the feature each one powers: Basic account info (identity), Publish content (publishing), Read insights (analytics)." |
| 2.4 | Click **Continue to Instagram**. | "Markaestro redirects to instagram.com/oauth/authorize with the three instagram_business scopes." |
| 2.5 | Instagram login page: enter the Professional account credentials, sign in. | "The user signs in on instagram.com. Markaestro never sees the password." |
| 2.6 | Instagram permission dialog: pause so all three permissions are readable, then click **Allow**. | "The user grants instagram_business_basic, instagram_business_content_publish and instagram_business_manage_insights." |
| 2.7 | Back in Markaestro the brand sheet opens on Channels with the green **Instagram connected** panel. Pause 4 seconds. | "Instagram returned the user to Markaestro. The panel shows the linked @username (read with instagram_business_basic) and the permissions granted." |
| 2.8 | Point at the Instagram row: **Linked** badge, `@username`, and the "Permissions granted" line. | "instagram_business_basic in use: the account's username and ID identify the linked account." |
| 2.9 | Click **Test connection**; wait for the green toast "Connected as @username". | "Test connection makes one read-only call to GET /me on the Instagram Graph API using instagram_business_basic." |

### 2A: instagram_business_content_publish

| # | Action | Caption |
|---|--------|---------|
| 2A.1 | In the connected panel click **Create a post** (or go to Posts > Create). | "Creating a post that will be published through the API." |
| 2A.2 | Select the test brand, select the Instagram channel chip, upload an image (use `markaestro-logo.png`), type a caption "Markaestro review test post". | "The post targets the Instagram account linked in Part 2." |
| 2A.3 | Click **Publish now**. Wait for the "Published" state. | "instagram_business_content_publish in use: Markaestro calls POST /me/media then POST /me/media_publish." |
| 2A.4 | Open the Instagram profile in a new tab and show the post live. | "The post is live on the Instagram account." |
| 2A.5 | Back in Markaestro, Posts > **Published** tab, click the post; show the "View on Instagram" link. | "The published post is stored with its Instagram media ID." |

### 2B: instagram_business_manage_insights

| # | Action | Caption |
|---|--------|---------|
| 2B.1 | Go to **Analytics**, select the test brand and the Instagram channel. | "Analytics reads account and post insights." |
| 2B.2 | Show the follower count and reach / likes / comments cards. Click **Refresh** if present. | "instagram_business_manage_insights in use: GET /me?fields=followers_count and GET /{media-id}/insights?metric=reach,likes,comments,shares,saved." |
| 2B.3 | Open the **Post breakdown** or post history and show per-post metrics for the post published in 2A. | "Per-post insights for the post published a moment ago." |

## Part 3: Threads

Permissions demonstrated: `threads_basic`, `threads_content_publish`,
`threads_manage_insights`, and specifically `threads_delete`.

| # | Action | Caption |
|---|--------|---------|
| 3.1 | Brands > test brand > Channels. Hover then click **Connect** on Threads. | "Threads has its own login, separate from Instagram." |
| 3.2 | **Connect Threads** dialog. Pause on the permission list; "Delete posts" is listed with "Used for Post management". | "The user is told up front that Markaestro can delete a Threads post when they remove it from the On Platform tab." |
| 3.3 | Click **Continue to Threads**. Sign in on threads.net. | "Sign-in happens on threads.net." |
| 3.4 | Threads permission dialog: pause, click **Allow**. | "The user grants threads_basic, threads_content_publish, threads_manage_insights and threads_delete." |
| 3.5 | Return to Markaestro: green **Threads connected** panel with @username and granted permissions. | "threads_basic in use: the linked profile is identified by GET /me." |
| 3.6 | Create and publish a text post "Markaestro review test" to Threads (Posts > Create). Show it live on threads.net. | "threads_content_publish in use: POST /me/threads then POST /me/threads_publish." |
| 3.7 | Posts > **On Platform** tab, Threads. Show the post list with view / like counts. | "threads_manage_insights in use: GET /{media-id}/insights." |
| 3.8 | On the test post click **Delete**, confirm in the dialog. The post disappears from the list. | "threads_delete in use: DELETE /{media-id}. The user removes the post from Threads without leaving Markaestro." |
| 3.9 | Reload threads.net and show the post is gone. | "The post has been deleted on Threads." |

## Part 4: Facebook Pages (only if `pages_*` / `read_insights` are in the same submission)

| # | Action | Caption |
|---|--------|---------|
| 4.1 | Channels > Facebook > **Connect**. Dialog lists pages_show_list, pages_read_engagement, pages_manage_posts, read_insights. Continue to Facebook. | "Facebook Login with the four Page permissions." |
| 4.2 | facebook.com login, then the Page selector: tick every Page, click Continue, click Done. | "The user picks which Pages Markaestro may manage and grants the permissions." |
| 4.3 | Back in Markaestro: amber "One more step: choose a Facebook Page" panel. Click **Choose Pages**, tick the test Page, click Link. | "pages_show_list in use: the picker lists the granted Pages from GET /me/accounts." |
| 4.4 | Publish a post to the Page and show it on facebook.com. | "pages_manage_posts in use: POST /{page-id}/feed." |
| 4.5 | Analytics > Facebook: follower count, reach and engagement. | "pages_read_engagement and read_insights in use: GET /{page-id}?fields=fan_count and GET /{page-id}/insights." |

## Part 5: disconnect (shows data deletion)

| # | Action | Caption |
|---|--------|---------|
| 5.1 | Channels > Instagram > hover **Disconnect** (tooltip), click, confirm. | "Disconnect deletes the stored access token. The user can also remove Markaestro from Instagram's Apps and Websites settings; Markaestro receives the deauthorize webhook and deletes the connection." |

## Submission notes to paste with the video

- Login: Markaestro accounts use passwordless email codes. Facebook Login is
  not used for app sign-in; the recording shows the full email-code login first.
- Instagram is connected through **Instagram API with Instagram Login**
  (instagram.com/oauth/authorize), not through a Facebook Page. Threads uses
  threads.net/oauth/authorize. Both flows are visible in the recording.
- Test credentials for the reviewer: an Instagram Tester account is listed in
  App Roles; sign-in details are in the "Test user" fields of the submission.
- Timestamps: give the mm:ss at which each permission is granted and at which
  each permission's feature is used (fill in after editing).

| Permission | Granted at | Used at |
|---|---|---|
| instagram_business_basic | 2.6 | 2.7, 2.9 |
| instagram_business_content_publish | 2.6 | 2A.3 |
| instagram_business_manage_insights | 2.6 | 2B.2 |
| threads_delete | 3.4 | 3.8 |

## Pre-flight before recording

1. The production deploy includes the connect explainer dialog and the
   connected panel (this branch). Check `app.markaestro.com` shows the
   "Connect Instagram" dialog when Connect is pressed.
2. The Instagram app is in a state where graph.instagram.com serves tokens
   for the test account (Instagram Tester role accepted in the Instagram app,
   or Advanced Access). If `/me` returns code 100 "Unsupported request", stop
   and fix the app configuration first; the recording will not show a
   successful connect otherwise.
3. Run `node scripts/diagnose-meta-connections.mjs` after the test connect to
   confirm the stored token works against every endpoint the recording uses.
4. Delete the test posts (or keep the throwaway account) after recording.

## Recording made on 2026-09-03 (submitted version)

File: `output/meta-review-2026-09-03/markaestro-meta-app-review-screencast.mp4`
(outer repo, 12:16, 1408x984, browser chrome and the extension outline cropped, captions burned in). Raw takes sit next to it.
Test brand: Mustard Seed Impact International. Test accounts: Instagram
@mustardseedii (Instagram Tester), Threads @mustardseedii (Threads Tester).

| Time | What is on screen |
|---|---|
| 00:00 | Brands > Channels, nothing connected |
| 00:35 | Connect Instagram dialog: 3 permissions with their use |
| 01:08 | Instagram Login on instagram.com; user grants the 3 permissions |
| 02:17 | Instagram connected panel (@mustardseedii); Test connection = GET /me |
| 03:00 | Create post, caption, image attached |
| 04:07 | Post Now (instagram_business_content_publish); Published tab |
| 05:05 | Post live on instagram.com |
| 05:50 | Analytics filtered to Instagram; Refresh (instagram_business_manage_insights) |
| 06:04 | Followers, reach, views; engagement breakdown; per-post metrics |
| 06:38 | Threads: Channels, Connect Threads dialog (4 permissions incl. threads_delete) |
| 07:42 | Threads login on threads.net; user grants the 4 permissions |
| 09:02 | Threads connected panel (@mustardseedii) |
| 09:37 | Post Now to Threads (threads_content_publish) |
| 09:55 | Posts > On Platform; View opens the post on threads.com |
| 11:05 | Delete, confirmation dialog |
| 11:41 | Confirmed: threads_delete; post gone from list |
| 12:06 | Deleted post URL on threads.com resolves to the profile |

Submission notes: Markaestro sign-in is passwordless email codes and is not
part of the Meta login; the reviewer test account is signed in throughout.
Instagram uses Instagram API with Instagram Login; Threads uses the Threads
API login. Both consent screens are shown in full.

### Gotchas hit while recording

- `threads_delete` is "App Review rejected" on the app. A rejected permission
  still works for accounts with an app role, so the test Threads account must
  have an **accepted** Threads Tester invite (App roles > Roles; accept in
  threads.net Settings > Website permissions > Invites). Until then Threads
  answers code 10 "Application does not have permission for this action".
- Analytics Refresh used to toast a raw "Object with ID … does not exist"
  for a post deleted on the platform; the on-demand refresh now parks such
  posts silently (commit f5bf3aa).
- Screen recording: `screencapture -v` from a background job ignores SIGINT
  (use `-V`), sometimes never writes the file (kill and retry), and the
  browser extension cannot drive instagram.com / threads.com, so the person
  recording performs the consent screens.
- The Chrome extension shows a "Claude is active in this tab group" toast
  inside the page for ~3 s whenever a tab in its group is opened or closed,
  and draws a soft orange glow ~20 px wide around the viewport. Crop
  16 px from each viewport edge and cut the seconds around any tab open or
  close before submitting; scan frames for a white pill on dark pages.
