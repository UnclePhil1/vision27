# Vision27

A low-poly 3D life simulation set in Abuja, in the browser. Pick a life (Citizen, Sponsor or Coordinator), hustle, buy a house, talk to other players by voice or video, vote, and get elected all the way to Aso Rock.

## Play it now

You need [Node.js](https://nodejs.org) (version 18 or newer).

```
npm start
```

Open http://localhost:5174. The game in `dist/web` is already built.

## Change the game

1. Install once:
   ```
   npm install
   ```
2. Edit files in `src/`.
3. Build and run:
   ```
   npm run dev
   ```

`npm run build` only builds, and `npm start` only runs.

## Put it online

Netlify and Vercel settings are already in `netlify.toml` and `vercel.json`. Connect your repo and deploy. The site must use HTTPS so the mic and camera work. See `SETUP.md` step 8 for the launch checklist.

## Folders

| Path | What it is |
|---|---|
| `src/` | All game code (one file per part: city, districts, cars, roles, elections, map, login…) |
| `template.html` | The page layout and styles |
| `assets/music.mp3` | Background music |
| `supabase/schema.sql` | The database (already added to your Supabase project) |
| `SETUP.md` | Supabase settings: email codes, templates, hosting |
| `DESIGN.md` | Who can do what in each system, and what's next |
| `dist/web/` | The built game, ready to upload |

Key code files:

- `src/main.js`: starts everything and runs the game loop
- `src/auth.js`: sign up, email code, log in and the avatar screens
- `src/backend.js`: Supabase connection
- `src/roles.js`: the four lives and their actions
- `src/life.js`: city clock, daily goals, streaks and levels
- `src/hub.js`: phone apps (Today, Vote, Ranks, Me)
- `src/districts.js`: Aso Rock, Maitama, Gwarinpa, Nyanya, Eagle Square, Jabi
- `src/map.js`: the map and GPS
- `src/avatar.js`: outfits and skin tones
- `src/voice.js`: voice and video chat (bubbles, who's talking, mute)
- `src/work.js`: Work app (job board, hiring, shifts, skills, public works)
- `src/floors.js`: work floors: stations, the shift phone, route arrows, hold actions
- `src/floordata.js`: every work station (also seeds the database)
- `src/practice.js`: practice tasks for the preview (online, the server runs them)
- `src/market.js`: materials market, fuel station, wardrobe, Market app
- `src/upkeep.js`: house upkeep, repairs, photo frames, My House app
- `src/land.js`: plots, government land, site menus, Land app
- `src/explorer.js`: the Building Explorer (buy, drag, drop, commit)
- `src/catalog.js`: every building piece and the building rules (also seeds the database)
- `src/sites.js`: plots and government land as build grids (also seeds the database)
- `src/structures.js`: draws committed buildings, roads and bridges
- `src/signs.js`: road signs, gateway boards, the Lands Registry and floating markers
- `src/plots.js`: where the plots are (also seeds the database)
- `src/server.js`: one door to the server (and a stand-in for the preview)
- `src/gigs.js`: Ride and Chow apps (order a taxi or food, or work as a driver or rider)

Characters: Quaternius (CC0).
