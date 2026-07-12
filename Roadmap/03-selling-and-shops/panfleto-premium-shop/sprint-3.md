# Panfleto — the first premium shop — Sprint 3: The horror convocatoria

**Status:** ⬜ copy drafted, nothing live yet — **waiting on Daniel's read before any MCP call or
portal action executes.** Branched fresh: `feat/panfleto-premium-shop-s3` off `origin/main`
(`c6bb437`), in an isolated worktree (`apps/miyagisanchez` was mid-flight on a sibling agent's
branch — not touched).

> `launchpad.enabled` is already **ON** (Daniel, 2026-07-09). No flag work here — this sprint is the
> first live use: the call itself, its copy, a real reward product, and the never-yet-run money
> smoke as the walkthrough.

## Two research findings that reshape this sprint (confirmed against the actual code)

1. **Panfleto has no CPP-configured reward product.** The one existing listing (Stickers) has a
   single price tier — fails `isConfigurablePriceGrid` (`lib/launchpad-campaign-types.ts:93-96`:
   needs >1 variant OR any variant with >1 quantity tier). This sprint creates one — see "The reward
   product" below.
2. **The launchpad has no MCP write tools.** `list_manuscript_submissions` /
   `list_launchpad_campaigns` are read-only by design — the tool descriptions themselves say
   "Creating/activating campaigns happens in the seller portal" (`app/api/ucp/mcp/route.ts:419,429`).
   Same for reviewing/approving/publishing a manuscript, and for adding price-tier "Opciones" to a
   listing (`create_listing`/`update_listing` have no variant/tier fields —
   `app/api/ucp/mcp/route.ts:348-455`). `settings.launchpad` (accepts_manuscripts/guidelines) also
   isn't wired into `applyStoreConfig` — UI-only (`app/api/sell/shop/route.ts:157-161`). **Net
   effect:** more of this sprint is your hands-on portal time than Sprint 2 (which ran almost
   entirely through MCP). Everything MCP-reachable, I do; everything else is an exact-values
   checklist below — same shape as Sprint 2's "Daniel's three actions," just longer.

**Also found:** the S2-created "Convocatorias" collection (plural) won't be picked up by the
launchpad shelf's auto-suggest, which hard-matches the exact string `"Convocatoria"` (singular,
case-insensitive — `lib/launchpad-shelf.ts:18,47-49`). Not fixing the mismatch (no rename tool
exists via MCP, and it's not worth a portal detour) — I'll just assign the seed works into
"Convocatorias" directly via `update_listing.collection_names`, which doesn't depend on the
name-matching logic at all. The auto-suggest nudge card simply won't light up for this shop; the
collection itself displays correctly regardless.

## Stories

### Story 3.1 — The call + the reward product + proof-of-pipe
**As an** author, **I want** a clear open call at panfleto's convocatoria page — what we're looking
for, how to submit, what happens after — **so that** I can send my story in minutes without an
account. **As** the shop, **I want** a real print product to reward the eventual winner, **so
that** the campaign can be configured this sprint.
**Acceptance:** the convocatoria is live at https://panfleto.miyagisanchez.com/convocatoria (and
`/s/panfleto/convocatoria`); it states genre (horror), eligibility (authors from México / Latin
America), length guidance, the process (review → excerpt → publication → voting → print unlock);
two seed manuscripts flow intake → review queue → publish-as-digital → "Lee un adelanto" excerpt →
Convocatorias shelf; a CPP-configured print listing exists as the future campaign reward.
**Risk:** med

### Story 3.2 — Launch surfaces + the voting/print plan (the smoke)
**As** the shop, **we want** the call visible and shareable and the money path proven, **so that**
the launch is real, not aspirational.
**Acceptance:** announcement bar on panfleto points at the convocatoria; a draft campaign is
configured (threshold, print-product reward, window) and activated; the full vote → threshold →
coupon → redeem loop runs live for the first time on this feature; share copy drafted (long
canonical URLs — `mschz.org` prefixes for `/v/` and `/convocatoria` don't exist yet, the
`mschz-full-coverage` epic is still `status: scaffolded`).
**Risk:** med

## Drafted copy — for Daniel's read before anything ships

Content bar applied: es-MX, simple, concrete, direct address. No time-to-complete promises. No
"esto nos recuerda…" wrap-ups. No filler intensifiers.

### Convocatoria guidelines (`settings.launchpad.guidelines`, ≤2000 chars — you paste this in
`/shop/manage/convocatoria`)
> panfleto busca relatos de terror. La convocatoria está abierta a autores de México y América
> Latina.
>
> Qué buscamos: un relato de terror, en español, de 800 a 5,000 palabras. Un relato por autor por
> envío. Puede ser inédito o ya publicado en otro lugar, siempre que tengas los derechos.
>
> Qué pasa con tu relato: lo revisamos y te escribimos con el resultado — aceptado, con cambios
> sugeridos, o no seleccionado esta vez. Los relatos aceptados se publican en panfleto como
> adelanto digital. Los lectores votan por sus favoritos; el relato más votado se imprime en una
> edición física.
>
> Cómo enviar: sube tu archivo (PDF, EPUB o DOCX) y verifica tu correo. No necesitas cuenta.

### The reward product ("Opciones" step is yours — I create the base listing via MCP)
- **Title:** Edición impresa — panfleto
- **Category:** `creatividad` (Arte y diseño — matches the Stickers listing's category)
- **Description:** "La edición impresa del relato ganador de la convocatoria de terror de panfleto.
  Formato zine, impresión bajo demanda, tiraje limitado. Actualizamos el contenido cuando cierra la
  votación y se conoce el relato ganador."
- **Starting price (I set via `create_listing`):** $180 MXN (1 copia)
- **Second tier (you add via the listing's "Opciones"):** 3+ copias, $150 MXN c/u — the second tier
  is what makes it pass `isConfigurablePriceGrid` and become a legal campaign reward.

### Announcement bar (`profile.announcement`, I set via `patch_store_configuration`)
- **text** (≤140 chars, this draft ~87): "panfleto busca relatos de terror de autores mexicanos y
  latinoamericanos. Envía el tuyo."
- **link:** `https://panfleto.miyagisanchez.com/convocatoria`

### Two seed manuscripts (I submit these through the real public form to prove intake works;
you approve + publish in the review queue)

**"El que cuenta las sillas"**
> Mi abuela vivía sola en Iztapalapa, en una casa con ocho sillas alrededor de una mesa para
> cuatro. Cuando le pregunté por qué, dijo que las sillas no eran para sentarse, eran para contar
> quién faltaba.
>
> Cada Día de Muertos ponía un plato en cada silla. Ocho platos. Yo solo conocía a cuatro
> parientes muertos. Le pregunté por los otros cuatro y me dijo, sin levantar la vista de la masa
> que amasaba, que esas cuatro sillas todavía no tenían nombre.
>
> —¿Cómo que no tienen nombre?
>
> —Son para los que van a faltar. Yo ya sé cuáles van a ser, mija, pero no te lo voy a decir.
>
> Me reí, porque uno se ríe de esas cosas cuando tiene veinte años y una abuela que siempre habló
> así, con la voz plana de quien te cuenta el clima. Volví dos años después, cuando murió. Ayudé a
> levantar la casa. Conté las sillas: eran cinco. Conté los platos guardados en la alacena,
> envueltos en papel periódico, con un nombre escrito a lápiz en la base de cada uno. Cuatro
> decían nombres que yo no conocía. El quinto decía el mío, con la fecha en blanco.
>
> No lo rompí. Lo guardé. Sigo esperando a que alguien me diga qué fecha va ahí.

**"La foto de la cena"**
> En la foto de Navidad de 2019 somos nueve alrededor de la mesa. Yo cuento ocho.
>
> La subí a un grupo de familia hace tres años, sin pensarlo, y mi tía Rosa fue la primera en
> comentar: "¿Y esa quién es?" Señalaba a una mujer al final de la mesa, de espaldas, con un
> suéter rojo que nadie en la familia tiene. Le dije que seguro era la vecina, que se había colado
> a la cena como todos los años. Mi tía no volvió a comentar nada.
>
> El año pasado busqué la foto de nuevo para un álbum que estaba armando. La mujer del suéter rojo
> ya no está de espaldas. Está de frente, mirando a la cámara, y no reconozco su cara. Nadie en la
> familia la reconoce tampoco, aunque todos coinciden en que estuvo ahí esa noche, sentada en la
> silla vacía junto a mi abuelo, que murió el año siguiente.
>
> Este año, cuando pusimos la mesa para la cena, alguien — no sé quién, nadie lo admite — dejó
> puesto un lugar de más. Nadie lo quitó. Nadie dijo nada. Todos comimos como si esa silla siempre
> hubiera estado ahí.
>
> Todavía no he vuelto a revisar la foto.

Both attributed to "Redacción panfleto" as launch/editorial seed content (not test junk) — clearly
legitimate first entries on the Historias shelf until real submissions arrive.

### Proof campaign (`/shop/manage/convocatoria/campanas` — you create + activate this)
- **Title:** Votación panfleto: elige el relato que se imprime
- **Description:** "Vota por tu relato de terror favorito. El más votado se imprime en una edición
  física de panfleto."
- **Works:** the two seed manuscripts above
- **Umbral (threshold):** 3 votes
- **Reward:** 50%
- **Reward product:** Edición impresa — panfleto
- **End date:** ~14 days out (pick any real future date — this is a proof campaign to run the
  smoke below, not the permanent public campaign; low threshold matches the exact precedent
  bookshop-launchpad's own Sprint 3 used to validate this mechanism, dark, once already)

### Share copy (long canonical URLs — no `mschz.org` short link yet)
> panfleto abre convocatoria de relatos de terror para autores de México y América Latina. Sin
> cuenta, sin costo. Lee las bases: https://panfleto.miyagisanchez.com/convocatoria

## Daniel's actions — what needs your live session (exact values above)
1. `/shop/manage/convocatoria` → toggle "acepta manuscritos" ON, paste the guidelines copy.
2. Review queue → approve + publish both seed manuscripts (after I submit them through the public
   form).
3. The new "Edición impresa — panfleto" listing → "Opciones" → add the 3+ copies / $150 MXN tier.
4. `/shop/manage/convocatoria/campanas` → create the proof campaign with the values above, then
   **Activar**.
5. Run the money-step smoke below (vote → coupon → redeem).

## What I do (MCP + public-form, no auth needed for either)
- `create_listing` — the base reward listing.
- Submit both seed manuscripts through `/s/panfleto/convocatoria` (public, no account).
- `patch_store_configuration` — announcement bar.
- `update_listing.collection_names` — assign both seed works into "Convocatorias" once published.
- Extend a launchpad e2e spec asserting the convocatoria renders on the white-label subdomain path.
- Write the final smoke walkthrough below with real values once the campaign exists.

## Sprint QA
- **api spec(s):** convocatoria render on the panfleto identity → extend the launchpad specs (the
  intake/review/publish specs exist; assert the white-label subdomain path).
- **browser smoke owed:** **yes, to Daniel — the launchpad money path has never run live**: one full
  vote → threshold → coupon → redeem pass (product-scoped coupon on the linked print listing).
- **deterministic gate:** `tsc --noEmit` + `npm run build` + Playwright `api` green before merge

## Sprint 3 — Smoke walkthrough (do these in order)
Env: production · https://panfleto.miyagisanchez.com

1. Open https://panfleto.miyagisanchez.com/convocatoria in a private window.
   → The horror call renders white-label: genre, eligibility, process — no account demanded.
2. (Already done by me before this doc is marked ready) Confirm both seed manuscripts appear on
   the Historias/Convocatorias shelves with a working "Lee un adelanto" excerpt.
3. Complete Daniel's actions 1–4 above (opt-in, publish, Opciones tier, create + activate the
   proof campaign). Note the campaign's `/v/<slug>` URL once created.
4. In three private windows, open `https://miyagisanchez.com/v/<slug>` (canonical host — the
   voting page has no subdomain rewrite, confirmed by reading `middleware.ts`), vote for either
   story from three different emails.
   → Progress climbs 1/3 → 2/3 → 3/3 (honest count). A repeat email on the same story is refused.
5. On the 3rd vote (threshold hit). **(money step — Daniel)**
   → The product-scoped coupon mints; you receive it by email.
6. Add "Edición impresa — panfleto" to a cart, redeem the coupon at checkout. **(money step)**
   → 50% applies to that product only. Try the same code on the Stickers listing → rejected
   ("solo aplica a un producto específico que no está en tu carrito").

If any step fails, note the step number + what you saw — that's the bug report.
