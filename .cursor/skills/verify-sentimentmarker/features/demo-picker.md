# Demo picker

The top-bar select opens the built-in scored articles. Start-up opens the RBA FSR Assessment. The full Review is a stub that inserts `examples/fsr-2026-10.demo.js` the first time it is chosen.

## Sub-features

- `demo-boot` opens the Assessment on load of `index.html`.
- `demo-switch` changes the article from the select.
- `demo-lazy` loads the full Review from a classic script, not `fetch`.

## How to get to it (user POV)

- Open `index.html`. The Assessment is already on the page.
- Choose another row in **Demo articles**.

## Driving it with CDP

Preconditions:

- Doctor is `DOCTOR OK`.

- **Boot.** Load `/index.html`. `#selDemo` value is `0`. `#dochead h1` contains `Financial Stability Review`.
- **Switch to the synthetic sample.** Set `#selDemo` to `2` and dispatch `change`. Wait until `#dochead .fn` contains `financial-stability-review.scored.json`.
- **Proof.** Screenshot the header after boot. A heading that still says `Untitled` is a failed load.

## Gotchas

- Demo index `1` is large. Wait for `#doc` sentence count to settle (hundreds of `.s` nodes) before asserting.
- A late demo script must not replace the article now open. Do not click the picker twice in flight.
