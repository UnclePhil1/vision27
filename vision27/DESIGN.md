# Vision27 systems: who can do what

This covers what is built so far: money, jobs and shifts, work floors, market and wardrobe, house upkeep with photo frames, land, the Building Explorer (for every building, road and bridge), and public works.
The vehicle canvas comes next.

**One rule for all of them:** anything other players can steal, trade or destroy lives on the server.
Money in the browser is only a display. It cannot mint land, cars, jobs or election power.

## Money (server wallet)

| | |
|---|---|
| Who creates | The server opens a wallet the first time you play. You get your life's starting money, or your old browser savings if higher (capped at 3× the starting money). |
| Who edits | Only server functions. Players can't write to the wallet table. |
| Server-checked | Yes. All wages, escrow, materials, business funds, office budgets and election fees. |
| Street hustle | NPC shifts, rallies, goals and tips are reported by the browser and capped per 10 minutes (10 city hours): Citizen ₦300k, Coordinator ₦600k, Politician ₦3M, Sponsor ₦15M. |
| Visible to others | No. Employers see skill and reputation, never money. The Ranks board shows net worth. |

## Jobs and shifts

| | Citizen | Coordinator | Sponsor | Politician |
|---|---|---|---|---|
| Takes jobs | Yes | Yes | Yes | Yes |
| Posts jobs | Personal hires (up to 2 people, 3 days), paid from own wallet | Union jobs at the motor parks and Unity Market, paid by the traders' levy. Keeps 0–30% dues | Business jobs, paid from business funds (register a business for ₦5M) | Government jobs from the seat's daily budget (Councilor ₦10M → President ₦1B) |
| Moral push | Clean hire +2 | Union +1. Dues over 20%: −4 (Mercenary) | Clean hire +2. Funding a business +1 | Clean +2. Padded (skims 30%): −10 (Predator). Paying for work at your own house from the budget is always padded |

- **Listing:** role, employer, pay (per hour or per job), shift window on the city clock, required skill and level, place, moral tag (clean, padded, union, government), days and places.
- **Flow:** apply → shortlist → hire → reject or fire. City firms hire on the spot. The employer sees skill level, XP, reputation, and shifts done or missed.
- **Escrow:** pay is held when the job is posted and paid per finished shift. Closing a job returns what's left to whoever paid it.
- **Shift:** clock in within 25 m of the place (or inside the building) from 1 minute before the start. Finish after the end. Late means you're paid only for the time you worked. Jobs at a work floor are paid by tasks done (see Work floors).
- **Skill:** +2 XP for a full shift, +1 for a partial one. Levels: Apprentice 3 XP, Skilled 10, Master 25. NPC shop work gives +1 at most every 2 minutes, for shift skills only. Trades are learned only on real jobs.
- **Reputation:** +2 per shift done, −5 per missed shift, −3 for quitting with shifts booked.
- **Tools:** skilled trade jobs (Apprentice and up) need your own tool, bought at Unity Market.
- **Time:** a shift is 1–8 city hours (1–8 real minutes).

## Work floors

A shift on a work floor is a list of real tasks. Nothing fills up while you stand still.

| Floor | Where | What you do |
|---|---|---|
| Depot | Kwik Dispatch, Jabi | Scan pallets in, put stock away in lettered bays (A-01 to D-04), pick orders, pack them in the right box (S, M or L), load the truck |
| Shop floor | FreshMart and Nyanya Park Market | Carry crates from the back to the shelves, serve the queue at the till, close the till at the end |
| Mechanic bay | Jabi Motors Workshop | Check the car in, diagnose, take the right part, fit it, fuel it, hand back the keys |
| Works yard | FCDA Works Yard (by the expressway) | Sign out tools, then patch potholes, clear waste heaps or repair stalls out in the city |
| Building site | A plot or government land | Collect materials at the gate, then lay, fix, wire, plumb, tile or paint the next committed piece |

| | |
|---|---|
| The phone | Shows the next station, the item and how many, step by step. Floor arrows show the shortest walk. A small map shows the floor. |
| Hold actions | Stand at the station and hold the action button (E). Let go when the ring turns green. Hold too long or walk off and you redo that step. |
| Choices | Pick the right item or box. A wrong one cuts the order and your wage (−5% each, at most −50%). |
| Pay | 30% for time on the floor, 70% for tasks done (3 tasks per city hour is full pay). Busy hours pay more per task: morning lorries at the depot, lunch rush at the shops, evening rush everywhere. |
| Skill and reputation | Only from finished tasks: 1 XP per 3 tasks. Good shift +2 reputation, a few tasks +1, none −1. |
| Clock out | Clock out early for part pay. Walk off without clocking out and you are marked absent (−5 reputation). |
| NEPA and fuel | Each floor loses power some city hours (the same for everyone). Scanners, label printers, the till and car lifts stop. A diesel shortage stops the depot truck until someone fills it from a jerrycan. |
| Walk-in gigs | Inside any work floor, take a 2-hour gig at the door. One gig every 6 minutes, up to 6 people per floor. |
| Many players | Players share a floor and split roles at the depot (receive, pick, pack, dispatch). The server never hands the same order to two people. |
| Combo | A streak counter for fun. It does not change pay. |

**Real stock.** Goods live in one place at a time: a pallet at the door, the receiving lane, a bay, a shop shelf or a player's bag. Every move is one server update, so nothing is copied. Shops order from the depot when shelves run low. Unity Market and the fuel station sell from real stock; when it runs out the price goes up 50% (imported) and a restock order goes to the depot. If no one works the depot for 8 minutes, the city's own staff send orders out, so goods never get stuck.

**Who uses the floor.** Citizens work it. Coordinators post union jobs at Nyanya Park Market, take a cut of each shift and a small levy on sales. Sponsors post jobs from a business at a floor; served customers and repaired cars add to the business funds. Politicians commission public works.

## Public works

| | |
|---|---|
| Who | Office holders, from the Work app (Hire tab). |
| Kinds | Road repair (potholes), waste clearance, market repair (stalls). |
| Cost | ₦32,000 per worker from the office budget. The crew job appears on the Work board for 2 days at the FCDA Works Yard. |
| Ghost workers | Extra names on the crew list. Their pay goes to the politician (−6 moral each, Predator). |
| Finished | All spots fixed: +6 moral if the list was clean, −4 if it had ghosts. The news says which. Patched potholes disappear and stop slowing cars; cleared heaps vanish. |

## Market and wardrobe

| | |
|---|---|
| Server-owned goods | Building materials, tools and fuel. Priced on the server, kept in a server inventory. |
| Browser-owned goods | Food, clothes and furniture. They're cosmetic or local until a trade system exists. Spending still comes out of the server wallet. |
| Prices | Midday shock +40%. Market levy (Chairman and up, 0–30%) on materials and shop goods. Fuel price (VP or President, 60–200%) on fuel and taxi fares. A fuel subsidy means cheap fuel but long queues. |
| Who sets policy | Only the seat holder. A policy stops counting once its setter leaves office. Squeezing people: −8. Relief: +4. Each change goes on the city news ticker. |
| Delivery | The phone Market app, from level 2. Groceries ₦1,500, materials, tools and fuel ₦3,000. Online, rice, beans, garri, oil, noodles, tomatoes and eggs come through the depot floor and land in your bag when the truck delivers. |
| Wardrobe | Bought clothes go into your wardrobe. Clothes you wear lose condition. Wash them with detergent (+45%) or restock. Nearby players see your outfit. |

## House upkeep

| Need | How it works |
|---|---|
| Power | NEPA cuts power at random. A generator runs on petrol from your stock: 10 L lasts about 10 minutes. |
| Water | The tank runs down over time, and each meal you cook uses 10%. A water tanker costs ₦8,000. |
| Spoilt fittings | Appliances wear with use and can break below 35%. Spoilt things stop working. |
| Repair | **Yourself:** needs the trade at Apprentice, the tool and a spare parts box. **Hire:** posts a Work job at your gate; it's fixed when their shift is done. **Replace:** buy new. **Scrap:** 10% back. |
| Refurnish | Move, rotate, store, or sell for 40% back (10% if spoilt). |
| Kitchen and wardrobe | The My House app shows what's empty. |

## Photo frames

| | |
|---|---|
| Who adds | The house owner. The photo is cropped square and shrunk to 512 px JPEG. |
| Limits | 300 KB per photo, 12 photos per player, images only. |
| Storage | Private Supabase Storage bucket `frames`. Players can only write to their own folder. |
| Who sees it | The owner always. Visitors only after a moderator approves it. Pending or removed photos show a placeholder. |
| Report | Visitors press E at a frame. After 3 reports, an approved photo is hidden again until it's re-reviewed. |
| Takedown | Moderators (`is_admin`) use the phone Review app to approve, reject or take down. Owners can remove their own photos. |
| Public space | Uploads never appear outside houses. |

## Land (plots)

| | |
|---|---|
| Where | 32 plots in Lugbe Layout (cheaper: homes, shops, workshops) and Katampe Extension (offices and workshops, 1.6× price), off the expressway. Each plot is 20 × 24 m. |
| Title | Kept on the server (`plots` table). Only server functions change the owner. |
| Who buys | Everyone. Limits: Citizen 2 plots, Coordinator 3, Politician 3, Sponsor 6. |
| Differences by life | Coordinators pay 80% for Lugbe shop and workshop plots (community allocation). Every purchase goes on the city news, with the office title if the buyer holds one. |
| Prices | Residential ₦2.5M, shop ₦4M, workshop ₦5M, mixed ₦6M, office ₦9M (×1.6 in Katampe). |
| Resale | The owner sets an asking price. Any player can buy at that price; the money goes straight to the seller. The building goes with the plot. |
| Visible to others | Sale signs on every plot, the building, and its build stage. |

## Building Explorer

One screen builds everything: houses, rooms, shops, offices, workshops, roads, bridges and government buildings. Only the catalog and who may open it change. There is no other way to build.

| | |
|---|---|
| Open it | From your plot sign or the Land app. The camera sits above the site. The site is a grid: 1 m cells on plots, 2 m cells on government land. |
| Catalog | Left side, in tabs: Structure, Finish, Outdoor, Rooms, Interior, plus Shop, Office or Workshop on those plots. Government land has Site, Government, Roads or Bridges. |
| Buy first | Every piece has a naira price (it moves with the midday shock and the market levy). Bought pieces wait in your build inventory. Dragging a piece you have not bought only opens the buy box. A bad drop bounces back and costs nothing. |
| Drag and drop | Drag a piece onto a free cell; it snaps to the grid. Small pieces (foundations, slabs, walls, roofs, paint, tiles, fences, road lanes) can be dragged across many cells at once. R rotates. Undo and redo. Click a piece to select it; Delete takes it back to inventory (draft) or demolishes it for 40% salvage (committed). |
| Order of work | Clear the plot → foundation → floor slab → walls → doors and windows → staircase → roof → paint and tiles → rooms and furniture. A door or window needs a wall. Paint needs a wall. A roof needs every outside edge of that floor walled in. An upper floor needs a staircase or lift on the floor below. |
| Rooms | Mark cells as a room (bedroom, kitchen, bathroom, living room, shop floor, office, workshop and more). Furniture only goes in rooms it belongs to: a bed will not go in a bathroom, a till will not go in a bedroom. |
| Draft and commit | Drafts are free and private (saved in your browser). Commit sends the whole change to the server, which checks every rule again, takes the pieces from your inventory and the materials from city stock (Unity Market). Other players only ever see committed buildings. |
| What can block a commit | A rule not met (the explorer names the piece), pieces not bought, a material short in the city (wait for the depot or the supplier's tipper to restock), NEPA at the site for pieces that need power (lifts, fridges, tills, car lifts), or a hired crew whose held pay has run out. |
| Building it | Committed pieces show as an orange plan until someone builds them. Each building task is: collect at the site gate, then do the piece at its spot (one-cell pieces go four at a time). You can do pieces in your own trades (Apprentice or better), and anyone can clear the site. Furniture and room labels are in place at once. |
| Names | Name or rename a plot or government site at any time (2 to 40 letters). The name shows on the map, the plot sign and the deed in the Land app. Three reports take a name down until the owner picks a new one. Government land shows its official name until the seat renames it. |
| Salvage and resale | Demolishing a committed piece gives 40% back. A sold plot keeps its building; the name is cleared for the new owner. |

**Who may open it**

| Who | Where | What they can do |
|---|---|---|
| Plot owner | Their plots | Buy, drag, commit, rename, hire builders and architects |
| Hired builder or architect | The site they were hired on | Drag inside the owner's draft and send it. The owner approves: missing pieces are bought at today's price, the draft is committed, and an architect's fee is paid (+3 architect XP, +2 reputation). Without approval nothing is built. |
| Area Council Chairman | AMAC Council Grounds, Lugbe Layout Road extension | Local roads, market sheds, council buildings |
| Senator | Nyanya District Works, Katampe Road extension | District works |
| Vice President and President | Federal City Works, Jabi Lake Bridge, Aso Rock Estate | City works, bridges, Aso Rock estate works |
| Citizens | Roads and bridges | Never open the explorer there; they work the crew's shifts |

**Government land**

| | |
|---|---|
| Money | Pieces are bought from the office budget, never the politician's wallet. |
| Crew contract | "Award to a crew" posts a crew job (₦32,000 a worker) at the site for 2 days. The crew builds the committed pieces on shift. |
| Reformer | The contract ends when every piece it placed is built and the crew is paid: +6 moral, and the news says so. |
| Predator | Ghost names on the crew list put money in the politician's pocket (−6 each). A contract that runs out with nothing placed: −10 and a protest. Pulling down public works with nothing in their place: −6 and a protest. |
| Roads and bridges | Built on road reserves and the bridge site. Cars do not drive on new roads yet; people can walk on them. |

## Finding your way

| | |
|---|---|
| Road signs | Green signs at 17 big junctions point by the real GPS route to land for sale, building materials, houses for sale and furniture, with distances. |
| Gateways | Brown and blue boards on the expressway mark Lugbe Layout and Katampe Extension, with prices. |
| Lands Registry | A kiosk where the two layouts meet. Press the action button there to open the Land app. |
| Markers | Tall floating labels show from far away: LAND FOR SALE, LANDS REGISTRY, BUILDING MATERIALS, FURNITURE, HOUSES FOR SALE. |
| Map | "I want to" buttons find the nearest place to buy land, a house, materials, furniture, clothes, groceries, food, work, fuel, cars or a hospital. Plots are coloured: yellow for sale, green yours, grey owned. Prices show when you zoom in. |
| First play | A one-time tip points new players to the map and the signs. Citizens can get a daily goal to visit Lugbe Layout. |

## Not built yet (next rounds, in order)

1. Vehicle canvas and server-owned cars (the mechanic bay is ready for them)
2. Open bidding on public works, and cars driving on player-built roads
