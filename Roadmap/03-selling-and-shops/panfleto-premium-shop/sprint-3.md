# Panfleto — the first premium shop — Sprint 3: The horror convocatoria

**Status:** 🟡 in progress, live pieces landed. Copy approved by Daniel. Branched fresh:
`feat/panfleto-premium-shop-s3` off `origin/main` (`c6bb437`), in an isolated worktree
(`apps/miyagisanchez` was mid-flight on a sibling agent's branch — not touched); merged latest
`origin/main` in on 2026-07-12 to pick up `mcp-parity-core` S1 (see below).

**Live so far (via MCP, `POST /api/ucp/mcp` with the shop's own agent token):**
- ✅ Reward listing created: **"Edición impresa — panfleto"**, `prod_01KXAHXB98GF5SJEJ8KK0RF3QN`,
  $180 MXN, category `creatividad`. Still needs its second price tier (portal-only, see below).
- ✅ Announcement bar live: points at `https://panfleto.miyagisanchez.com/convocatoria`. Confirmed
  server-side via `get_store_configuration` re-read.
- ✅ Launchpad opt-in + guidelines live: `accepts_manuscripts: true`, full guidelines text —
  confirmed rendering on `https://panfleto.miyagisanchez.com/convocatoria` (200, guidelines text
  present in the HTML).

> `launchpad.enabled` is already **ON** (Daniel, 2026-07-09). No flag work here — this sprint is the
> first live use: the call itself, its copy, a real reward product, and the never-yet-run money
> smoke as the walkthrough.

## Mid-sprint update: `mcp-parity-core` Sprint 1 shipped and changed the shape of what's left

The finding below (originally: "the launchpad has no MCP write tools, so this sprint needs a lot of
Daniel's portal time") is now **stale** — a sibling epic, `mcp-parity-core`, was built and merged
mid-sprint (PR [#237](https://github.com/danybgoode/miyagisanchezcommerce/pull/237), live 2026-07-12)
specifically because this sprint's planning surfaced the gap. It shipped exactly the tools this
sprint needs:
- `review_submission` / `publish_submission` — I can now review + publish the seed manuscripts via
  MCP once Daniel submits them (no portal step needed for this anymore).
- `create_campaign` / `update_campaign` / `activate_campaign` — I can now build + activate the proof
  campaign via MCP (no portal step needed for this anymore).
- `launchpad` block in `patch_store_configuration` — done, see "Live so far" above (was originally
  Daniel's action #1; now MCP-doable, confirmed with Daniel before executing since the plan hadn't
  anticipated a brand-new capability shipping mid-sprint).

**What's genuinely still portal-only:** adding a second price tier to the reward listing's
"Opciones" (the CPP configurator has no MCP write path yet — that's `mcp-parity-core` Sprint 2,
unbuilt) — the ONE remaining Daniel action below, aside from submitting the seed stories and running
the money smoke.

## Original research findings (kept for context; #2 superseded above)

1. **Panfleto has no CPP-configured reward product.** The one existing listing (Stickers) has a
   single price tier — fails `isConfigurablePriceGrid` (`lib/launchpad-campaign-types.ts:93-96`:
   needs >1 variant OR any variant with >1 quantity tier). The base listing is created (see "Live so
   far" above); it still needs its second tier — portal-only, see "Daniel's actions" below.
2. ~~The launchpad has no MCP write tools.~~ **Superseded** — see "Mid-sprint update" above.

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

### The reward product — ✅ base listing created; "Opciones" tier still Daniel's
- **Title:** Edición impresa — panfleto — `prod_01KXAHXB98GF5SJEJ8KK0RF3QN`
- **Category:** `creatividad` (Arte y diseño — matches the Stickers listing's category)
- **Description:** "La edición impresa del relato ganador de la convocatoria de terror de panfleto.
  Formato zine, impresión bajo demanda, tiraje limitado. Actualizamos el contenido cuando cierra la
  votación y se conoce el relato ganador."
- **Starting price (set via `create_listing`):** $180 MXN (1 copia) — ✅ live.
- **Second tier (you add via the listing's "Opciones"):** 3+ copias, $150 MXN c/u — the second tier
  is what makes it pass `isConfigurablePriceGrid` and become a legal campaign reward. **The only
  remaining catalog-config step — CPP "Opciones" still has no MCP write path** (that's
  `mcp-parity-core` Sprint 2, unbuilt).

### Announcement bar (`profile.announcement`) — ✅ live via `patch_store_configuration`
- **text:** "panfleto busca relatos de terror de autores mexicanos y latinoamericanos. Envía el
  tuyo."
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

## Daniel's actions — shrunk after `mcp-parity-core` S1 shipped mid-sprint
1. **Submit the two seed manuscripts yourself** through `https://panfleto.miyagisanchez.com/convocatoria`
   (public form, no account) — confirmed 2026-07-12: you're doing this, not me (I have no inbox to
   receive the email verification codes the public form requires).
2. The "Edición impresa — panfleto" listing (`prod_01KXAHXB98GF5SJEJ8KK0RF3QN`) → "Opciones" → add
   the 3+ copies / $150 MXN tier. The only remaining portal-only step.
3. Run the money-step smoke below (vote → coupon → redeem) once the campaign is active.

Everything else that used to be on this list — the launchpad opt-in, reviewing/publishing the
manuscripts, building/activating the campaign — is now MCP-doable and I'll do it once step 1 lands.

## What I do (MCP, using the shop's own agent token)
- ✅ `create_listing` — the base reward listing.
- ✅ `patch_store_configuration` — announcement bar + launchpad opt-in/guidelines.
- ⬜ `review_submission` + `publish_submission` — once Daniel submits the two seed manuscripts.
- ⬜ `update_listing.collection_names` — assign both seed works into "Convocatorias" once published.
- ⬜ `create_campaign` + `update_campaign` + `activate_campaign` — once the reward listing's Opciones
  tier is set (Daniel) and the seed works are published (me).
- ⬜ Extend a launchpad e2e spec asserting the convocatoria renders on the white-label subdomain path.
- ⬜ Write the final smoke walkthrough below with real values once the campaign exists.

## Sprint QA
- **api spec(s):** convocatoria render on the panfleto identity → extend the launchpad specs (the
  intake/review/publish specs exist; assert the white-label subdomain path).
- **browser smoke owed:** **yes, to Daniel — the launchpad money path has never run live**: one full
  vote → threshold → coupon → redeem pass (product-scoped coupon on the linked print listing).
- **deterministic gate:** `tsc --noEmit` + `npm run build` + Playwright `api` green before merge

## Sprint 3 — Smoke walkthrough (do these in order)
Env: production · https://panfleto.miyagisanchez.com

1. Open https://panfleto.miyagisanchez.com/convocatoria in a private window.
   → The horror call renders white-label: genre, eligibility, process — no account demanded. ✅
   confirmed live 2026-07-12.
2. Daniel submits both seed manuscripts through that same public form.
   → I review + publish them via MCP (`review_submission`/`publish_submission`), then assign them
   into the Convocatorias collection. Confirm both appear on the Historias/Convocatorias shelves
   with a working "Lee un adelanto" excerpt.
3. Daniel adds the reward listing's second price tier (3+ copias, $150 MXN c/u) via "Opciones."
   I then build + activate the proof campaign via MCP (`create_campaign`/`activate_campaign`).
   Note the campaign's `/v/<slug>` URL once created.
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
