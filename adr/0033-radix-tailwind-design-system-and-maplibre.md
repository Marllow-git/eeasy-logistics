# ADR-0033: Build the design system on Radix primitives and Tailwind, with MapLibre behind a MapProvider

- **Status:** proposed
- **Date:** 2026-10-31
- **Deciders:** architecture lead
- **Source:** web app architecture (foundation document 7, §5 and §6); ADR-0016 (Arabic first, mirrored from the start); ADR-0010 (Hudhud)

## Context

`packages/ui` is a wave 0 deliverable (foundation plan §6). The product is Arabic-first and right-to-left is the primary layout (ADR-0016); retrofitting direction is the most expensive front-end change there is. The web app needs accessible dialogs, menus and comboboxes, data tables, a dispatch board, and maps for zones, dispatch, recipient tracking and the address pin. Map tiles for Saudi Arabia must render Arabic labels and acceptable boundaries, and the Hudhud B2B agreement may or may not include tiles.

## Decision

- `packages/ui` uses Radix primitives for behaviour and accessibility and Tailwind CSS for styling, with component source kept in the repository (the shadcn pattern). Only logical Tailwind utilities are allowed; a lint rule rejects physical-direction utilities. Tokens are CSS custom properties consumed by the Tailwind theme.
- Tables use TanStack Table and TanStack Virtual; the board uses dnd-kit with a keyboard alternative; forms use react-hook-form with Zod schemas generated from the contracts.
- Maps use MapLibre GL JS behind a `MapProvider` interface in `packages/ui/map`. `HudhudMapProvider` is preferred if the Hudhud agreement includes tiles; `ProtomapsMapProvider` (an OpenStreetMap-derived PMTiles basemap self-hosted in our object storage) is the fallback, subject to a boundary-rendering check before production. Map code is loaded lazily, only on routes that show a map.

## Consequences

- Right-to-left is enforced by lint rather than by review; every component is reviewed in both directions.
- We own and maintain the component source; upgrades of Radix and Tailwind are ordinary dependency PRs.
- Changing the tile vendor is one provider implementation, not a rewrite of map features.
- MapLibre needs `worker-src blob:` in the CSP; a Hudhud tile origin is added to the CSP only if that provider is chosen.

## Alternatives considered

- A full component kit (MUI, Mantine, Ant Design): a second styling system, and right-to-left as a configuration mode rather than the default.
- Google Maps or Mapbox GL: per-load pricing, a third-party origin in the CSP, and vendor lock-in for map features; MapLibre keeps the vendor behind one interface.
- Leaflet with raster tiles: simpler, but weaker for vector styling, smooth marker updates on the dispatch board, and polygon editing.
