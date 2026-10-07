# Vision27 · Supabase setup

You need to do this once. It takes about 10 minutes. You do **not** need the service_role key, and it must never go into the app.

## 1. Create the tables

1. Open your project at supabase.com → **SQL Editor** → **New query**.
2. Paste everything from `schema.sql` and press **Run**.
3. You should see "Success". Running it again later is safe.

**Updating later:** when a new version comes out, paste the whole `schema.sql` again and press Run. It keeps all your data.

This creates:

- `profiles`: usernames, avatars, lives, offices and levels.
- `kv`: saves, chat, homes, follows and private messages.
- `news`, plus `seats`, `elections`, `candidates` and `votes`.
- `wallets` and `ledger`: every player's money, kept on the server.
- `jobs`, `applications`, `shifts`, `skills` and `workers`: the job board.
- `items`, `inventory` and `policies`: materials, tools, fuel and city prices.
- `businesses` and `office_budgets`: where job money comes from.
- `frames`, plus a private Storage bucket `frames`: house photos and moderation.
- `plots` and `gov_sites`: land titles, government land and their names.
- `pieces`, `build_inv`, `parts`, `site_drafts` and `name_reports`: the Building Explorer catalog, bought pieces, committed buildings, crew drafts and name reports.
- `floors`, `stations`, `stock`, `orders`, `ftasks`, `site_state` and `contracts`: work floors, real city stock, deliveries, shift tasks and public works.

Every table has Row Level Security turned on.

## 2. Turn on email codes (OTP)

**Authentication → Sign In / Providers → Email**

- Email provider: **on**
- Confirm email: **on**
- Email OTP length: **6**

**Authentication → Emails → Templates**

Each email shows both a 6-digit code and a button. Players can type the code in the game or tap the button; both work.

**Confirm signup**: subject `Your Vision27 code`, message:

```html
<h2>Welcome to Vision27</h2>
<p>Your code is:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>Or tap this button to confirm and play:</p>
<p><a href="{{ .ConfirmationURL }}" style="background:#1d8a4a;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;display:inline-block">Confirm my email</a></p>
<p>The code expires in 1 hour. If you did not sign up, ignore this email.</p>
```

**Reset password**: subject `Reset your Vision27 password`, message:

```html
<p>Your password reset code is:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>Or tap this button to choose a new password:</p>
<p><a href="{{ .ConfirmationURL }}" style="background:#1d8a4a;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;display:inline-block">Reset my password</a></p>
```

## 3. Send real emails (needed, or players get no code)

Supabase's built-in email is for testing only. It sends a few emails per hour, and only to people on your Supabase team. Real players get no code until you add your own email sender.

Example with Resend (free plan is enough to start):

1. Sign up at resend.com and add your domain (or use their test domain while testing). Add the DNS records it shows you and wait for "Verified".
2. Create an API key in Resend.
3. In Supabase go to **Authentication → Emails → SMTP Settings**, turn on **Custom SMTP** and fill in:
   - Host: `smtp.resend.com` · Port: `465` · Username: `resend` · Password: your Resend API key
   - Sender email: an address on your verified domain, e.g. `no-reply@yourdomain.com` · Sender name: `Vision27`
4. Go to **Authentication → Rate Limits** and raise "emails per hour" (for example 100).
5. Sign up with a new email to test. Check spam the first time.

Brevo or Mailgun work the same way with their own host and login.

**Password rules:** in **Authentication → Sign In / Providers → Email**, set minimum password length to **8** and require letters and digits. The game asks for the same.

## 4. Set your site address

**Authentication → URL Configuration → Site URL**: the address where you host the game, `https://vision27.vercel.app`. Under **Redirect URLs**, add `https://vision27.vercel.app/**`. If the Site URL still says `localhost`, email buttons will point to localhost.

## 5. Host the game

Run `npm install` and then `node build.mjs`. The game is built into `dist/web` (index.html, music.mp3 and _headers).

- **Netlify:** connect your Git repo. `netlify.toml` already sets the build command and folder. Or drag `dist/web` into app.netlify.com/drop.
- **Vercel:** import the repo. `vercel.json` already sets the build and headers.
- **Cloudflare Pages:** build command `node build.mjs`, output folder `dist/web`.

The site **must use HTTPS**, or browsers will block the mic and camera. All three hosts give you HTTPS for free.

## 6. Make yourself an admin (adverts and photo review)

After you sign up in the game, run this in the SQL Editor:

```sql
update profiles set is_admin = true where username = 'YourUsername';
```

Admins get a Review app on the phone to approve, reject or take down house photos. To take one down from the SQL Editor instead:

```sql
update frames set status = 'removed' where id = 'PHOTO-ID';
```

## 7. Voice and video chat

Players talk straight to each other (peer to peer). Supabase only passes the short "hello" messages that start a call, so voice costs you almost nothing.

- Outside, you hear players within 30 metres. They get quieter as they walk away.
- Inside a building (House of Assembly, club, hotel, church…), everyone in the room hears everyone.
- A player can talk to up to 8 people at once.
- Tap a bubble, or use the voice panel or player card, to mute someone.

**Add a relay (TURN) before launch.** About 1 in 10 players are on networks (some offices, some mobile data) where a direct call can't connect. A TURN relay fixes this. Get free or cheap TURN details from Metered (metered.ca), Twilio or Cloudflare Calls, then run this in the SQL Editor with your own details:

```sql
insert into kv (path, data) values ('ads/rtc', '{"iceServers":[
  {"urls":"stun:stun.l.google.com:19302"},
  {"urls":"turn:YOUR-TURN-HOST:443?transport=tcp","username":"YOUR-USER","credential":"YOUR-PASS"}
]}')
on conflict (path) do update set data = excluded.data;
```

The game reads this when it loads. No rebuild needed.

## 8. Launch checklist

- [ ] Schema run (step 1)
- [ ] Confirm email on, OTP length 6, both email templates show `{{ .Token }}` (step 2)
- [ ] Custom SMTP added, and a test sign-up email arrives in your inbox, not spam (step 3)
- [ ] Site URL set (step 4)
- [ ] Deployed on HTTPS (step 5)
- [ ] TURN relay added (step 7)
- [ ] Your admin account set (step 6)
- [ ] Test on a phone: sign up, get the code, make an avatar, walk, turn on the mic with a friend

## How elections work

- Five seats: Ward Councilor (3 winners), Area Council Chairman, Senator (3 winners), Vice President and President.
- A new race opens for each seat automatically. Races last 6 to 48 hours.
- Players pay a nomination form fee in game money. The server takes it from their save, so it can't be faked.
- Each player gets one vote per race, and the server counts them.
- When a race ends, the winners get the office and everyone else holding that seat steps down. The result goes out on the city news ticker.
- To contest a higher seat you must hold the seat below it: Councilor → Chairman → Senator → VP → President.

## Known limits

- **Money:** all money now lives on the server. Wages, materials, business funds, office budgets and election fees are checked there. Small street earnings (NPC shifts, rallies, tips) come from the browser, so they are capped per 10 minutes.
- **Clock-in position:** the game reports where a player stands when they clock in. It is checked against the job's place, but a skilled cheater could fake it. Shifts still take real time.
- **Voice:** calls are peer to peer, so each player connects to at most 8 others. Busy rooms like the House of Assembly work best with up to about 9 talkers at once. A bigger room would need a media server (for example LiveKit), which is a later upgrade.
- **Player limits:** live players use Supabase Realtime, and your plan limits how many players can be connected at once. Check your plan's Realtime limits as you grow.
