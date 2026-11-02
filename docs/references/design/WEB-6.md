# WEB-6 · Zones, drivers and vehicles — design references

Found and read on 2026-11-02 with the Mobbin MCP (platform `web`, `search_screens` and `search_flows`). Saved to the Mobbin collection "eeasy-logistics · WEB-6" (https://mobbin.com/collections/ab6df2fb-e45e-461e-a6f0-184f7d30121e), 20 items (17 screens, 3 flows), read back on 2026-11-02. Scope and rules from: `docs/roadmap.md` row WEB-6 and Q-19; `docs/architecture/web.md` §6.4 (the map: `MapProvider`, MapLibre, `ZonePolygonEditor`, `DriverMarkers`, `TrailLine`, the GeoJSON `Zone` schema), §8 wave 1 rows for zones, drivers and vehicles, and §5 (logical CSS, `dir`, bilingual fields); `docs/handbook/04-conventions.md` "Design references"; `docs/references/design/WEB-3.md` for the shape of this note. ADR-0016 (Arabic and English, Arabic first, RTL) and ADR-0033 (Radix, Tailwind, MapLibre behind `MapProvider`) win over every reference. ADR-0033 is still marked "proposed" in its file (dated 2026-10-31). The notes come from Mobbin preview images and flow titles. No reference was opened in a live product, so exact copy, timing and map behaviour are unverified.

## Summary for the lead

- Zone editor: Felt for drawing and the feature panel beside the map; Klaviyo for the list and map toggle; Shopify for zone-to-region coverage; Square and Turo for per-site coverage rows.
- Drivers: Pinterest for list and detail with Active and Pending; Cloudflare and Kraken for the device list with "current" marked and a per-row revoke; Twingate for the revoke dialog that states the time to take effect.
- Trail with a time scrubber: no map reference found. Browserbase (replay scrubber), Toggl (one-day stepper) and GetYourGuide (ordered stops beside a map) are the nearest parts.
- Live positions: Shopify Live View ("Just now" stamp, legend, KPI tiles over the map) and Klaviyo's time-window control. No driver-status map with a legend was saved (Unanswered).
- Vehicles: Xero (status tabs with counts and a register action), Twenty (record side panel with grouped fields), Wix (table with search, filter and an add row). No vehicle-specific reference (plate, type).
- RTL: no Arabic or right-to-left dashboard with a map in Mobbin. Two searches (English and Arabic) returned only left-to-right products. The Arabic check stays the Playwright census (web.md §10).
- Map tiles (Q-19) are not settled by any reference: all previews show English labels, and attribution differs by product (Google in Turo and GetYourGuide, OpenStreetMap in Felt).

## Zones map: polygon editor, list beside the map, coverage (`/zones`, `/zones/[zoneId]`)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/flows/fdcbbbf1-75ef-4611-aff8-b370bfd1bcca | Felt, "Adding boundaries" (5 screens) | a polygon is drawn as a map layer by placing vertices on the map; a hint line says what the next click does ("Click to draw a feature") and the shape closes on the last point | the full-width top toolbar of nine or more tools, the Share and Export buttons, the "Extract" panel that exposes boundary levels |
| https://mobbin.com/flows/a0071030-76b8-4d7b-a979-415caf31d86d | Felt, "Adding features" (8 screens; the panel is seen in previews, not opened) | a feature panel docked on the right of the map with the feature's fields (name, status, capacity, zone) and one "Done" action at the foot; the map stays visible while the form is open | the layer name in the header and the sample "Driver Hubs" data; a free-text capacity field with no unit |
| https://mobbin.com/screens/10110e7f-769d-427f-a420-e52e9ecc585e | Klaviyo, "Geofences" (list and map toggle, search over the map, Create button) | a List and Map toggle in one page header, the same set in both views; a search box over the map for a place name; the Create button at the top right | the "Import locations" and "Import history" buttons (WEB-6 has no zone import); the single pin in the empty state |
| https://mobbin.com/screens/6f28ba33-38af-4791-8bf4-2f680ce70ac2 | Klaviyo, "Create Geofence" | map on the left, details on the right (name, address, a radius slider with its min and max printed under it), Save and Exit in the header | the radius circle as the shape (WEB-6 draws polygons); the typed latitude and longitude as the only way to place a zone |
| https://mobbin.com/screens/819f4305-b022-481a-80d4-42ba54944970 | Shopify, "Create new shipping zone" (dialog) | coverage as a checklist of regions with the chosen count written per region ("0 of 3 regions") and an expand arrow; the zone name sits above the list; Cancel and Done in the footer | the flag icons, the search across all countries, and the "Add more countries in Markets" link |
| https://mobbin.com/screens/4c900a2f-d6fc-42db-9261-71f131d783c6 | Square, "Pickup & delivery" (one row per location: Pickup and Delivery toggles, Edit) | per-site coverage as a table with a toggle per service; this is the shape `replaceSiteCoverage` needs (one row per site) | the marketing band above the table ("Increase sales up to 93%"), the sidebar with its long menu |
| https://mobbin.com/screens/9e883097-8316-414c-9e67-34c1270345cd | Turo, "Locations" (list with an "Applies to" column per location, row update icon, a toast after a change) | the "Applies to" column: each coverage point lists which vehicles it serves, so an assignment reads from both sides | the delivery-fee and free-delivery columns, which WEB-6 does not have |
| https://mobbin.com/screens/44231fd5-06a4-4709-8d92-23baf38a390f | Turo, "Add delivery location" (search above the map, a pin on the place, a form on the right with a radio group for access) | the search above the map places the pin; the form beside the map has one radio group of fixed choices and an optional free-text field | the blue route cluster and the price block |

Each zone is a GeoJSON polygon (web.md §6.4); the map never computes coverage (`checkCoverage`). The references show a list and a map as two views of one set (Klaviyo) and a panel beside the map (Felt). None shows vertex handles being dragged in a preview, so the vertex-edit gesture is unverified (Unanswered).

## Drivers list, driver detail, devices and revoke (`/drivers`, `/drivers/[driverId]`)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/8ce6ecc2-1644-4b31-9510-93cfaa99e052 | Pinterest, "Employees" (list on the left with an Active and Pending switch, detail on the right with the name, role, a status line and tabs for linked items) | the list and the detail on one page; the status switch sits above the list; an empty tab explains itself with one line and an action | the header with the account switcher, the "Partners" side item, the Add menu's full list |
| https://mobbin.com/screens/3dd1919f-1f08-4a41-a36b-79ce7ed144ba | Cloudflare, "Active sessions" (one card per device: browser, IP, last seen, location; "Current Session" badge; Revoke on the others) | the device the user is on is marked and has no revoke; every other device has one Revoke; each card shows last seen as a time | two cards with the same name ("Macintosh · macOS") with no second field to tell them apart; the top Documentation link |
| https://mobbin.com/screens/fbbfc3b8-8ae7-46cc-946b-fd6ce2dca710 and flow https://mobbin.com/flows/06b47c28-24c4-47a4-ac6e-423ea47268f2 | Kraken, "Connected devices" and "Disconnecting a device" | device rows with the last-active time and location; "This device" in green on the current row; an × per row and a "Disconnect all" below; the confirm says the device "will no longer have access" and that the next sign-in needs approval; a toast confirms | the crypto asset side menu; the purple confirm colour |
| https://mobbin.com/flows/154bc512-1f4f-43d4-bb17-981c93ee1479 | Twingate, "Blocking a device" (device table with Owner, OS and version columns; "Block Device" dialog; "Device blocked" toast; the row disappears) | the confirm names the person and the device and says the block "can take up to 10 minutes", so the time to effect is on the screen; red confirm and a grey "Not Now" | the "Manual Verification" filter and the truncated name column |

Revoke on the driver detail page is the same action as `revokeDriverDevice`. The copy must say what stops (sign-in on that device, the sessions it holds) and what is kept (the driver record, the trail and the audit entry). Kraken and Twingate show the consequence in the dialog; neither shows a reason field. The driver status vocabulary (online, on shift, inactive) has no reference (Unanswered).

## Driver trail for one day with a time scrubber (`getDriverTrail`)

No reference puts a time scrubber under a map of a route. The three closest parts are listed; each covers one part of the job.

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/66bd695c-cbfe-4d53-80f0-81dceb4905c4 | Browserbase, session replay (a horizontal scrubber under the view with the elapsed time, "1:54", and an events list beside it) | the scrubber under the playback area with the current time written beside it; an events panel beside the playback (the link between panel and scrubber is inferred, not shown) | the developer event log (method, request, response) and the Stagehand and Console tabs |
| https://mobbin.com/screens/4c6089bb-c5ed-4e53-8b37-307c502463ea | GetYourGuide, itinerary (numbered stops as a vertical list beside a small map with pins; the first and last stop marked differently) | the ordered stop list next to a map with matching numbered pins; the start and the end have their own marker | the booking panel, the price block, the Google map styling and attribution |
| https://mobbin.com/screens/7471d106-27f9-4050-ae32-9d5486816a7d | Toggl Track, "Calendar" day view (a day stepper "< Yesterday · Tue >" and the day total) | one control for the day: previous and next arrows around the date, and the total for the day in the header | the running-timer bar and the entry blocks; the sidebar |

The trail is a polyline (`TrailLine`) with a scrubber; the references do not show a polyline with a time readout. Trail data is a `delivery.locations.read` view (web.md §8), so the scrubber range is set by the API's retention (Unanswered).

## Live positions map (`DriverMarkers`, `listLatestDriverPositions`)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/dfca7e4b-461b-49bc-9377-92575543a585 | Shopify, "Live View" (a "Just now" stamp beside the title, KPI tiles above the map, a legend under the map for each kind of point: "Orders", "Visitors right now", a search for a location, a full-screen button) | the "Just now" stamp next to the page title, the legend naming each marker kind, a search over the map | the bar chart "Sessions by location" and the sidebar |
| https://mobbin.com/screens/9e0750ed-89c5-4296-87cd-44844b5fa846 | Klaviyo, "Activity map" (a segmented control "Last Day / Last Week / Last Month" over the map; an event select with the count "0 Events") | the time window as a segmented control above the map, the count of events in the window beside it | the blank world map shown at zero events; WEB-6 needs a line of empty-state text instead |

Positions come through the stream and the 12-second polling fallback (web.md §7); the references show the stamp, not the update rule. No reference was found for a status legend with on and off filters, or for a selected-driver card on the map (a Felt preview showed one, but its screen ID was not retrieved, so it is not saved and not cited).

## Vehicles list and form (`/vehicles`)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/b4995839-ca09-41a6-939a-90dba8a14eb3 | Xero, "Fixed assets" (tabs Draft 4, Registered 0, Sold/disposed 0; a table with name, number, type, date and price; a search; Delete and Register enabled only with a selection) | status as tabs with the count in each tab; the action that moves a row to the next status enables only when rows are selected | the explainer card with the video and the "Hide" link |
| https://mobbin.com/screens/ddc70bb6-5a08-444c-8ef8-a12a0050a428 | Twenty, "Company" record (side panel with grouped fields; the address as one group: Address 1, Address 2, City, State, Post code, Country) | the form as a side panel over the list; related fields grouped under one heading | the spreadsheet behind the panel; the record tabs |
| https://mobbin.com/screens/7970b448-c238-4a29-8575-4f3ad6ec6d24 | Wix, "Booking services" (a table with a search, a filter and a row menu per row; a dashed "Add New Service" row at the foot) | a search and a filter above the table, and an add row at the foot of the list | the upgrade banner across the top; the thumbnails in the first column |

No vehicle reference shows a plate number, a vehicle type or a status vocabulary. Plate numbers render inside `<bdi dir="ltr">` (web.md §5), so the plate field is left to right in both locales.

## Right-to-left and Arabic dashboards with maps

- Searches: "Arabic right-to-left dashboard with a map" and the Arabic query "لوحة تحكم التوصيل مع خريطة" (delivery dashboard with a map). Mobbin returned Searchable, Duolingo, SoundCloud, Klaviyo, Shopify, Cofounder, Google Ads, Supabase, incident.io, Quo, Square and Railway. None is a right-to-left layout in its preview.
- The nearest map references, all left to right, are Searchable's location table with a map, SoundCloud's "Top locations" map, and Klaviyo's map views. Do not copy their layout direction.
- The mirror rules still apply to every reference above (web.md §5): chevrons and back arrows mirror; the map pin, the map itself and the checkmark do not. Zoom glyphs are not named in web.md §5; treat them as non-directional and check in review. The zoom buttons and the list position in Arabic have no reference.
- The Arabic check for WEB-6 is the Playwright census in `ar` at 1440 px and 390 px (web.md §11), reviewed in the PR.

## Unanswered

- Q-19, map tiles: no reference settles Hudhud against Protomaps. The previews show English labels only, and the attribution line differs by product (Google in Turo and GetYourGuide, OpenStreetMap in Felt). Owner: does the Hudhud agreement include tiles, and is the attribution line on our map a choice we make (web.md §6.4, open question 3)?
- Q-19 follow-on: Arabic map labels (`name:ar`) appear in no preview. Owner: is an Arabic-labelled basemap a must for the first release?
- Polygon editing: no preview shows vertex handles being dragged or a shape being reshaped. The vertex-edit gesture and the undo behaviour are not in any reference.
- Coverage assignment: zone to region (Shopify), site toggles (Square) and the "Applies to" column (Turo) are three different shapes. Owner: is coverage one zone per site, or many zones per site and many sites per zone?
- Trail scrubber: no map reference with a time scrubber. Owner: what range does the trail cover (one day, the whole day, a time window), and at what point spacing (raw points or thinned)?
- Live positions: no driver status legend or on and off filter was saved. A Felt preview with driver status checkboxes was seen, but its screen ID was not retrieved; find the ID on Mobbin before citing it.
- Revoke copy: Twingate states the effect delay ("can take up to 10 minutes"). Owner: does `revokeDriverDevice` take effect at once, or after the driver app's next refresh, and what does the dialog promise?
- Driver status vocabulary (online, on shift, inactive): no reference names it. Owner: which states exist, and which one a dispatcher can set by hand?
- Vehicles: no reference for plate, type or status. Owner: which vehicle statuses exist, and are plates unique per account?
- Empty states after a filter returns nothing: no reference for the zones list, the drivers list or the vehicles list.
- RTL: no Arabic or right-to-left reference for any WEB-6 screen (the same gap as WEB-3). Owner: accept the Playwright census as the only Arabic check, or ask for an Arabic design review before sign-off.
- ADR-0033 is still "proposed" in its file. The references assume its component set (Radix, Tailwind, MapLibre behind `MapProvider`); if it is not accepted, the map section needs a new read.
- Mobbin previews only: every observation comes from preview images and flow titles read on 2026-11-02. Exact copy, validation, timing and map behaviour are unverified.
