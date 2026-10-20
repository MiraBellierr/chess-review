# Credits

Third-party assets the app ships, with their licences. Everything else in `web/` — code, board art, interface icons,
the paper palette — is first-party work for this project.

## Move-class badges — WintrChess

The eleven move-class badges in `src/assets/classifications/` are copied byte-for-byte from **WintrChess** by WintrCat:

- Source: <https://github.com/WintrCat/wintrchess>, directory `client/public/img/classifications/`
- Licence: **GPL-3.0** (the source repository's licence)
- Taken: 2026-10-18 from `master` — `brilliant.png`, `critical.png`, `best.png`, `excellent.png`, `okay.png`,
  `theory.png`, `inaccuracy.png`, `mistake.png`, `miss.png`, `blunder.png`, `forced.png`
- Mapping: `critical` stands in for the app's **Great** class (WintrChess's set has no "great"); `okay` is **Good**;
  `theory` is **Book**. Their `error`, `risky` and `loading` are not taken. See
  `src/assets/classifications/index.ts`.
- SHA-256, to verify against upstream:

| File | SHA-256 |
| --- | --- |
| `best.png` | `22565c7bab7b554e68e1d8f9d6f483a72817c6ae2d7fa7c8d9ac5405aa2ecdd8` |
| `blunder.png` | `26c8fe5aadba4d99c557b29dd45024a68b6b49eae0dd5f824d4d71ad4d9c9478` |
| `brilliant.png` | `2a8b5e57878f18de3d102d01df4f88c99a0ed2c056dc4f618b156587473de78b` |
| `critical.png` | `2a9ae4cfdd87a54440499a96ae5d24a1f3afcae095b097d8b80917f97635d6e3` |
| `excellent.png` | `4398f29de8f849b853f790aa4af238dcad1195ebb11ad21b15ae3cf6a4a6d00d` |
| `forced.png` | `a41d14179aa3290c37a47738b32bac57e6f4d4e185e71ae04c944eebd3daff45` |
| `inaccuracy.png` | `7ea7031a1cd7dacdda91cefa72a42a792fa8df8474261f9c2bf74cc08bed0220` |
| `miss.png` | `43476531ce6ec7ac046fd0d462fd2e0b600baadf7eac974b155c3f2c141cccd4` |
| `mistake.png` | `d0900bc221c6c0859b0cb4418ba207aba6da8ae98e5f42ae9d46360b45596fc2` |
| `okay.png` | `fc706d19ef85b0b08b1afeec7d1c160035bd6fa8b2b9470775c3d014a6fd2ad5` |
| `theory.png` | `b0e02937a3bb0412b13b721e4b26f4949f5b3950d161797ddaba657dcd4302e9` |

**What the license means here.** Chess Review is distributed under GPL-3.0, so the badges' GPL-3.0 terms apply to the
combined work. The repository includes the GPL-3.0 license text in `LICENSE` and offers the full source. Keep this file
with the badges.

## Display serif — Fraunces

`public/fonts/` holds the Fraunces woff2 subsets (latin and latin-extended, one variable file per subset covering
400–700), self-hosted so the page fetches no network font.

- Source: Google Fonts, <https://fonts.google.com/specimen/Fraunces>, retrieved 2026-10-18
- Licence: **OFL-1.1**
