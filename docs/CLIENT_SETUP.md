# Client setup: a new Forge-CT calculator deployment

Forge-CT owns one calculator application and configures each shop through data. A new client should not receive a fork of this repository.

## Setup sequence

1. Create a client record with a stable identifier, business name, logo asset, colors, currency, disclaimer, contact details, and active state.
2. Set the client buy rate. Store it as a validated percentage; do not put the rate into calculator source code.
3. Prepare an authorized pricing CSV using the documented eight-column format.
4. Run the import preview. Resolve missing fields, invalid conditions, invalid prices, duplicate rows, and card/set matching errors.
5. Authenticate as an administrator and confirm the transactional import in the production server-side workflow. Record create/update/skip/error counts and pricing history.
6. Point the deployment’s client identifier at the new configuration and verify the customer flow on mobile and desktop.
7. Confirm that an unavailable card/condition says “Online estimate unavailable for this card/condition.” The application must never invent a price.

## Branding checklist

Branding belongs in configuration: logo, business name, primary and secondary colors, appropriate typography, buttons, accents, buy percentage, disclaimer, and contact information. Shared components remain unchanged.

## Production controls

The current Forge-CT repository is a static site and includes a preview-only import page to demonstrate safe parsing. Before a live client deployment, Forge-CT must provide an authenticated server-side database adapter and admin route. That route must validate inputs again, prevent customer access, upsert instead of duplicate, retain history, and never delete absent records from a partial CSV.

## Example

Hard Hittin uses a 60% buy rate and the initial development configuration. The Sunny would use the same calculator and a different client configuration and maintained dataset. No `TheSunnyCalculator` or `HardHittinCalculator` component is needed.
