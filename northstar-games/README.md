# Offline Poker Study

A Python CLI and basic web app for **six-handed, 100BB no-limit hold'em study and play-money simulation**. Python 3.10+ required. The CLI has no third-party dependencies; the web server uses Waitress. No poker-site integration, screen scraping, deposits or real-money automation.

## Web app

Live: **https://games.northstarenergy.ca/**

The web app includes a six-seat table, configurable starting stacks and hero position, legal betting controls, study hints, showdown equity, a 169-hand preflop grid, JSON strategy import/spot export and hand-history replay. Each visitor has a separate temporary session. Sessions expire after two hours of inactivity and are lost on server restart. Download histories to retain them. Web uploads are limited to 1 MB; strategy imports support up to 2,000 exact states.

To run a separate local copy, open a terminal in this folder:

```powershell
python -m pip install "waitress>=3,<4"
python -m poker_study.web --port 4185
```

Open http://127.0.0.1:4185/. If the installed NorthStar Games task already owns that port, use `--port 4186` for a separate test copy. `Start Web App.cmd` starts the default port after installing Waitress.

Hosting uses the existing Cloudflare Tunnel with a separate games-only origin on port 4185. The Windows task **NorthStar Games Web** starts the origin at user sign-in and restarts failures up to three times. **The computer must remain online, awake and signed in.** This is not independent cloud compute. See `DEPLOYMENT.md` for operation and rollback instructions.

**This is a study framework, not a solved 6-max GTO bot.** Bots use position-aware opening, isolation and raise-defense heuristics. Postflop they estimate equity against coarse action-conditioned ranges, compare the call price, and mix folds, calls, value bets and occasional bluffs. Missing imported table entries use this heuristic practice policy. The executable CFR solver solves two-player Kuhn poker only. Its exploitability number does not describe hold'em strategy quality.

## Run

Open a terminal in this folder. No install or third-party packages required:

```powershell
python -m poker_study play --config examples/cash-100bb.json --hero 3 --seed 12 --output my-hand.json
python -m poker_study replay my-hand.json --step
python -m poker_study simulate --hands 100 --seed 12 --output my-simulation.json
python -m poker_study ranges --output my-ranges.json
python -m poker_study train --iterations 10000 --output my-kuhn.json
python -m poker_study equity --hole As Kh --board Qs Jh 2c --opponents 1 --samples 2000 --pot 600 --call 200
python -m unittest discover -s tests -v
```

On Windows, `py` can replace `python`. Optional installation: `python -m pip install -e .`, which adds the `poker-study` command.

## Study controls

Seats are numbered 0–5. Default button: seat 0; SB: 1; BB: 2; UTG: 3; HJ: 4; CO: 5. Choose any hero seat. The other five seats use the imported policy or heuristic practice strategy. Each play invocation deals one hand; change `--seed` for a different reproducible deal.

At every hero decision, including flop, turn and river, the CLI displays your cards, board, stacks, street contributions, pot and legal actions. Opponents' private cards are not shown during play.

- `fold`, `check`, `call`: take that action.
- `raise:250`: raise **to a total of 250 chips on this street**, including chips already committed. Any legal integer size is accepted, not just listed sizes.
- `hint`: show strategy probabilities and their source/limitations.
- `equity`: estimate equity against uniformly random live opponents. This is not a solver recommendation.
- `export examples/spot.json`: export the current information set and heuristic/imported probabilities as a strategy template; does not advance the hand.
- `quit`: save the partial hand for replay and exit.

Replay validates every recorded action and final stacks. `--step` pauses between actions. Replay is a local study view and can show the hole cards of successive actors. History files intentionally store the entire deck for deterministic reconstruction; do not treat them as private multiplayer logs.

## Configuration and rules

Edit a copy of `examples/cash-100bb.json`. Amounts are integer chips: default BB = 100, stack = 10,000 = 100BB. You can configure all six stacks, both blinds, button and seed. CLI `--seed` overrides the config seed. Exactly six occupied seats are required, each with a positive starting stack.

Implemented: blinds, four betting rounds, button-relative action order, checks/calls/folds, full and short all-in raises, cumulative short-raise reopening, all-in runouts, best-five-of-seven evaluation, wheel straights, side pots, uncalled excess returns, split pots and odd chips awarded clockwise from the button. No rake, antes, straddles, tournaments or heads-up table mode. Simulation resets stacks each hand and rotates the button; it does not model seat departures or bankroll survival.

## Solver-derived strategy tables

`python -m poker_study play --strategy examples/strategy-template.json`

The JSON interchange format has `version: 1`, `key_format: "exact-local-v1"`, a nonempty `source` provenance string, and a `states` object. Each state key maps action labels to nonnegative finite probabilities summing to one. Legal labels are `fold`, `check`, `call` and `raise:CHIPS`. Imported arbitrary raise sizes are supported and validated at lookup. Illegal matched actions fail explicitly; absent states use the heuristic practice policy.

Create a matching template with `export PATH` at a CLI decision. The exact-state key is canonical JSON containing starting stacks, blinds, button, actor, sorted hero cards, board and complete public action history. It contains no seed, deck, or opponent hole cards. Mapping solver positions, suits, units and action histories to this key is the responsibility of an importer. There is no native Pio/GTO+/commercial binary parser or bundled solver data.

`strategy.actions(game)` supplies an optional action abstraction: fold/check/call, minimum raise, raises of approximately 33%, 75% and 100% of the pot after calling, and all-in. Duplicate sizes collapse. The engine itself accepts all legal integer sizes. `Game.view()` is the public decision interface; `strategy.key()` is the information-set boundary. The engine stores private cards internally for simulation; adapters should pass only the actor view and public key to policies.

The exported six-position preflop file contains all 169 hand classes per position and explicit open frequencies. It is an educational RFI baseline, not a defend/3-bet/4-bet solution. BB entries are included for a uniform schema but are not used as an unopened-pot RFI policy. Import exact strategy rows to replace these heuristics for particular study spots.

## Evaluation boundaries

- **Kuhn CFR:** full-tree vanilla CFR, chance-weighted counterfactual regrets, reach-weighted average policy. Exact best responses enumerate each player's 64 deterministic information-set policies. `nash_conv` is the sum of unilateral best-response gains; exploitability is half that value. The equilibrium player-0 value is −1/18 ante chips. These guarantees concern a two-player zero-sum toy game, not multiplayer no-limit hold'em.
- **Hold'em equity:** Monte Carlo showdown pot share, including split-pot shares, against uniform random hands. Reports sampling standard error. It does not infer ranges or account for folded-card information.
- **Call EV:** equity × (current pot + call) − call, relative to folding. Applicable only to a fully contestable pot with no future betting or rake. Not valid for general side-pot or multiway future-action decisions.
- **Simulation:** empirical chips and BB/100 against the selected local policies. No hold'em exploitability claim and no statistical significance claim from a short run.

## Files

`poker_study/bot_policy.py`: heuristic opponent policy; `poker_study/engine.py`: rules and replay; `cards.py`: evaluation; `strategy.py`: ranges, imports, abstraction and equity; `cfr.py`: solver/evaluation example; `__main__.py`: CLI; `web.py` and `static/`: web server and UI. `tests/test_study.py` covers poker/CFR; `tests/test_web.py` covers sessions, API actions, imports, replay and request validation. `examples/` contains reproducible configuration, strategy templates, replay and evaluation outputs.

## References

- CFR foundation: [Zinkevich et al., Regret Minimization in Games with Incomplete Information](https://poker.cs.ualberta.ca/publications/NIPS07-cfr.pdf).
- Betting and short all-in rule reference: [PokerStars poker rules](https://www.pokerstars.com/help/articles/poker-rules-master/). Consulted as a rules reference only; this project has no site integration.

## Next development step

Add an adapter for a specific solver's exported text/CSV format, retaining provenance and exact stack/rake/action-tree assumptions. For actual hold'em solving, introduce a bounded subgame, explicit card/action abstraction and a separate evaluation protocol. Do not interpret convergence in Kuhn or a small abstraction as proof of full six-player equilibrium.

### Named opponents and mixed strategies (v0.3.0)

The web table has five fictional regulars with illustrated avatars. Click a portrait or select a player under **Table regulars** to inspect their tendencies. Their identities remain stable across hands; moving your seat relocates the same five opponents.

All five share a mixed practice baseline: position-aware openings, value and suited-ace bluff reraises, weighted opponent ranges based on public action history, 144-sample showdown-equity estimates, pot odds, position, draws, blockers, board texture, stack-to-pot context, and mixed bet sizes. Strong hands sometimes check or flat; selected weak hands and draws sometimes bluff or semi-bluff. Multiway pots reduce bluff frequency. Historical action weights use the board and pot price available when each action occurred.

The 12 composable traits are flatting bias, out-of-position width, folding bias, betting frequency, bluffing frequency, thin value, slowplaying, draw aggression, river caution, sizing, continued barrels and overall range width. The combined personality changes fold/call/check/raise category probabilities by at most **0.10 total variation per decision** compared with the neutral baseline in that same spot. Bet-size preferences are separate small changes. This is a bound on action probabilities, not on long-run win rates or range-size differences.

See `BOT_STYLES.md` for the cast. The CLI uses the neutral baseline; the web opponents use the named personalities. Hero hints remain neutral. Imported exact-state solver rows take priority and are never modified by personality traits.

No policy reads opponents' actual cards or the undealt deck. The range likelihoods, realization adjustments and bluff/value frequencies are heuristic; no full-game lookahead, learned human psychology, GTO convergence or hold'em exploitability result is claimed. Equity and side-pot decisions remain approximate. The preflop chart is illustrative and does not exactly reproduce every bot's mixed opening range.


## Cash career and fast simulator (v0.6.2)
Choose **Cash career** to start with 100 BB at a fixed physical seat. The dealer advances each hand, all surviving stacks carry forward, and occasional opponents leave and are replaced with 100 BB newcomers. Busted opponents are replaced automatically. A busted character can use **Rebuy 100 BB**; previous losses remain in profit statistics.

Name your character and track completed hands, winning hands, total profit, buy-ins and best stack. **Auto next hand** starts another hand after settlement, stopping when you bust or the tab is hidden. Normal/Fast/Instant controls presentation speed. The **Fast simulator** plays every seat automatically, has rotating opponents and dealer, and does not award character progress. Study spot mode retains configurable reset stacks.

Create a player account with a unique 3–24 character ID and a password of at least 10 characters to sign in from another browser or device. Account passwords are stored as salted scrypt hashes, never as plain text. Registration attaches the current guest career to the account; the previous guest cookie is invalidated. Sign out on shared devices, and keep the password safe because password reset is not available yet.

The hosted app saves careers, accounts and unfinished hands in `data/careers.sqlite3`; signed-in careers are keyed by an unguessable random HttpOnly cookie retained for one year. Server restart restores the last saved hand. Keep this database private and backed up separately; never bundle it in source downloads. Guest careers remain browser-local and are not recoverable after cookies are cleared. Local test App instances use no disk unless given a database path. Simulator-only visitors are not persisted until they create a character.
